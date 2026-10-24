const INTERNAL_MEDIA_ID = /^[0-9a-f-]{36}$/i;

function gateway(): string {
  return (process.env['API_GATEWAY_URL'] ?? 'http://api-gateway:8000').replace(/\/$/, '');
}

function adminKey(): string {
  const key = process.env['ADMIN_API_KEY'];
  if (!key) throw new Error('private_media_gateway_unavailable');
  return key;
}

export function isPrivateMediaId(value: string): boolean {
  return INTERNAL_MEDIA_ID.test(value);
}

export async function uploadPrivateMedia(deviceKey: string, bytes: Buffer, mime: string, fileName?: string): Promise<string> {
  const response = await fetch(`${gateway()}/internal/media/upload`, {
    method: 'POST',
    headers: {
      'x-admin-key': adminKey(), 'x-device-key': deviceKey,
      'x-media-type': mime, ...(fileName ? { 'x-file-name': fileName.slice(0, 180) } : {}),
      'content-type': 'application/octet-stream',
    },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`private_media_upload_http_${response.status}`);
  const result = await response.json() as { data?: { id?: unknown } };
  if (typeof result.data?.id !== 'string' || !INTERNAL_MEDIA_ID.test(result.data.id)) throw new Error('private_media_upload_invalid_response');
  return result.data.id;
}

export async function fetchPrivateMedia(deviceKey: string, id: string): Promise<Buffer> {
  if (!INTERNAL_MEDIA_ID.test(id)) throw new Error('private_media_invalid_id');
  const response = await fetch(`${gateway()}/internal/media/${id}`, {
    headers: { 'x-admin-key': adminKey(), 'x-device-key': deviceKey },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`private_media_download_http_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
