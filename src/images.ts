import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { VisionError } from './vision.js';

export interface ImageReader {
  resolve(path: string): Promise<string>;
  stat(path: string): Promise<{ type: string; size?: number } | undefined>;
  readBytes(path: string, maxBytes: number): Promise<Uint8Array>;
}

export interface PreparedImage {
  dataUrl: string;
  sha256: string;
  name: string;
}

/** Identify bytes, never trust a filename or caller-provided MIME type. */
export function imageMime(bytes: Uint8Array): string {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 33 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      b.readUInt32BE(8) === 13 && b.toString('ascii', 12, 16) === 'IHDR' &&
      b.readUInt32BE(16) > 0 && b.readUInt32BE(20) > 0) return 'image/png';
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[3] !== 0) return 'image/jpeg';
  if (b.length >= 20 && b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(b.toString('ascii', 12, 16))) {
    return 'image/webp';
  }
  throw new VisionError('UNSUPPORTED_IMAGE', '仅支持 PNG、JPEG、WebP 图片；文件头无效或格式不支持。请先导出为 PNG。');
}

/** Host adapters keep all reads inside the harness filesystem permission seam. */
export async function loadImages(
  paths: string[],
  reader: ImageReader,
  limits: { maxImageBytes: number; maxImages: number },
): Promise<PreparedImage[]> {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > limits.maxImages) {
    throw new VisionError('IMAGE_COUNT', `请提供 1 到 ${limits.maxImages} 张图片。`);
  }
  const images: PreparedImage[] = [];
  for (const path of paths) {
    if (typeof path !== 'string' || !path.trim() || path.length > 4096 || path.includes('\0') ||
        /^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^(data|file):/i.test(path)) {
      throw new VisionError('IMAGE_PATH', '请提供本地图片路径，不接受网址或 data URL。');
    }
    const target = await reader.resolve(path);
    const stat = await reader.stat(target);
    if (!stat || stat.type !== 'file') {
      throw new VisionError('IMAGE_NOT_FOUND', '图片不存在或不是普通文件，请检查文件路径与访问权限。');
    }
    if (stat.size !== undefined && stat.size > limits.maxImageBytes) {
      throw new VisionError('IMAGE_TOO_LARGE', `单张图片不能超过 ${Math.floor(limits.maxImageBytes / 1024 / 1024)} MB。`);
    }
    // Read one extra byte so a growing file or a stat-less adapter cannot silently truncate.
    const bytes = await reader.readBytes(target, limits.maxImageBytes + 1);
    if (bytes.byteLength > limits.maxImageBytes) {
      throw new VisionError('IMAGE_TOO_LARGE', '图片超过大小限制，请压缩后重试。');
    }
    const mime = imageMime(bytes);
    images.push({
      name: basename(target.replaceAll('\\', '/')),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
    });
  }
  return images;
}
