import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import type { Storage } from './storage.js';

// Small and large enough for list rows and profile pages. Clients never download the original.
export const AVATAR_SIZES = [64, 256] as const;

export function avatarVariantKey(key: string, size: number): string {
  return `${key}/${size}.webp`;
}

/**
 * Makes the fixed-size square copies of an uploaded avatar. Avatars are at most a few MB, so
 * reading one into memory is fine. Throws if the bytes are not a decodable image.
 */
export async function resizeAvatar(storage: Storage, key: string): Promise<void> {
  const object = await storage.client.send(
    new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
  );
  const original = Buffer.from(await object.Body!.transformToByteArray());

  for (const size of AVATAR_SIZES) {
    const resized = await sharp(original)
      .rotate() // apply the EXIF orientation, then strip metadata (location!) on output
      .resize(size, size, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: avatarVariantKey(key, size),
        Body: resized,
        ContentType: 'image/webp',
      }),
    );
  }
}
