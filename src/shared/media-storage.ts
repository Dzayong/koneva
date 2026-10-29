import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import config from './config';

export const MEDIA_LIMITS = { image: 16 * 1024 * 1024, video: 64 * 1024 * 1024, audio: 16 * 1024 * 1024 } as const;
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp',
  'audio/ogg': '.ogg', 'audio/ogg; codecs=opus': '.ogg',
};

export function mediaTypeForMime(mime: string): 'image' | 'video' | 'audio' | undefined {
  const base = mime.split(';')[0]!.trim();
  if (base.startsWith('image/') && EXTENSIONS[base]) return 'image';
  if (base.startsWith('video/') && EXTENSIONS[base]) return 'video';
  if (base === 'audio/ogg') return 'audio';
  return undefined;
}

export function validMediaBytes(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/gif') return bytes.subarray(0, 6).toString('ascii').startsWith('GIF8');
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mime === 'video/mp4' || mime === 'video/3gpp') return bytes.length > 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  if (mime.startsWith('audio/ogg')) return bytes.length > 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS';
  return false;
}

function mediaPath(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid media ID');
  return path.join(config.mediaStoragePath, id);
}

export async function saveMedia(bytes: Buffer, mime: string): Promise<string> {
  const mType = mediaTypeForMime(mime);
  if (!mType || !validMediaBytes(bytes, mime)) throw new Error('Unsupported or invalid media');
  const limit = mType === 'image' ? MEDIA_LIMITS.image : mType === 'audio' ? MEDIA_LIMITS.audio : MEDIA_LIMITS.video;
  if (bytes.length === 0 || bytes.length > limit) throw new Error('Media exceeds the allowed size');
  const id = randomUUID();
  await mkdir(config.mediaStoragePath, { recursive: true, mode: 0o700 });
  await writeFile(mediaPath(id), bytes, { flag: 'wx', mode: 0o600 });
  return id;
}

export async function readMedia(id: string): Promise<Buffer> {
  return readFile(mediaPath(id));
}

export async function removeMedia(id: string): Promise<void> {
  await unlink(mediaPath(id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
}
