import type { Agent } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/** Redacts credentials so a proxy URL can be logged safely. */
export function describeProxy(proxyUrl: string): string {
  const parsed = new URL(proxyUrl);
  return `${parsed.protocol}//${parsed.host}`;
}

export function createProxyAgent(proxyUrl: string | undefined): Agent | undefined {
  if (!proxyUrl) return undefined;
  const { protocol } = new URL(proxyUrl);
  if (protocol.startsWith('socks')) return new SocksProxyAgent(proxyUrl);
  if (protocol === 'http:' || protocol === 'https:') return new HttpsProxyAgent(proxyUrl);
  throw new Error(`Unsupported WA_PROXY_URL protocol: ${protocol}`);
}
