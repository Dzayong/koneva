/** Scales an image file down to at most `max` px on its long side and returns plain base64 JPEG (no data: prefix). */
export async function resizeToJpegBase64(file: File, max = 640, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  // WhatsApp crops profile photos to a square, so centre-crop here to show exactly what will be used.
  const side = Math.round(Math.min(bitmap.width, bitmap.height) * scale);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung pengolahan gambar");
  const sx = (bitmap.width - Math.min(bitmap.width, bitmap.height)) / 2;
  const sy = (bitmap.height - Math.min(bitmap.width, bitmap.height)) / 2;
  const src = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, sx, sy, src, src, 0, 0, side, side);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
