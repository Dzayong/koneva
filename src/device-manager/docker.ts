import { execFile } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BotOrchestrator, BotPodStatus, BotStatefulSetSpec, DeviceManagerConfig } from './types';

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
      'run', '-d', '--name', name,
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
      '--network', this.config.dockerNetwork,
      '--add-host', 'host.docker.internal:host-gateway',
      '-e', `BOT_ID=${spec.deviceKey}`,
      '-e', `BOT_API_KEYS=${this.config.adminApiKey}`,
      '-e', `ADMIN_API_KEY=${this.config.adminApiKey}`,
      '-e', `JWT_SECRET=${this.config.jwtSecret}`,
      '-e', `DATABASE_URL=${containerUrl(this.config.databaseUrl)}`,
      '-e', `REDIS_URL=${containerUrl(this.config.redisUrl)}`,
      '-e', 'SESSION_PATH=/app/sessions',
      '-e', 'DB_POOL_MAX=4',
      ...(this.config.botProxyUrl ? ['-e', `WA_PROXY_URL=${this.config.botProxyUrl}`] : []),
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

  async scaleBot(deviceKey: string, replicas: number): Promise<void> {
    if (replicas !== 0 && replicas !== 1) throw new Error('Docker bot replicas must be 0 or 1');
    await this.runner('docker', [replicas === 1 ? 'start' : 'stop', `wa-bot-${deviceKey.toLowerCase()}`]);
  }
}
