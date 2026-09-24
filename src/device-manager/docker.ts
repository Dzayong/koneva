import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
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

function containerUrl(url: string): string {
  return url
    .replace('://localhost', '://host.docker.internal')
    .replace('://127.0.0.1', '://host.docker.internal');
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

    try {
      await this.runner('docker', ['inspect', name]);
      await this.runner('docker', ['start', name]);
      return { resourceName: name };
    } catch {
      // Container does not exist yet; create it below.
    }

    const { stdout } = await this.runner('docker', [
      'run', '-d', '--name', name,
      '--network', this.config.dockerNetwork,
      '--add-host', 'host.docker.internal:host-gateway',
      '-e', `BOT_ID=${spec.deviceKey}`,
      '-e', `BOT_API_KEYS=${this.config.adminApiKey}`,
      '-e', `ADMIN_API_KEY=${this.config.adminApiKey}`,
      '-e', `DATABASE_URL=${containerUrl(this.config.databaseUrl)}`,
      '-e', `REDIS_URL=${containerUrl(this.config.redisUrl)}`,
      '-e', 'SESSION_PATH=/app/sessions',
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
