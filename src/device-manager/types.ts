export type OrchestrationMode = 'docker' | 'kubernetes';

export interface DeviceManagerConfig {
  mode: OrchestrationMode;
  port: number;
  adminApiKey: string;
  botImage: string;
  databaseUrl: string;
  redisUrl: string;
  sessionHostPath: string;
  dockerNetwork: string;
  kubernetes: KubernetesConfig;
}

export interface KubernetesConfig {
  namespace: string;
  inCluster: boolean;
  storageClassName?: string | undefined;
  sessionStorageSize: string;
}

export interface BotStatefulSetSpec {
  deviceKey: string;
  tenantId: string;
  phoneNumber?: string | undefined;
  replicas?: number | undefined;
}

export interface BotPodStatus {
  name: string;
  deviceKey: string;
  phase: string;
  ready: boolean;
  podIP: string | null;
  startedAt: string | null;
}

export interface BotOrchestrator {
  readonly mode: OrchestrationMode;
  healthCheck(): Promise<void>;
  createBot(spec: BotStatefulSetSpec): Promise<{ resourceName: string }>;
  deleteBot(deviceKey: string): Promise<void>;
  getBotStatus(deviceKey: string): Promise<BotPodStatus | null>;
  listBots(): Promise<BotPodStatus[]>;
  scaleBot(deviceKey: string, replicas: number): Promise<void>;
}
