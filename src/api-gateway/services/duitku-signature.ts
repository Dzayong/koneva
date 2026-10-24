import { createHmac, timingSafeEqual } from 'node:crypto';

export function computeDuitkuRequestSignature(merchantCode: string, timestamp: string, apiKey: string): string {
  return createHmac('sha256', apiKey).update(`${merchantCode}${timestamp}`, 'utf8').digest('hex');
}

export function computeDuitkuCallbackSignature(merchantCode: string, amount: string, merchantOrderId: string, apiKey: string): string {
  return createHmac('sha256', apiKey).update(`${merchantCode}${amount}${merchantOrderId}`, 'utf8').digest('hex');
}

export function verifyDuitkuCallbackSignature(
  merchantCode: string,
  amount: string,
  merchantOrderId: string,
  apiKey: string,
  presented: string,
): boolean {
  if (!/^[a-f\d]{64}$/i.test(presented)) return false;
  const expected = Buffer.from(computeDuitkuCallbackSignature(merchantCode, amount, merchantOrderId, apiKey), 'hex');
  const actual = Buffer.from(presented, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
