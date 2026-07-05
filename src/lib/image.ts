/**
 * Client-side avatar pipeline: center-crop to a square, resize to a
 * lightweight 128x128, encode as WebP (~a few KB). Keeps Supabase storage
 * tiny and avatar rendering free for in-game FPS.
 */
export const AVATAR_SIZE = 128;

export async function processAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");

    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Image encoding failed")),
        "image/webp",
        0.85
      )
    );
  } finally {
    bitmap.close();
  }
}
