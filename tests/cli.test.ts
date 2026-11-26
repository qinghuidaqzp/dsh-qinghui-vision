import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { once } from 'node:events';

const runFile = promisify(execFile);
const cli = resolve('src/cli.ts');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEioAAAAASUVORK5CYII=', 'base64');
async function run(args: string[], env: Record<string, string> = {}) {
  try {
    const result = await runFile(process.execPath, ['--import', 'tsx', cli, ...args], {
      timeout: 10_000,
      env: { ...process.env, DSH_VISION_MODEL: '', DSH_VISION_BASE_URL: '', DSH_VISION_API_KEY: '', ...env },
    });
    return { code: 0, ...result };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

test('doctor reports missing model/key and accepts explicit local configuration', async () => {
  const missing = await run(['doctor']);
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.stdout).status, 'needs_configuration');
  const local = await run(['doctor', '--config', 'examples/ollama.json']);
  assert.equal(local.code, 0);
  assert.equal(JSON.parse(local.stdout).model, 'qwen3-vl:8b');
});

test('doctor matches runtime credential precedence, trims keys, and handles 127/8', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vision-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = join(dir, 'config.json');
  for (const apiKey of ['', '   ']) {
    await writeFile(config, JSON.stringify({ model: 'vision-test', apiKey }));
    const result = await run(['doctor', '--config', config], { DSH_VISION_API_KEY: 'private-env-key' });
    assert.equal(result.code, 1);
    assert.ok(!result.stdout.includes('private-env-key'));
  }
  await writeFile(config, JSON.stringify({ model: 'vision-test', baseUrl: 'http://127.0.0.2:11434/v1', allowLocalServer: true }));
  assert.equal((await run(['doctor', '--config', config])).code, 0);
});

test('CLI performs an end-to-end image request and returns structured output', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vision-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let payload: any;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    payload = JSON.parse(body);
    assert.equal(req.url, '/v1/chat/completions');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '测试图片包含一个像素。' } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address() as { port: number };
  const config = join(dir, 'config.json');
  await writeFile(config, JSON.stringify({ model: 'test-vl', baseUrl: `http://127.0.0.1:${address.port}/v1`, allowLocalServer: true }));
  await writeFile(join(dir, 'image.png'), png);
  const result = await run(['analyze', 'image.png', '--root', dir, '--config', config, '--mode', 'ocr']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).text, '测试图片包含一个像素。');
  assert.equal(payload.messages[1].content.filter((part: any) => part.type === 'image_url').length, 1);
});

test('CLI rejects symlinks escaping the allowed image directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vision-cli-'));
  const outside = await mkdtemp(join(tmpdir(), 'vision-outside-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  await writeFile(join(outside, 'image.png'), png);
  await symlink(join(outside, 'image.png'), join(dir, 'link.png'));
  const result = await run(['analyze', 'link.png', '--root', dir, '--config', 'examples/ollama.json']);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stderr).error, 'IMAGE_PATH');
});

test('invalid configuration does not echo secrets or produce stack traces', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vision-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = join(dir, 'bad.json');
  await writeFile(config, '{"apiKey":"do-not-echo-secret", bad-json');
  const result = await run(['doctor', '--config', config]);
  assert.equal(result.code, 1);
  assert.ok(!result.stderr.includes('do-not-echo-secret'));
  assert.equal(JSON.parse(result.stderr).error, 'CLI_ERROR');
});
