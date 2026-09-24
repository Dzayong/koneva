export interface BotConfig {
  botId: string;
  nodeEnv: 'development' | 'production' | 'test';
  databaseUrl: string;
  redisUrl: string;
  sessionPath: string;
  healthPort: number;
  maxReconnectAttempts: number;
  reconnectDelaysMs: number[];
  queueName: string;
  apiKeys: string[];
}

export type BotStatus =
  | 'initializing'
  | 'qr_pending'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'offline'
  | 'logged_out'
  | 'error';

export interface ConnectionState {
  botId: string;
  status: BotStatus;
  qr?: string | undefined;
  phoneNumber?: string | undefined;
  reconnectAttempt: number;
  lastConnectedAt?: Date | undefined;
  lastDisconnectReason?: string | undefined;
}

export type QueueMessageType = 'text' | 'image' | 'video' | 'audio' | 'document';

export interface EnqueueMessageInput {
  to: string;
  type: QueueMessageType;
  /** Message text, or the media URL when `type` is not `text`. */
  content: string;
}

export interface QueueJobData {
  messageId: string;
}

export type MessageStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'blocked';

export interface MessageRecord {
  id: string;
  tenantId: string;
  deviceId: string;
  deviceKey: string;
  to: string;
  content: string;
  type: QueueMessageType;
  status: MessageStatus;
  whatsappMessageId: string | null;
  errorMessage: string | null;
  createdAt: Date;
}
