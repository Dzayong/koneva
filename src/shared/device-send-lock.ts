const tails = new Map<string, Promise<void>>();

/** Serialize the final pacing decision and transport call per device process. */
export async function withDeviceSendLock<T>(deviceKey: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(deviceKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  tails.set(deviceKey, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (tails.get(deviceKey) === current) tails.delete(deviceKey);
  }
}
