import type { WAMessageKey, WASocket } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';

export interface PresenceSettings {
  enabled: boolean;
  minMs: number;
  maxMs: number;
}

export interface PresenceDeps {
  random?: () => number;
  wait?: (ms: number) => Promise<void>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const SETTINGS_TTL_MS = 30_000;

/**
 * Makes a number behave like someone who opens WhatsApp when a message arrives:
 *   message in -> pause -> online -> pause -> read (blue ticks) -> pause -> offline.
 * Every pause is random within the number's own bounds. Sending also goes through it: the number is
 * put online before typing, and drifts offline again after a random pause. Read receipts are only
 * visible to the sender when the phone's own "read receipts" privacy setting is on.
 */
export class PresenceRoutine {
  private pending: WAMessageKey[] = [];
  private running = false;
  private online = false;
  private offlineTimer: unknown;
  private settings: { value: PresenceSettings; at: number } | undefined;
  private stopped = false;

  constructor(
    private readonly getSocket: () => WASocket | undefined,
    private readonly loadSettings: () => Promise<PresenceSettings>,
    private readonly log: Logger,
    private readonly deps: PresenceDeps = {},
  ) {}

  private random(): number { return (this.deps.random ?? Math.random)(); }
  private wait(ms: number): Promise<void> {
    return (this.deps.wait ?? ((n) => new Promise<void>((resolve) => setTimeout(resolve, n))))(ms);
  }

  private async getSettings(): Promise<PresenceSettings> {
    const now = Date.now();
    if (this.settings && now - this.settings.at < SETTINGS_TTL_MS) return this.settings.value;
    try {
      const value = await this.loadSettings();
      this.settings = { value, at: now };
      return value;
    } catch (error) {
      this.log.debug('Could not load presence settings', { error: error instanceof Error ? error.message : String(error) });
      return this.settings?.value ?? { enabled: false, minMs: 1_000, maxMs: 200_000 };
    }
  }

  /** Random pause inside the number's bounds (inclusive of both ends, in ms). */
  pauseMs(settings: PresenceSettings): number {
    const lo = Math.min(settings.minMs, settings.maxMs);
    const hi = Math.max(settings.minMs, settings.maxMs);
    return Math.round(lo + this.random() * (hi - lo));
  }

  private async setPresence(kind: 'available' | 'unavailable'): Promise<void> {
    const sock = this.getSocket();
    if (!sock) return;
    try {
      await sock.sendPresenceUpdate(kind);
      this.online = kind === 'available';
    } catch (error) {
      this.log.debug('Presence update failed', { kind, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private cancelOffline(): void {
    if (this.offlineTimer !== undefined) {
      (this.deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(this.offlineTimer);
      this.offlineTimer = undefined;
    }
  }

  private async scheduleOffline(): Promise<void> {
    this.cancelOffline();
    if (this.stopped) return;
    const settings = await this.getSettings();
    if (!settings.enabled) return;
    this.offlineTimer = (this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms).unref()))(() => {
      this.offlineTimer = undefined;
      if (!this.running) void this.setPresence('unavailable');
    }, this.pauseMs(settings));
  }

  /** A direct message arrived. Returns true when the routine owns reading it. */
  async onInbound(key: WAMessageKey): Promise<boolean> {
    if ((await this.getSettings()).enabled === false) return false;
    this.pending.push(key);
    this.cancelOffline();
    if (!this.running) void this.run();
    return true;
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.pending.length > 0 && !this.stopped) {
        const settings = await this.getSettings();
        if (!settings.enabled) { this.pending = []; break; }
        await this.wait(this.pauseMs(settings));           // notices the notification
        if (!this.online) await this.setPresence('available');
        await this.wait(this.pauseMs(settings));           // opens the chat
        const keys = this.pending.splice(0);
        const sock = this.getSocket();
        if (sock && keys.length > 0) {
          await sock.readMessages(keys).catch((error: unknown) => {
            this.log.debug('Failed to mark messages as read', { error: error instanceof Error ? error.message : String(error) });
          });
        }
      }
    } finally {
      this.running = false;
    }
    await this.scheduleOffline();                           // puts the phone down
  }

  /** Before replying: be online, and have read the message being answered. */
  async beforeReply(key?: WAMessageKey): Promise<void> {
    if (!(await this.getSettings()).enabled) return;
    this.cancelOffline();
    if (!this.online) await this.setPresence('available');
    if (key) {
      this.pending = this.pending.filter((k) => k.id !== key.id);
      await this.getSocket()?.readMessages([key]).catch(() => undefined);
    }
  }

  /** Before any outbound send (queue). Online first, then the caller types and sends. */
  async ensureOnline(): Promise<void> {
    await this.beforeReply();
  }

  /** After sending: stay a little, then go offline. */
  async afterSend(): Promise<void> {
    if (!(await this.getSettings()).enabled || this.running) return;
    await this.scheduleOffline();
  }

  stop(): void {
    this.stopped = true;
    this.cancelOffline();
  }
}
