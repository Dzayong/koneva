import type Redis from 'ioredis';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { commandChannel, type CommandType } from '../shared/commands';
import { CommandFailure, executeCommand, Reschedule, type CommandContext } from './commands';
import { checkTransmission } from './send-guard';
import type { PresenceRoutine } from './presence';

type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

const POLL_MS = 4_000;

/** Claims queued commands for this number and runs them one at a time on its socket. */
export class CommandRunner {
  private timer: NodeJS.Timeout | undefined;
  private subscriber: Redis | undefined;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly deviceKey: string,
    private readonly queryFn: QueryFn,
    private readonly getSocket: () => WASocket | undefined,
    private readonly isConnected: () => boolean,
    private readonly presence: Pick<PresenceRoutine, 'ensureOnline' | 'afterSend'> | undefined,
    private readonly redis: Redis,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    // A command left "running" by a crash may already have half-happened; fail it rather than repeat a post.
    await this.queryFn(
      `UPDATE device_commands SET status = 'failed', error = 'INTERRUPTED: the number restarted while running this', finished_at = now()
       WHERE device_key = $1 AND status = 'running'`, [this.deviceKey],
    );
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
    const subscriber = this.redis.duplicate();
    this.subscriber = subscriber;
    subscriber.on('message', () => void this.tick());
    await subscriber.subscribe(commandChannel(this.deviceKey));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.subscriber?.quit().catch(() => undefined);
  }

  async tick(): Promise<void> {
    if (this.busy || this.stopped || !this.isConnected()) return;
    const sock = this.getSocket();
    if (!sock) return;
    this.busy = true;
    try {
      // Drain everything that is due; a slow command must not starve the ones behind it for a whole poll.
      for (;;) {
        const row = (await this.queryFn(
          `UPDATE device_commands SET status = 'running', started_at = now()
           WHERE id = (SELECT id FROM device_commands WHERE device_key = $1 AND status = 'queued' AND run_at <= now()
                       ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
           RETURNING id, device_id, type, payload`, [this.deviceKey],
        )).rows[0] as { id: string; device_id: string; type: CommandType; payload: unknown } | undefined;
        if (!row) break;
        await this.run(row, sock);
      }
    } catch (error) {
      this.log.error('Command runner tick failed', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.busy = false;
    }
  }

  private async run(row: { id: string; device_id: string; type: CommandType; payload: unknown }, sock: WASocket): Promise<void> {
    const guard = async (): Promise<void> => {
      const decision = await checkTransmission(this.deviceKey, this.queryFn);
      if (decision.allowed) return;
      // A command is a one-off action by a person: when blocked it is CANCELLED (failed with a code), never held or re-run after recovery.
      const code = decision.reason === 'workspace_suspended' ? 'WORKSPACE_SUSPENDED' : decision.reason === 'device_paused' ? 'DEVICE_PAUSED' : decision.reason === 'device_banned' ? 'DEVICE_BANNED' : 'NOT_ALLOWED';
      throw new CommandFailure(code, 'Not sent: the workspace is suspended or the number is paused or banned.');
    };
    const ctx: CommandContext = { sock, queryFn: this.queryFn, deviceKey: this.deviceKey, deviceId: row.device_id, presence: this.presence, log: this.log, assertMayTransmit: guard };
    const writes = row.type === 'status.post' || row.type === 'profile.update' || row.type === 'profile.picture'
      || ['whatsapp.group.create', 'whatsapp.group.update', 'whatsapp.group.leave', 'whatsapp.group.members', 'whatsapp.group.invite.revoke', 'whatsapp.group.settings', 'whatsapp.group.picture', 'whatsapp.group.join-requests.update'].includes(row.type)
      || row.type.startsWith('whatsapp.community.')
      || ['whatsapp.channel.follow', 'whatsapp.channel.create', 'whatsapp.channel.update', 'whatsapp.channel.unfollow', 'whatsapp.channel.post'].includes(row.type);
    try {
      if (writes) await guard(); // first check; the commands repeat it right before the actual write
      const result = await executeCommand(row.type, row.payload, ctx);
      await this.queryFn(
        `UPDATE device_commands SET status = 'done', result = $2::jsonb, finished_at = now() WHERE id = $1`,
        [row.id, JSON.stringify(result ?? null)],
      );
      this.log.info('Command done', { type: row.type, id: row.id });
    } catch (error) {
      if (error instanceof Reschedule) {
        await this.queryFn(
          `UPDATE device_commands SET status = 'queued', started_at = NULL, run_at = now() + ($2::int * interval '1 millisecond') WHERE id = $1`,
          [row.id, Math.max(1_000, Math.min(error.delayMs, 2_000_000_000))],
        );
        this.log.info('Command postponed', { type: row.type, id: row.id, reason: error.reason });
        return;
      }
      const code = error instanceof CommandFailure ? error.code : 'COMMAND_FAILED';
      const message = error instanceof Error ? error.message : String(error);
      await this.queryFn(`UPDATE device_commands SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [row.id, `${code}: ${message}`.slice(0, 500)]);
      this.log.warn('Command failed', { type: row.type, id: row.id, code, error: message });
    }
  }
}
