export type OrchestrationMode = 'docker' | 'kubernetes';

export interface DeviceManagerConfig {
  mode: OrchestrationMode;
  port: number;
  adminApiKey: string;
  jwtSecret: string;
  botImage: string;
  databaseUrl: string;
  redisUrl: string;
  sessionHostPath: string;
  dockerNetwork: string;
  botProxyUrl?: string | undefined;
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

export type BotResourceSnapshot =
  | {
      available: true;
      source: 'docker-stats';
      sampledAt: string;
      containers: Array<{
        kind: 'device' | 'shared';
        name: string;
        service: string | null;
        deviceKey: string | null;
        cpuPercent: number;
        memoryUsageBytes: number;
        memoryLimitBytes: number;
      }>;
    }
  | {
      available: false;
      source: 'unavailable';
      sampledAt: string;
      reason: 'container_metrics_not_configured';
    };

export interface BotOrchestrator {
  readonly mode: OrchestrationMode;
  healthCheck(): Promise<void>;
  createBot(spec: BotStatefulSetSpec): Promise<{ resourceName: string }>;
  restartBot(spec: BotStatefulSetSpec): Promise<{ resourceName: string }>;
  deleteBot(deviceKey: string): Promise<void>;
  getBotStatus(deviceKey: string): Promise<BotPodStatus | null>;
  listBots(): Promise<BotPodStatus[]>;
  getResourceSnapshot(): Promise<BotResourceSnapshot>;
  scaleBot(deviceKey: string, replicas: number): Promise<void>;
}
