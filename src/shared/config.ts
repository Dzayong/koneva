import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(8000),
  ADMIN_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),
  DOCKER_SOCKET: z.string().min(1).default('/var/run/docker.sock'),
  BOT_IMAGE: z.string().min(1).default('wa-bot:latest'),
  SESSION_PATH: z.string().min(1).default('./sessions'),
  MAX_MSG_PER_MINUTE: z.coerce.number().int().positive().default(2),
  MAX_MSG_PER_HOUR: z.coerce.number().int().positive().default(50),
  WARMUP_DAYS: z.coerce.number().int().nonnegative().default(7),
  DEVICE_MANAGER_URL: z.string().url().default('http://127.0.0.1:8001'),
  DEVICE_MANAGER_PORT: z.coerce.number().int().positive().max(65535).default(8001),
  BOT_DOCKER_NETWORK: z.string().min(1).default('docker_default'),
  SESSION_HOST_PATH: z.string().min(1).default('./sessions'),
  ORCHESTRATOR: z.enum(['auto', 'docker', 'kubernetes']).default('auto'),
  KUBERNETES_NAMESPACE: z.string().min(1).default('wa-gateway'),
  KUBERNETES_IN_CLUSTER: z.string().optional(),
  BOT_STORAGE_CLASS: z.string().optional(),
  BOT_SESSION_STORAGE_SIZE: z.string().min(1).default('1Gi'),
  SIGNUP_ENABLED: z.string().optional(),
  TRIAL_MAX_DEVICES: z.coerce.number().int().positive().default(1),
  TRIAL_QUOTA_MESSAGES: z.coerce.number().int().positive().default(200),
});

const environment = environmentSchema.parse(process.env);

const PLACEHOLDER_SECRET = /(your_|_here|changeme|change_me|secret_key|example|password)/i;

// Production must never boot with a guessable or template secret.
if (environment.NODE_ENV === 'production') {
  for (const [name, value] of [
    ['ADMIN_API_KEY', environment.ADMIN_API_KEY],
    ['JWT_SECRET', environment.JWT_SECRET],
  ] as const) {
    if (value.length < 32 || PLACEHOLDER_SECRET.test(value)) {
      throw new Error(`${name} is too weak for production (need 32+ random characters, no placeholder text)`);
    }
  }
}

const config = {
  env: environment.NODE_ENV,
  port: environment.PORT,
  adminApiKey: environment.ADMIN_API_KEY,
  database: { url: environment.DATABASE_URL },
  redis: { url: environment.REDIS_URL },
  jwt: {
    secret: environment.JWT_SECRET,
    expiresIn: environment.JWT_EXPIRES_IN,
  },
  docker: {
    socket: environment.DOCKER_SOCKET,
    botImage: environment.BOT_IMAGE,
    network: environment.BOT_DOCKER_NETWORK,
  },
  signup: {
    enabled: environment.SIGNUP_ENABLED !== 'false',
    trialMaxDevices: environment.TRIAL_MAX_DEVICES,
    trialQuotaMessages: environment.TRIAL_QUOTA_MESSAGES,
  },
  sessionPath: environment.SESSION_PATH,
  sessionHostPath: environment.SESSION_HOST_PATH,
  limits: {
    messagesPerMinute: environment.MAX_MSG_PER_MINUTE,
    messagesPerHour: environment.MAX_MSG_PER_HOUR,
    warmupDays: environment.WARMUP_DAYS,
  },
  deviceManager: {
    url: environment.DEVICE_MANAGER_URL,
    port: environment.DEVICE_MANAGER_PORT,
    orchestrator: environment.ORCHESTRATOR,
    kubernetes: {
      namespace: environment.KUBERNETES_NAMESPACE,
      inCluster: !environment.KUBERNETES_IN_CLUSTER
        ? Boolean(process.env.KUBERNETES_SERVICE_HOST)
        : environment.KUBERNETES_IN_CLUSTER === 'true',
      storageClassName: environment.BOT_STORAGE_CLASS,
      sessionStorageSize: environment.BOT_SESSION_STORAGE_SIZE,
    },
  },
} as const;

export default config;
