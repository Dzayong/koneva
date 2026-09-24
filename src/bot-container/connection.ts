import makeWASocket, {
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
  type ConnectionState as BaileysConnectionUpdate,
} from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { loadSession, bindCredsUpdate } from './session';
import type { BotConfig, ConnectionState } from './types';

const BOT_BROWSER: [string, string, string] = ['Windows', 'Chrome', '10.0.22621'];

interface BoomLike {
  output?: { statusCode?: number };
}

export interface ConnectionCallbacks {
  onQr?: (qr: string) => void | Promise<void>;
  onSocketReady?: (sock: WASocket) => void | Promise<void>;
  onStateChange?: (state: ConnectionState) => void | Promise<void>;
}

export async function startBotConnection(
  config: BotConfig,
  logger: Logger,
  callbacks: ConnectionCallbacks,
): Promise<void> {
  const connState: ConnectionState = {
    botId: config.botId,
    status: 'initializing',
    reconnectAttempt: 0,
  };

  const emitState = async (): Promise<void> => {
    await callbacks.onStateChange?.({ ...connState });
  };

  const connect = async (): Promise<void> => {
    const { state, saveCreds } = await loadSession(config.sessionPath, config.botId, logger);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info('Using Baileys version', { botId: config.botId, version, isLatest });

    const sock = makeWASocket({
      version,
      auth: state,
      browser: BOT_BROWSER,
      printQRInTerminal: false,
    });

    sock.ev.on('creds.update', bindCredsUpdate(saveCreds, config.botId, logger));

    sock.ev.on('connection.update', (update) => {
      void handleConnectionUpdate(update);
    });

    await callbacks.onSocketReady?.(sock);
  };

  const handleConnectionUpdate = async (
    update: Partial<BaileysConnectionUpdate>,
  ): Promise<void> => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connState.status = 'qr_pending';
      connState.qr = qr;
      logger.info('QR code generated', { botId: config.botId });
      await callbacks.onQr?.(qr);
      await emitState();
      return;
    }

    if (connection === 'connecting') {
      connState.status = 'connecting';
      await emitState();
      return;
    }

    if (connection === 'open') {
      connState.status = 'online';
      connState.qr = undefined;
      connState.reconnectAttempt = 0;
      connState.lastConnectedAt = new Date();
      logger.info('WhatsApp connection open', { botId: config.botId });
      await emitState();
      return;
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as BoomLike | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      connState.lastDisconnectReason =
        lastDisconnect?.error?.message ?? `status_${String(statusCode ?? 'unknown')}`;

      if (loggedOut) {
        connState.status = 'logged_out';
        logger.warn('Session logged out, will not reconnect', { botId: config.botId });
        await emitState();
        return;
      }

      if (connState.reconnectAttempt >= config.maxReconnectAttempts) {
        connState.status = 'offline';
        logger.error('Max reconnect attempts reached, giving up', {
          botId: config.botId,
          attempts: connState.reconnectAttempt,
        });
        await emitState();
        return;
      }

      const delayMs =
        config.reconnectDelaysMs[connState.reconnectAttempt] ??
        config.reconnectDelaysMs[config.reconnectDelaysMs.length - 1] ??
        60_000;

      connState.status = 'reconnecting';
      connState.reconnectAttempt += 1;
      logger.warn('Connection closed, scheduling reconnect', {
        botId: config.botId,
        attempt: connState.reconnectAttempt,
        delayMs,
        reason: connState.lastDisconnectReason,
      });
      await emitState();

      setTimeout(() => {
        connect().catch((err: unknown) => {
          logger.error('Reconnect attempt failed', {
            botId: config.botId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, delayMs);
    }
  };

  await connect();
}
