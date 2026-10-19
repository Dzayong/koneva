import { execFile } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BotOrchestrator, BotPodStatus, BotResourceSnapshot, BotStatefulSetSpec, DeviceManagerConfig } from './types';

type CommandRunner = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

const runCommand: CommandRunner = async (file, args) => {
  const result = await promisify(execFile)(file, [...args]);
  return { stdout: result.stdout, stderr: result.stderr };
};

// Inside a container, localhost is the container itself; point at the host.
// Rewrites the hostname only, so URLs with credentials (user:pass@localhost) work.
function containerUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    parsed.hostname = 'host.docker.internal';
  }
  return parsed.toString();
}

function parseDockerBytes(value: string): number | null {
  const match = value.trim().match(/^([\d.]+)\s*(B|kB|MB|GB|TB|KiB|MiB|GiB|TiB)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const factors: Record<string, number> = {
    b: 1, kb: 1_000, mb: 1_000_000, gb: 1_000_000_000, tb: 1_000_000_000_000,
    kib: 1_024, mib: 1_048_576, gib: 1_073_741_824, tib: 1_099_511_627_776,
  };
  return Number.isFinite(amount) ? Math.round(amount * factors[unit]!) : null;
}

export function parseDockerResourceSnapshot(
  output: string,
  containersByName: ReadonlyMap<string, { kind: 'device' | 'shared'; service: string | null; deviceKey: string | null }>,
  sampledAt = new Date().toISOString(),
): BotResourceSnapshot {
  const containers: Extract<BotResourceSnapshot, { available: true }>['containers'] = [];
  for (const line of output.split('\n').map((part) => part.trim()).filter(Boolean)) {
    const row = JSON.parse(line) as { Name?: unknown; CPUPerc?: unknown; MemUsage?: unknown };
    if (typeof row.Name !== 'string') continue;
    const identity = containersByName.get(row.Name);
    if (!identity) continue;
    if (typeof row.CPUPerc !== 'string' || typeof row.MemUsage !== 'string') {
      throw new Error('Docker stats row is missing resource fields');
    }
    const cpu = row.CPUPerc.trim().match(/^([\d.]+)%$/);
    const memory = row.MemUsage.split('/');
    if (!cpu || memory.length !== 2) throw new Error('Docker stats row has an invalid format');
    const cpuPercent = Number(cpu[1]);
    const memoryUsageBytes = parseDockerBytes(memory[0]!);
    const memoryLimitBytes = parseDockerBytes(memory[1]!);
    if (!Number.isFinite(cpuPercent) || memoryUsageBytes === null || memoryLimitBytes === null) {
      throw new Error('Docker stats row has invalid numeric values');
    }
    containers.push({ name: row.Name, ...identity, cpuPercent, memoryUsageBytes, memoryLimitBytes });
  }
  return { available: true, source: 'docker-stats', sampledAt, containers };
}

const COMPOSE_SHARED_SERVICES = new Set([
  'postgres', 'redis', 'api-gateway', 'device-manager', 'dashboard', 'nginx', 'migrate', 'certbot',
]);

export class DockerBotManager implements BotOrchestrator {
  readonly mode = 'docker' as const;

  constructor(
    private readonly config: DeviceManagerConfig,
    private readonly runner: CommandRunner = runCommand,
  ) {}

  async healthCheck(): Promise<void> {
    await this.runner('docker', ['version', '--format', '{{.Server.Version}}']);
  }

  async createBot(spec: BotStatefulSetSpec): Promise<{ resourceName: string }> {
    const name = `wa-bot-${spec.deviceKey.toLowerCase()}`;
    const deviceSessionPath = path.resolve(this.config.sessionHostPath, spec.deviceKey);
    mkdirSync(deviceSessionPath, { recursive: true, mode: 0o700 });

    let existingEnv: string[] | null = null;
    try {
      const { stdout } = await this.runner('docker', ['inspect', '--format', '{{json .Config.Env}}', name]);
      existingEnv = JSON.parse(stdout) as string[];
    } catch {
      // Container does not exist yet; create it below.
    }

    if (existingEnv) {
      // Containers created before JWT_SECRET was passed crash-loop on config
      // validation; restarting them would keep the bad env, so recreate.
      if (existingEnv.some((entry) => entry.startsWith('JWT_SECRET='))) {
        await this.runner('docker', ['start', name]);
        return { resourceName: name };
      }
      await this.runner('docker', ['rm', '-f', name]);
    }

    // The session dir is created here (0700, owned by this process), so run the
    // bot as the same uid/gid or its non-root user can't write to the mount.
    const owner = process.getuid && process.getgid ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
    const { stdout } = await this.runner('docker', [
      'run', '-d', '--name', name, '--network', this.config.dockerNetwork,
      '--restart', 'unless-stopped',
      '--init',
      // Hardening: the bot needs no privileges, no writable rootfs, and must not
      // be able to starve the host if a dependency misbehaves.
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--memory', '512m', '--memory-swap', '512m',
      '--pids-limit', '256',
      '--label', `wa.gateway.network=${this.config.dockerNetwork}`,
      '--label', `wa.gateway.device=${spec.deviceKey}`,
      '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3',
      ...owner,
      '--add-host', 'host.docker.internal:host-gateway',
      '-e', `BOT_ID=${spec.deviceKey}`,
      '-e', `BOT_API_KEYS=${this.config.adminApiKey}`,
      '-e', `ADMIN_API_KEY=${this.config.adminApiKey}`,
      '-e', `JWT_SECRET=${this.config.jwtSecret}`,
      '-e', `DATABASE_URL=${containerUrl(this.config.databaseUrl)}`,
      '-e', `REDIS_URL=${containerUrl(this.config.redisUrl)}`,
      '-e', 'SESSION_PATH=/app/sessions',
      '-e', 'DB_POOL_MAX=4',
      '-v', `${deviceSessionPath}:/app/sessions`,
      this.config.botImage,
    ]);
    return { resourceName: stdout.trim() || name };
  }

  async deleteBot(deviceKey: string): Promise<void> {
    try {
      await this.runner('docker', ['rm', '-f', `wa-bot-${deviceKey.toLowerCase()}`]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('No such container')) throw error;
    }
    // Drop the WhatsApp credentials too; a deleted device must not leave a live session behind.
    const root = path.resolve(this.config.sessionHostPath);
    const sessionDir = path.resolve(root, deviceKey);
    if (sessionDir.startsWith(root + path.sep)) rmSync(sessionDir, { recursive: true, force: true });
  }

  async restartBot(spec: BotStatefulSetSpec): Promise<{ resourceName: string }> {
    const name = `wa-bot-${spec.deviceKey.toLowerCase()}`;
    try {
      await this.runner('docker', ['restart', name]);
      return { resourceName: name };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('No such container')) throw error;
      return this.createBot(spec);
    }
  }

  async getBotStatus(deviceKey: string): Promise<BotPodStatus | null> {
    const name = `wa-bot-${deviceKey.toLowerCase()}`;
    try {
      const { stdout } = await this.runner('docker', [
        'inspect', '--format', '{{json .State}}', name,
      ]);
      const state = JSON.parse(stdout) as {
        Status?: string;
        Running?: boolean;
        StartedAt?: string;
      };
      return {
        name,
        deviceKey,
        phase: state.Status ?? 'unknown',
        ready: state.Running ?? false,
        podIP: null,
        startedAt: state.StartedAt ?? null,
      };
    } catch {
      return null;
    }
  }

  async listBots(): Promise<BotPodStatus[]> {
    const { stdout } = await this.runner('docker', [
      'ps', '-a', '--filter', 'name=wa-bot-', '--format', '{{.Names}}|{{.State}}',
      '--filter', `network=${this.config.dockerNetwork}`,
    ]);
    return stdout.trim() ? stdout.trim().split('\n').map((line) => {
      const [name = 'unknown', phase = 'unknown'] = line.split('|');
      return {
        name,
        deviceKey: name.replace(/^wa-bot-/, '').toUpperCase(),
        phase,
        ready: phase === 'running',
        podIP: null,
        startedAt: null,
      };
    }) : [];
  }

  async getResourceSnapshot(): Promise<BotResourceSnapshot> {
    const { stdout: containers } = await this.runner('docker', [
      'ps', '--filter', `network=${this.config.dockerNetwork}`,
      '--format', '{{.Names}}|{{.Label "wa.gateway.network"}}|{{.Label "wa.gateway.device"}}|{{.Label "com.docker.compose.service"}}|{{.Label "com.docker.compose.project"}}',
    ]);
    const containersByName = new Map<string, { kind: 'device' | 'shared'; service: string | null; deviceKey: string | null }>();
    for (const line of containers.trim().split('\n').filter(Boolean)) {
      const [rawName, rawNetwork, rawDeviceKey, rawService, rawProject] = line.split('|');
      const name = rawName?.trim() ?? '';
      const network = rawNetwork?.trim() ?? '';
      const deviceKey = rawDeviceKey?.trim() ?? '';
      const service = rawService?.trim() ?? '';
      const project = rawProject?.trim() ?? '';
      if (!name) continue;
      if (network === this.config.dockerNetwork
          && /^wa-bot-[a-z0-9-]+$/.test(name)
          && /^[A-Za-z0-9_-]{1,64}$/.test(deviceKey)) {
        containersByName.set(name, { kind: 'device', service: null, deviceKey });
      } else if (
        COMPOSE_SHARED_SERVICES.has(service)
        && project
        && project !== '<no value>'
        && name.startsWith(`${project}-${service}-`)
      ) {
        // The custom KONEVA network plus Compose labels keeps this read-only
        // inventory scoped to the app stack, not arbitrary host containers.
        containersByName.set(name, { kind: 'shared', service, deviceKey: null });
      }
    }
    if (!containersByName.size) {
      return { available: true, source: 'docker-stats', sampledAt: new Date().toISOString(), containers: [] };
    }
    const { stdout } = await this.runner('docker', [
      'stats', '--no-stream', '--format', '{{json .}}', ...containersByName.keys(),
    ]);
    return parseDockerResourceSnapshot(stdout, containersByName);
  }

  async scaleBot(deviceKey: string, replicas: number): Promise<void> {
    if (replicas !== 0 && replicas !== 1) throw new Error('Docker bot replicas must be 0 or 1');
    await this.runner('docker', [replicas === 1 ? 'start' : 'stop', `wa-bot-${deviceKey.toLowerCase()}`]);
  }
}
