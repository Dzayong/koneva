import Redis from 'ioredis';

let client: Redis | undefined;

export function getRedisClient(url: string): Redis {
  if (!client) {
    client = new Redis(url, {
      maxRetriesPerRequest: null,
    });
  }
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
