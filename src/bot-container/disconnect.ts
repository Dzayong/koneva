import { DisconnectReason } from '@whiskeysockets/baileys';
import type { BotStatus } from './types';

export interface DisconnectClassification {
  /** True when retrying can help; false when the session is unusable and a human must act. */
  reconnect: boolean;
  status: BotStatus;
  reason: string;
}

// Reconnect loops on a dead session waste time and look like a bot to WhatsApp, so
// every code that means "this session is finished" stops immediately.
export function classifyDisconnect(statusCode: number | undefined): DisconnectClassification {
  switch (statusCode) {
    case DisconnectReason.loggedOut:
      return { reconnect: false, status: 'logged_out', reason: 'logged_out' };
    case DisconnectReason.forbidden:
      return { reconnect: false, status: 'banned', reason: 'forbidden_403' };
    case DisconnectReason.connectionReplaced:
      return { reconnect: false, status: 'error', reason: 'connection_replaced' };
    case DisconnectReason.badSession:
      return { reconnect: false, status: 'error', reason: 'bad_session' };
    case DisconnectReason.multideviceMismatch:
      return { reconnect: false, status: 'error', reason: 'multidevice_mismatch' };
    default:
      return { reconnect: true, status: 'reconnecting', reason: 'transient' };
  }
}
