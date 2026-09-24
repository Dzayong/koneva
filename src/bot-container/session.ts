import fs from 'node:fs';
import path from 'node:path';
import { useMultiFileAuthState, type AuthenticationState } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';

export interface SessionHandle {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

export function sessionDir(sessionPath: string, botId: string): string {
  return path.join(sessionPath, botId);
}

export async function loadSession(
  sessionPath: string,
  botId: string,
  logger: Logger,
): Promise<SessionHandle> {
  const dir = sessionDir(sessionPath, botId);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  logger.info('Session auth state loaded', { botId, dir });

  return { state, saveCreds };
}

export function hasRegisteredSession(sessionPath: string, botId: string): boolean {
  const credsFile = path.join(sessionDir(sessionPath, botId), 'creds.json');
  if (!fs.existsSync(credsFile)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(credsFile, 'utf-8');
    const parsed = JSON.parse(raw) as { registered?: boolean };
    return parsed.registered === true;
  } catch {
    return false;
  }
}

export function bindCredsUpdate(
  saveCreds: () => Promise<void>,
  botId: string,
  logger: Logger,
): () => Promise<void> {
  return async () => {
    try {
      await saveCreds();
      logger.debug('Credentials persisted', { botId });
    } catch (err) {
      logger.error('Failed to persist credentials', {
        botId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

export function clearSession(sessionPath: string, botId: string, logger: Logger): void {
  const dir = sessionDir(sessionPath, botId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    logger.warn('Session cleared', { botId, dir });
  }
}
