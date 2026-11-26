import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageMime, loadImages, type ImageReader } from '../src/images.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEioAAAAASUVORK5CYII=', 'base64');
const limits = { maxImages: 4, maxImageBytes: 1024 };
function reader(bytes = png, reportedSize = bytes.length): ImageReader {
  return {
    resolve: async p => `/workspace/${p}`,
    stat: async () => ({ type: 'file', size: reportedSize }),
    readBytes: async (_p, max) => bytes.subarray(0, max),
  };
}

test('identifies by bytes, preserves order and hashes identical image content', async () => {
  const result = await loadImages(['first.txt', 'second.png'], reader(), limits);
  assert.deepEqual(result.map(x => x.name), ['first.txt', 'second.png']);
  assert.equal(result[0].dataUrl, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(result[0].sha256, result[1].sha256);
  assert.equal(result[0].sha256.length, 64);
});

test('rejects unsupported bytes, SVG and forged PNG extension', async () => {
  for (const bytes of [Buffer.from('<svg></svg>'), Buffer.from('pretend image'), Buffer.alloc(0), png.subarray(0, 8)]) {
    await assert.rejects(loadImages(['photo.png'], reader(bytes), limits), { code: 'UNSUPPORTED_IMAGE' });
  }
});

test('accepts JPEG and WebP signatures', () => {
  assert.equal(imageMime(Buffer.from([255, 216, 255, 224, 0, 16])), 'image/jpeg');
  const webp = Buffer.alloc(20);
  webp.write('RIFF'); webp.write('WEBP', 8); webp.write('VP8L', 12);
  assert.equal(imageMime(webp), 'image/webp');
});

test('rejects URLs, empty paths and NUL before any filesystem operation', async () => {
  const fs = reader();
  fs.resolve = async () => { throw new Error('must not read'); };
  for (const path of ['', '  ', 'https://example.org/image.png', 'file:/etc/passwd', 'data:image/png;base64,abc', 'a\0.png']) {
    await assert.rejects(loadImages([path], fs, limits), { code: 'IMAGE_PATH' });
  }
});

test('checks image count and refuses directories', async () => {
  await assert.rejects(loadImages([], reader(), limits), { code: 'IMAGE_COUNT' });
  await assert.rejects(loadImages(Array(5).fill('x.png'), reader(), limits), { code: 'IMAGE_COUNT' });
  const fs = reader();
  fs.stat = async () => ({ type: 'directory', size: 0 });
  await assert.rejects(loadImages(['folder'], fs, limits), { code: 'IMAGE_NOT_FOUND' });
});

test('enforces byte limit both before and after read, including a file growing after stat', async () => {
  const bytes = Buffer.concat([png, Buffer.alloc(1100)]);
  await assert.rejects(loadImages(['big.png'], reader(bytes), limits), { code: 'IMAGE_TOO_LARGE' });
  await assert.rejects(loadImages(['growing.png'], reader(bytes, 1), limits), { code: 'IMAGE_TOO_LARGE' });
});

test('preserves host filesystem permission failures without retry or alternate IO', async () => {
  const permissionError = new Error('permission denied by harness');
  const fs = reader();
  fs.readBytes = async () => { throw permissionError; };
  await assert.rejects(loadImages(['private.png'], fs, limits), e => e === permissionError);
});
