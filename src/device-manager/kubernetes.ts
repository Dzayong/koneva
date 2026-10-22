import type * as Kubernetes from '@kubernetes/client-node';
import type { BotPodStatus, BotResourceSnapshot, BotStatefulSetSpec, KubernetesConfig } from './types';

type AppsApi = Pick<
  Kubernetes.AppsV1Api,
  | 'createNamespacedStatefulSet'
  | 'deleteNamespacedStatefulSet'
  | 'listNamespacedStatefulSet'
  | 'readNamespacedStatefulSet'
  | 'replaceNamespacedStatefulSet'
>;

type CoreApi = Pick<Kubernetes.CoreV1Api, 'listNamespacedPod' | 'deleteNamespacedPod'>;

export interface KubernetesClients {
  apps: AppsApi;
  core: CoreApi;
}

export interface KubernetesBotManagerOptions {
  config: KubernetesConfig;
  botImage: string;
  clients: KubernetesClients;
}

export class KubernetesOperationError extends Error {
  constructor(
    operation: string,
    public readonly statusCode: number | undefined,
    options: { cause: unknown },
  ) {
    super(`Kubernetes ${operation} failed${statusCode ? ` (${statusCode})` : ''}`, options);
  }
}

const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('@kubernetes/client-node')>;

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    code?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    body?: { code?: unknown };
  };
  for (const value of [
    candidate.response?.status,
    candidate.statusCode,
    candidate.body?.code,
    candidate.code,
  ]) {
    if (typeof value === 'number') return value;
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  return errorStatus(error) === 404;
}

export function statefulSetName(deviceKey: string): string {
  const normalized = deviceKey
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55)
    .replace(/-+$/g, '');
  if (!normalized) throw new Error('deviceKey does not contain a valid Kubernetes name');
  return `bot-${normalized}`;
}

export async function createKubernetesClients(
  config: KubernetesConfig,
): Promise<KubernetesClients> {
  const k8s = await nativeImport('@kubernetes/client-node');
  const kubeConfig = new k8s.KubeConfig();
  if (config.inCluster) kubeConfig.loadFromCluster();
  else kubeConfig.loadFromDefault();
  return {
    apps: kubeConfig.makeApiClient(k8s.AppsV1Api),
    core: kubeConfig.makeApiClient(k8s.CoreV1Api),
  };
}

export class KubernetesBotManager {
  readonly mode = 'kubernetes' as const;

  constructor(private readonly options: KubernetesBotManagerOptions) {}

  async createBot(spec: BotStatefulSetSpec): Promise<{ resourceName: string }> {
    const resource = await this.createBotStatefulSet(spec.deviceKey, spec.tenantId, spec.phoneNumber);
    return { resourceName: resource.metadata?.name ?? statefulSetName(spec.deviceKey) };
  }

  async deleteBot(deviceKey: string): Promise<void> {
    await this.deleteBotStatefulSet(deviceKey);
  }

  async restartBot(spec: import('./types').BotStatefulSetSpec): Promise<{ resourceName: string }> {
    const name = statefulSetName(spec.deviceKey);
    let workload: Kubernetes.V1StatefulSet;
    try {
      workload = await this.options.clients.apps.readNamespacedStatefulSet({
        name,
        namespace: this.options.config.namespace,
      });
    } catch (error) {
      if (!isNotFound(error)) throw new KubernetesOperationError('read StatefulSet for restart', errorStatus(error), { cause: error });
      return this.createBot(spec);
    }
    if (workload.spec?.replicas === 0) {
      workload.spec.replicas = 1;
      try {
        workload = await this.options.clients.apps.replaceNamespacedStatefulSet({
          name,
          namespace: this.options.config.namespace,
          body: workload,
          fieldManager: 'wa-gateway-device-manager',
          fieldValidation: 'Strict',
        });
      } catch (error) {
        throw new KubernetesOperationError('resume StatefulSet for restart', errorStatus(error), { cause: error });
      }
    }
    const pod = await this.getBotPodStatus(spec.deviceKey);
    if (pod) {
      try {
        await this.options.clients.core.deleteNamespacedPod({
          name: pod.name,
          namespace: this.options.config.namespace,
          gracePeriodSeconds: 0,
        });
      } catch (error) {
        if (!isNotFound(error)) throw new KubernetesOperationError('restart Pod', errorStatus(error), { cause: error });
      }
    }
    return { resourceName: workload.metadata?.name ?? name };
  }

  async getBotStatus(deviceKey: string): Promise<BotPodStatus | null> {
    return this.getBotPodStatus(deviceKey);
  }

  async listBots(): Promise<BotPodStatus[]> {
    return this.listBotPods();
  }

  async getResourceSnapshot(): Promise<BotResourceSnapshot> {
    return {
      available: false,
      source: 'unavailable',
      sampledAt: new Date().toISOString(),
      reason: 'container_metrics_not_configured',
    };
  }

  async scaleBot(deviceKey: string, replicas: number): Promise<void> {
    await this.scaleBotStatefulSet(deviceKey, replicas);
  }

  async healthCheck(): Promise<void> {
    try {
      await this.options.clients.apps.listNamespacedStatefulSet({
        namespace: this.options.config.namespace,
        limit: 1,
      });
    } catch (error) {
      throw new KubernetesOperationError('health check', errorStatus(error), { cause: error });
    }
  }

  async createBotStatefulSet(
    deviceKey: string,
    tenantId: string,
    phoneNumber?: string,
  ): Promise<Kubernetes.V1StatefulSet> {
    const body = this.buildStatefulSet({ deviceKey, tenantId, phoneNumber, replicas: 1 });
    const name = body.metadata!.name!;

    try {
      const existing = await this.options.clients.apps.readNamespacedStatefulSet({
        name,
        namespace: this.options.config.namespace,
      });
      const resourceVersion = existing.metadata?.resourceVersion;
      if (resourceVersion) body.metadata!.resourceVersion = resourceVersion;
      return await this.options.clients.apps.replaceNamespacedStatefulSet({
        name,
        namespace: this.options.config.namespace,
        body,
        fieldManager: 'wa-gateway-device-manager',
        fieldValidation: 'Strict',
      });
    } catch (error) {
      if (!isNotFound(error)) {
        throw new KubernetesOperationError('read/update StatefulSet', errorStatus(error), { cause: error });
      }
    }

    try {
      return await this.options.clients.apps.createNamespacedStatefulSet({
        namespace: this.options.config.namespace,
        body,
        fieldManager: 'wa-gateway-device-manager',
        fieldValidation: 'Strict',
      });
    } catch (error) {
      throw new KubernetesOperationError('create StatefulSet', errorStatus(error), { cause: error });
    }
  }

  async deleteBotStatefulSet(deviceKey: string): Promise<void> {
    try {
      await this.options.clients.apps.deleteNamespacedStatefulSet({
        name: statefulSetName(deviceKey),
        namespace: this.options.config.namespace,
        propagationPolicy: 'Foreground',
      });
    } catch (error) {
      if (!isNotFound(error)) {
        throw new KubernetesOperationError('delete StatefulSet', errorStatus(error), { cause: error });
      }
    }
  }

  async getBotPodStatus(deviceKey: string): Promise<BotPodStatus | null> {
    const pods = await this.listPods(`wa-gateway.io/device-key=${deviceKey.toLowerCase()}`);
    return pods[0] ?? null;
  }

  async listBotPods(): Promise<BotPodStatus[]> {
    return this.listPods('app.kubernetes.io/component=bot');
  }

  async scaleBotStatefulSet(deviceKey: string, replicas: number): Promise<void> {
    if (!Number.isInteger(replicas) || replicas < 0 || replicas > 1) {
      throw new Error('Bot StatefulSet replicas must be 0 or 1');
    }
    const name = statefulSetName(deviceKey);
    try {
      const body = await this.options.clients.apps.readNamespacedStatefulSet({
        name,
        namespace: this.options.config.namespace,
      });
      body.spec!.replicas = replicas;
      await this.options.clients.apps.replaceNamespacedStatefulSet({
        name,
        namespace: this.options.config.namespace,
        body,
        fieldManager: 'wa-gateway-device-manager',
        fieldValidation: 'Strict',
      });
    } catch (error) {
      throw new KubernetesOperationError('scale StatefulSet', errorStatus(error), { cause: error });
    }
  }

  private async listPods(labelSelector: string): Promise<BotPodStatus[]> {
    try {
      const result = await this.options.clients.core.listNamespacedPod({
        namespace: this.options.config.namespace,
        labelSelector,
      });
      return result.items.map((pod) => ({
        name: pod.metadata?.name ?? 'unknown',
        deviceKey: pod.metadata?.labels?.['wa-gateway.io/device-key'] ?? 'unknown',
        phase: pod.status?.phase ?? 'Unknown',
        ready: pod.status?.conditions?.some(
          (condition) => condition.type === 'Ready' && condition.status === 'True',
        ) ?? false,
        podIP: pod.status?.podIP ?? null,
        startedAt: pod.status?.startTime?.toISOString() ?? null,
      }));
    } catch (error) {
      throw new KubernetesOperationError('list Pods', errorStatus(error), { cause: error });
    }
  }

  private buildStatefulSet(spec: BotStatefulSetSpec): Kubernetes.V1StatefulSet {
    const name = statefulSetName(spec.deviceKey);
    const deviceLabel = spec.deviceKey.toLowerCase();
    const labels = {
      'app.kubernetes.io/name': 'wa-bot',
      'app.kubernetes.io/component': 'bot',
      'app.kubernetes.io/part-of': 'wa-gateway',
      'wa-gateway.io/device-key': deviceLabel,
      'wa-gateway.io/tenant-id': spec.tenantId,
    };
    const annotations: Record<string, string> = {
      'wa-gateway.io/device-key': spec.deviceKey,
      'wa-gateway.io/tenant-id': spec.tenantId,
    };
    if (spec.phoneNumber) annotations['wa-gateway.io/phone-number'] = spec.phoneNumber;

    return {
      apiVersion: 'apps/v1',
      kind: 'StatefulSet',
      metadata: { name, namespace: this.options.config.namespace, labels, annotations },
      spec: {
        serviceName: 'bot-template',
        replicas: spec.replicas ?? 1,
        podManagementPolicy: 'Parallel',
        persistentVolumeClaimRetentionPolicy: { whenDeleted: 'Retain', whenScaled: 'Retain' },
        selector: { matchLabels: { 'wa-gateway.io/device-key': deviceLabel } },
        template: {
          metadata: {
            labels,
            annotations: {
              'prometheus.io/scrape': 'true',
              'prometheus.io/path': '/metrics',
              'prometheus.io/port': '9000',
            },
          },
          spec: {
            automountServiceAccountToken: false,
            terminationGracePeriodSeconds: 60,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 10001,
              runAsGroup: 10001,
              fsGroup: 10001,
              fsGroupChangePolicy: 'OnRootMismatch',
              seccompProfile: { type: 'RuntimeDefault' },
            },
            containers: [{
              name: 'bot',
              image: this.options.botImage,
              imagePullPolicy: 'IfNotPresent',
              ports: [{ name: 'http', containerPort: 9000, protocol: 'TCP' }],
              env: [
                { name: 'NODE_ENV', value: 'production' },
                { name: 'BOT_ID', value: spec.deviceKey },
                { name: 'BOT_CONTAINER_PORT', value: '9000' },
                { name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 'wa-gateway-secrets', key: 'DATABASE_URL' } } },
                { name: 'REDIS_URL', valueFrom: { secretKeyRef: { name: 'wa-gateway-secrets', key: 'REDIS_URL' } } },
                { name: 'BOT_API_KEYS', valueFrom: { secretKeyRef: { name: 'wa-gateway-secrets', key: 'ADMIN_API_KEY' } } },
                { name: 'ADMIN_API_KEY', valueFrom: { secretKeyRef: { name: 'wa-gateway-secrets', key: 'ADMIN_API_KEY' } } },
                { name: 'JWT_SECRET', valueFrom: { secretKeyRef: { name: 'wa-gateway-secrets', key: 'JWT_SECRET' } } },
                { name: 'API_GATEWAY_URL', value: 'http://api-gateway:8000' },
                { name: 'SESSION_PATH', value: '/app/sessions' },
              ],
              resources: {
                requests: { cpu: '100m', memory: '256Mi' },
                limits: { cpu: '1', memory: '1Gi' },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ['ALL'] },
              },
              startupProbe: {
                httpGet: { path: '/health', port: 'http' },
                periodSeconds: 5,
                failureThreshold: 60,
              },
              livenessProbe: {
                httpGet: { path: '/health', port: 'http' },
                periodSeconds: 20,
                timeoutSeconds: 5,
                failureThreshold: 3,
              },
              readinessProbe: {
                httpGet: { path: '/ready', port: 'http' },
                periodSeconds: 10,
                timeoutSeconds: 5,
                failureThreshold: 6,
              },
              volumeMounts: [
                { name: 'session', mountPath: '/app/sessions' },
                { name: 'tmp', mountPath: '/tmp' },
              ],
            }],
            volumes: [{ name: 'tmp', emptyDir: {} }],
          },
        },
        volumeClaimTemplates: [{
          metadata: { name: 'session', labels },
          spec: {
            accessModes: ['ReadWriteOnce'],
            ...(this.options.config.storageClassName
              ? { storageClassName: this.options.config.storageClassName }
              : {}),
            resources: { requests: { storage: this.options.config.sessionStorageSize } },
          },
        }],
      },
    };
  }
}

let defaultManager: Promise<KubernetesBotManager> | undefined;

async function getDefaultManager(): Promise<KubernetesBotManager> {
  if (!defaultManager) {
    const config: KubernetesConfig = {
      namespace: process.env.KUBERNETES_NAMESPACE ?? 'wa-gateway',
      inCluster: process.env.KUBERNETES_IN_CLUSTER === 'true'
        || Boolean(process.env.KUBERNETES_SERVICE_HOST),
      storageClassName: process.env.BOT_STORAGE_CLASS,
      sessionStorageSize: process.env.BOT_SESSION_STORAGE_SIZE ?? '1Gi',
    };
    defaultManager = createKubernetesClients(config).then((clients) => new KubernetesBotManager({
      config,
      clients,
      botImage: process.env.BOT_IMAGE ?? 'your-registry/wa-bot:latest',
    }));
  }
  return defaultManager;
}

export async function createBotStatefulSet(deviceKey: string, tenantId: string, phoneNumber?: string) {
  return (await getDefaultManager()).createBotStatefulSet(deviceKey, tenantId, phoneNumber);
}

export async function deleteBotStatefulSet(deviceKey: string): Promise<void> {
  await (await getDefaultManager()).deleteBotStatefulSet(deviceKey);
}

export async function getBotPodStatus(deviceKey: string): Promise<BotPodStatus | null> {
  return (await getDefaultManager()).getBotPodStatus(deviceKey);
}

export async function listBotPods(): Promise<BotPodStatus[]> {
  return (await getDefaultManager()).listBotPods();
}

export async function scaleBotStatefulSet(deviceKey: string, replicas: number): Promise<void> {
  await (await getDefaultManager()).scaleBotStatefulSet(deviceKey, replicas);
}
