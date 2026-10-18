import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as Kubernetes from '@kubernetes/client-node';
import {
  KubernetesBotManager,
  type KubernetesClients,
  statefulSetName,
} from './kubernetes';

function notFound(): unknown {
  return { response: { status: 404 } };
}

function manager(overrides: {
  apps?: Partial<KubernetesClients['apps']>;
  core?: Partial<KubernetesClients['core']>;
} = {}): {
  manager: KubernetesBotManager;
  calls: { created: Kubernetes.V1StatefulSet[]; replaced: Kubernetes.V1StatefulSet[] };
} {
  const calls = { created: [] as Kubernetes.V1StatefulSet[], replaced: [] as Kubernetes.V1StatefulSet[] };
  const apps = {
    readNamespacedStatefulSet: async () => { throw notFound(); },
    createNamespacedStatefulSet: async ({ body }: { body: Kubernetes.V1StatefulSet }) => {
      calls.created.push(body);
      return body;
    },
    replaceNamespacedStatefulSet: async ({ body }: { body: Kubernetes.V1StatefulSet }) => {
      calls.replaced.push(body);
      return body;
    },
    deleteNamespacedStatefulSet: async () => ({}),
    listNamespacedStatefulSet: async () => ({ items: [] }),
    ...overrides.apps,
  } as unknown as KubernetesClients['apps'];
  const core = {
    listNamespacedPod: async () => ({ items: [] }),
    ...overrides.core,
  } as unknown as KubernetesClients['core'];
  return {
    manager: new KubernetesBotManager({
      config: {
        namespace: 'wa-gateway',
        inCluster: false,
        sessionStorageSize: '1Gi',
      },
      botImage: 'registry.example/wa-bot:test',
      clients: { apps, core },
    }),
    calls,
  };
}

test('statefulSetName produces a DNS-safe stable name', () => {
  assert.equal(statefulSetName('WAPI-TEST_01'), 'bot-wapi-test-01');
});

test('createBotStatefulSet creates a secure workload when it does not exist', async () => {
  const fixture = manager();
  const result = await fixture.manager.createBotStatefulSet(
    'WAPI-TEST01',
    '8fca6485-b3df-47c2-b87e-0c235c0a4bb9',
    '+6281234567890',
  );

  assert.equal(result.metadata?.name, 'bot-wapi-test01');
  assert.equal(fixture.calls.created.length, 1);
  const podSpec = fixture.calls.created[0]?.spec?.template.spec;
  assert.equal(podSpec?.securityContext?.runAsNonRoot, true);
  assert.equal(podSpec?.containers[0]?.securityContext?.readOnlyRootFilesystem, true);
  assert.equal(
    podSpec?.containers[0]?.env?.find((item) => item.name === 'DATABASE_URL')?.valueFrom?.secretKeyRef?.name,
    'wa-gateway-secrets',
  );
  assert.equal(fixture.calls.created[0]?.spec?.volumeClaimTemplates?.[0]?.spec?.resources?.requests?.storage, '1Gi');
});

test('createBotStatefulSet replaces an existing workload idempotently', async () => {
  const fixture = manager({
    apps: {
      readNamespacedStatefulSet: async () => ({
        metadata: { name: 'bot-wapi-test01', resourceVersion: '42' },
        spec: {},
      } as Kubernetes.V1StatefulSet),
    },
  });

  await fixture.manager.createBotStatefulSet(
    'WAPI-TEST01',
    '8fca6485-b3df-47c2-b87e-0c235c0a4bb9',
  );
  assert.equal(fixture.calls.created.length, 0);
  assert.equal(fixture.calls.replaced[0]?.metadata?.resourceVersion, '42');
});

test('deleteBotStatefulSet is idempotent when the workload is absent', async () => {
  const fixture = manager({
    apps: { deleteNamespacedStatefulSet: async () => { throw notFound(); } },
  });
  await assert.doesNotReject(() => fixture.manager.deleteBotStatefulSet('WAPI-MISSING'));
});

test('getBotPodStatus maps Kubernetes readiness and pod metadata', async () => {
  const fixture = manager({
    core: {
      listNamespacedPod: async () => ({
        items: [{
          metadata: {
            name: 'bot-wapi-test01-0',
            labels: { 'wa-gateway.io/device-key': 'wapi-test01' },
          },
          status: {
            phase: 'Running',
            podIP: '10.0.0.8',
            startTime: new Date('2026-01-01T00:00:00Z'),
            conditions: [{ type: 'Ready', status: 'True' }],
          },
        }],
      } as Kubernetes.V1PodList),
    },
  });
  const status = await fixture.manager.getBotPodStatus('WAPI-TEST01');
  assert.deepEqual(status, {
    name: 'bot-wapi-test01-0',
    deviceKey: 'wapi-test01',
    phase: 'Running',
    ready: true,
    podIP: '10.0.0.8',
    startedAt: '2026-01-01T00:00:00.000Z',
  });
});

test('Kubernetes resource usage stays explicitly unavailable until Metrics Server is configured', async () => {
  const fixture = manager();
  const snapshot = await fixture.manager.getResourceSnapshot();
  assert.equal(snapshot.available, false);
  if (snapshot.available) assert.fail('Kubernetes resource metrics must not be inferred from pod requests');
  assert.equal(snapshot.reason, 'container_metrics_not_configured');
  assert.equal(snapshot.source, 'unavailable');
});

test('scaleBotStatefulSet changes replicas while retaining resource identity', async () => {
  const fixture = manager({
    apps: {
      readNamespacedStatefulSet: async () => ({
        metadata: { name: 'bot-wapi-test01', resourceVersion: '42' },
        spec: { replicas: 1 },
      } as Kubernetes.V1StatefulSet),
    },
  });
  await fixture.manager.scaleBotStatefulSet('WAPI-TEST01', 0);
  assert.equal(fixture.calls.replaced[0]?.spec?.replicas, 0);
  await assert.rejects(() => fixture.manager.scaleBotStatefulSet('WAPI-TEST01', 2));
});
