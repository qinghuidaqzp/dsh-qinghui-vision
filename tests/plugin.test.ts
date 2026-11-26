import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { Context } from '@deepseek-ai/cordis';
import { ToolsService, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { FsTargetKey, FsVersion, type FsTarget } from '@deepseek-ai/dsh-fs';
import * as plugin from '../src/index.js';
import type { VisionConfig } from '../src/vision.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEioAAAAASUVORK5CYII=', 'base64');
interface CapturedRequest { path: string | undefined; authorization: string | undefined; body: any }
interface FsCall { operation: string; path?: string; cwd?: string; signal?: AbortSignal; maxBytes?: number }

async function harness(t: TestContext, options: {
  config?: Partial<VisionConfig>;
  handler?: (request: IncomingMessage, response: ServerResponse) => void;
  secret?: string;
} = {}) {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ path: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
    server.emit('captured');
    if (options.handler) return options.handler(request, response);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: '图片中有一个按钮。' } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'test-vision', allowLocalServer: true, ...options.config };
  let secret = options.secret;
  const credentialRefs: string[] = [];
  const fsCalls: FsCall[] = [];
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.provide('credentials', {
    async resolve(reference: string) {
      credentialRefs.push(reference);
      return secret === undefined ? undefined : { value: secret, source: 'test-store' };
    },
  } as unknown as Context['credentials']);
  ctx.provide('workingDirectory', {
    async ensure(_agent: unknown, signal: AbortSignal) {
      fsCalls.push({ operation: 'cwd', signal });
      return '/session/workspace';
    },
  } as unknown as Context['workingDirectory']);
  ctx.provide('fs', {
    async resolve(path: string, opts: { cwd?: string; signal: AbortSignal }): Promise<FsTarget> {
      fsCalls.push({ operation: 'resolve', path, ...opts });
      return { targetKey: FsTargetKey(`opaque:${path}`), displayPath: `/session/workspace/${path}` };
    },
    async stat(target: FsTarget, signal: AbortSignal) {
      fsCalls.push({ operation: 'stat', path: target.targetKey, signal });
      return { type: 'file', size: png.length, version: FsVersion('test-version') };
    },
    async readBytes(target: FsTarget, signal: AbortSignal, maxBytes: number) {
      fsCalls.push({ operation: 'read', path: target.targetKey, signal, maxBytes });
      return png;
    },
  } as unknown as Context['fs']);
  await ctx.plugin(SystemPrompt, {}).await();
  await ctx.plugin(ToolsService).await();
  const fiber = ctx.plugin(plugin, config);
  await fiber.await();

  function execute(name: string, args: unknown, signal = new AbortController().signal) {
    const tool = ctx.tools.get(name);
    assert.ok(tool, `tool ${name} is registered`);
    return tool.execute(args, { signal, agent: {} } as ToolRunContext) as Promise<{ text: string; model: string; cached: boolean; imageCount: number }>;
  }
  return { ctx, fiber, config, requests, fsCalls, credentialRefs, execute, setSecret(value: string | undefined) { secret = value; }, server };
}

test('real Cordis registry exposes valid native schemas, volatile settings, and cleans up on unload', async t => {
  const h = await harness(t);
  assert.deepEqual(h.ctx.tools.schemas().map(x => x.name), ['qinghui_vision_read_image', 'qinghui_vision_compare_images']);
  const effective = h.fiber.effectiveConfig as plugin.Config;
  assert.equal(effective.model.get(), 'test-vision');
  assert.equal(effective.apiKey.get(), undefined);
  assert.equal(effective.maxImageBytes.get(), 10485760);
  const readTool = h.ctx.tools.get('qinghui_vision_read_image')!;
  assert.deepEqual(readTool.parameters.required, ['file_path']);
  assert.deepEqual(readTool.output.schema.required, ['text', 'model', 'cached', 'imageCount']);
  await h.fiber.dispose();
  assert.deepEqual(h.ctx.tools.definitions(), []);
});

test('native OCR tool passes working directory, opaque filesystem targets, limits and cancellation signal', async t => {
  const h = await harness(t, { secret: 'resolved-test-key' });
  const result = await h.execute('qinghui_vision_read_image', { file_path: 'screen.png', mode: 'ocr', prompt: '提取文字' });
  assert.deepEqual(result, { text: '图片中有一个按钮。', model: 'test-vision', cached: false, imageCount: 1 });
  assert.deepEqual(h.credentialRefs, ['DSH_VISION_API_KEY']);
  assert.deepEqual(h.fsCalls.map(x => x.operation), ['cwd', 'resolve', 'stat', 'read']);
  assert.equal(h.fsCalls[1].cwd, '/session/workspace');
  assert.equal(h.fsCalls[2].path, 'opaque:screen.png');
  assert.equal(h.fsCalls[3].maxBytes, 10485761);
  assert.ok(h.fsCalls.every(x => x.signal instanceof AbortSignal));
  assert.ok(h.fsCalls.every(x => x.signal === h.fsCalls[0].signal));
  assert.equal(h.requests[0].path, '/v1/chat/completions');
  assert.equal(h.requests[0].authorization, 'Bearer resolved-test-key');
  assert.match(h.requests[0].body.messages[0].content, /逐字提取/);
  assert.equal(h.requests[0].body.messages[1].content[0].text, '提取文字');
  const output = h.ctx.tools.get('qinghui_vision_read_image')!.output;
  assert.deepEqual(output.render({}, result), [{ type: 'text', text: result.text }]);
});

test('comparison validates minimum count, reads images in order and gives one model request', async t => {
  const h = await harness(t);
  await assert.rejects(h.execute('qinghui_vision_compare_images', { file_paths: ['one.png'] }), { code: 'INVALID_ARGS' });
  assert.equal(h.fsCalls.length, 0);
  const result = await h.execute('qinghui_vision_compare_images', { file_paths: ['before.png', 'after.png'], prompt: '找出布局差异' });
  assert.equal(result.imageCount, 2);
  assert.deepEqual(h.fsCalls.filter(x => x.operation === 'resolve').map(x => x.path), ['before.png', 'after.png']);
  const content = h.requests[0].body.messages[1].content;
  assert.equal(content.filter((part: any) => part.type === 'image_url').length, 2);
  assert.equal(content[1].text, '图片 1');
  assert.equal(content[3].text, '图片 2');
});

test('credentials resolve each call, account changes clear cache, live model config takes effect', async t => {
  const h = await harness(t, { secret: 'first-key' });
  const args = { file_path: 'image.png' };
  assert.equal((await h.execute('qinghui_vision_read_image', args)).cached, false);
  assert.equal((await h.execute('qinghui_vision_read_image', args)).cached, true);
  assert.equal(h.requests.length, 1);
  h.setSecret('second-key');
  assert.equal((await h.execute('qinghui_vision_read_image', args)).cached, false);
  assert.equal(h.requests[1].authorization, 'Bearer second-key');
  await h.fiber.update({ ...h.config, model: 'different-vision' });
  assert.equal((h.fiber.effectiveConfig as plugin.Config).model.get(), 'different-vision');
  assert.equal((await h.execute('qinghui_vision_read_image', args)).model, 'different-vision');
  assert.equal(h.requests[2].body.model, 'different-vision');
  assert.equal(h.credentialRefs.length, 4);
});

test('missing host credential never falls back to process environment and fails before file read', async t => {
  const variable = 'DSH_VISION_PLUGIN_TEST_KEY';
  const old = process.env[variable];
  process.env[variable] = 'must-not-be-used';
  t.after(() => { if (old === undefined) delete process.env[variable]; else process.env[variable] = old; });
  const h = await harness(t, { config: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: variable } });
  await assert.rejects(h.execute('qinghui_vision_read_image', { file_path: 'image.png' }), { code: 'API_KEY_REQUIRED' });
  assert.deepEqual(h.credentialRefs, [variable]);
  assert.equal(h.fsCalls.length, 0);
  assert.equal(h.requests.length, 0);
});

test('direct key takes precedence and provider errors retain actionable HarnessError codes', async t => {
  const h = await harness(t, {
    secret: 'unused-host-secret', config: { apiKey: 'explicit-key' },
    handler: (_request, response) => { response.writeHead(401); response.end('explicit-key should never escape'); },
  });
  await assert.rejects(h.execute('qinghui_vision_read_image', { file_path: 'image.png' }), error => {
    assert.equal((error as { code: string }).code, 'AUTH_FAILED');
    assert.doesNotMatch(String(error), /explicit-key|unused-host-secret/);
    return true;
  });
  assert.equal(h.credentialRefs.length, 0);
  assert.equal(h.requests[0].authorization, 'Bearer explicit-key');
});

test('caller cancellation reaches HTTP request and preserves caller abort reason', async t => {
  const h = await harness(t, { handler: () => {} });
  const controller = new AbortController();
  const started = once(h.server, 'captured');
  const pending = h.execute('qinghui_vision_read_image', { file_path: 'image.png' }, controller.signal);
  const reason = new Error('cancel requested by test');
  const rejected = assert.rejects(pending, error => error === reason);
  await started;
  controller.abort(reason);
  await rejected;
  assert.equal(h.fsCalls[0].signal?.aborted, true);
});

test('plugin unload cancels in-flight inference and unregisters tools', async t => {
  const h = await harness(t, { handler: () => {} });
  const started = once(h.server, 'captured');
  const pending = h.execute('qinghui_vision_read_image', { file_path: 'image.png' });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started;
  await h.fiber.dispose();
  await rejected;
  assert.deepEqual(h.ctx.tools.definitions(), []);
});
