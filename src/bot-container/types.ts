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
  proxyUrl?: string | undefined;
}

export type BotStatus =
  | 'initializing'
  | 'qr_pending'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'offline'
  | 'logged_out'
  | 'banned'
  | 'error';

export interface ConnectionState {
  botId: string;
  status: BotStatus;
  qr?: string | undefined;
  phoneNumber?: string | undefined;
  reconnectAttempt: number;
  lastConnectedAt?: Date | undefined;
  lastDisconnectReason?: string | undefined;
  disconnectCode?: number | undefined;
}

export type QueueMessageType = 'text' | 'image' | 'video' | 'audio' | 'document';

export interface EnqueueMessageInput {
  to: string;
  type: QueueMessageType;
  /** Message text, or the media URL when `type` is not `text`. */
  content: string;
  /** 'urgent' (OTP) uses its own queue and skips pacing. Default 'normal'. */
  priority?: 'normal' | 'urgent' | undefined;
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
  | 'blocked'
  | 'received';

export interface MessageRecord {
  id: string;
  tenantId: string;
  deviceId: string;
  deviceKey: string;
  to: string;
  content: string;
  mediaUrl?: string | null;
  type: QueueMessageType;
  status: MessageStatus;
  whatsappMessageId: string | null;
  errorMessage: string | null;
  priority: 'normal' | 'urgent';
  /** Set only by the API gateway's server-verified transactional exemption. */
  quotaExempt?: boolean;
  /** Platform signup OTP; terminal sends erase the stored recipient and body. */
  systemOtp?: boolean;
  createdAt: Date;
}
