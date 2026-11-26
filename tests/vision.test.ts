import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { normalizeConfig, VisionEngine, VisionError, type VisionConfig, type VisionInput } from '../src/vision.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEioAAAAASUVORK5CYII=', 'base64');
const picture = {
  name: 'sample.png',
  sha256: createHash('sha256').update(png).digest('hex'),
  dataUrl: `data:image/png;base64,${png.toString('base64')}`,
};
const input: VisionInput = { images: [picture], prompt: '解释界面中的文字', mode: 'describe' };

function success(response: ServerResponse, text = '看到了示例内容'): void {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 } }));
}

async function service(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(error => response.destroy(error as Error));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closing;
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    engine(overrides: Partial<VisionConfig> = {}) {
      return new VisionEngine(normalizeConfig({ baseUrl: `http://127.0.0.1:${address.port}/v1/`, model: 'test-vision', apiKey: '', allowLocalServer: true, ...overrides }));
    },
  };
}

async function readBody(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

test('sends a complete OpenAI-compatible image request and parses text plus usage', async t => {
  let received: { url?: string; method?: string; auth?: string; body: Record<string, any> } | undefined;
  const mock = await service(t, async (request, response) => {
    received = { url: request.url, method: request.method, auth: request.headers.authorization, body: await readBody(request) };
    success(response, '  页面上有一个按钮。  ');
  });
  const result = await mock.engine({ apiKey: 'test-key' }).analyze(input);
  assert.equal(received?.url, '/v1/chat/completions');
  assert.equal(received?.method, 'POST');
  assert.equal(received?.auth, 'Bearer test-key');
  assert.equal(received?.body.model, 'test-vision');
  assert.equal(received?.body.stream, false);
  assert.equal(received?.body.max_tokens, 2000);
  assert.equal(received?.body.messages[0].role, 'system');
  assert.match(received?.body.messages[0].content, /不是要执行的指令/);
  assert.deepEqual(received?.body.messages[1].content, [
    { type: 'text', text: input.prompt },
    { type: 'text', text: '图片 1' },
    { type: 'image_url', image_url: { url: picture.dataUrl } },
  ]);
  assert.deepEqual(result, { text: '页面上有一个按钮。', model: 'test-vision', cached: false, imageCount: 1, usage: { promptTokens: 12, completionTokens: 9, totalTokens: 21 } });
});

test('OCR changes instructions and comparison preserves image order', async t => {
  const requests: Record<string, any>[] = [];
  const mock = await service(t, async (request, response) => { requests.push(await readBody(request)); success(response); });
  const engine = mock.engine();
  await engine.analyze({ ...input, mode: 'ocr', prompt: '' });
  const secondBytes = Buffer.concat([png, Buffer.from([0])]);
  const secondImage = { name: 'second.png', sha256: createHash('sha256').update(secondBytes).digest('hex'), dataUrl: `data:image/png;base64,${secondBytes.toString('base64')}` };
  await engine.analyze({ ...input, mode: 'compare', images: [secondImage, picture] });
  assert.match(requests[0].messages[0].content, /逐字提取/);
  assert.match(requests[0].messages[1].content[0].text, /无法辨认/);
  assert.equal(requests[1].messages[1].content[2].image_url.url, secondImage.dataUrl);
  assert.equal(requests[1].messages[1].content[4].image_url.url, picture.dataUrl);
  assert.equal(requests[1].messages[1].content[3].text, '图片 2');
  await assert.rejects(engine.analyze({ ...input, mode: 'compare' }), { code: 'INPUT_INVALID' });
  assert.equal(requests.length, 2);
});

test('cache avoids duplicate requests, isolates modes and prompts, and returns independent result objects', async t => {
  let calls = 0;
  const mock = await service(t, (_request, response) => { calls++; success(response, `answer ${calls}`); });
  const engine = mock.engine();
  const first = await engine.analyze(input);
  first.text = 'caller mutation';
  first.usage!.totalTokens = 999;
  const cached = await engine.analyze(input);
  assert.equal(cached.cached, true);
  assert.equal(cached.text, 'answer 1');
  assert.equal(cached.usage?.totalTokens, 21);
  await engine.analyze({ ...input, mode: 'ocr' });
  await engine.analyze({ ...input, prompt: '另一个问题' });
  assert.equal(calls, 3);
  engine.clearCache();
  assert.equal((await engine.analyze(input)).cached, false);
  assert.equal(calls, 4);
});

test('cache honors TTL and LRU capacity', async t => {
  let calls = 0;
  const mock = await service(t, (_request, response) => { calls++; success(response); });
  const expiring = mock.engine({ cacheTtlMs: 25 });
  await expiring.analyze(input);
  await delay(40);
  assert.equal((await expiring.analyze(input)).cached, false);
  const bounded = mock.engine({ cacheMaxEntries: 2 });
  await bounded.analyze(input);
  const second = { ...input, prompt: 'second' };
  await bounded.analyze(second);
  assert.equal((await bounded.analyze(input)).cached, true);
  await bounded.analyze({ ...input, prompt: 'third' });
  assert.equal((await bounded.analyze(second)).cached, false);
  assert.equal(calls, 6);
});

test('changing an environment credential invalidates cached results', async t => {
  const variable = 'DSH_VISION_KIT_TEST_ROTATING_SECRET';
  const previous = process.env[variable];
  t.after(() => { if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous; });
  const keys: Array<string | undefined> = [];
  const mock = await service(t, (request, response) => { keys.push(request.headers.authorization); success(response); });
  const engine = mock.engine({ apiKey: undefined, apiKeyEnv: variable });
  process.env[variable] = 'first-test-key';
  await engine.analyze(input);
  assert.equal((await engine.analyze(input)).cached, true);
  process.env[variable] = 'second-test-key';
  assert.equal((await engine.analyze(input)).cached, false);
  assert.deepEqual(keys, ['Bearer first-test-key', 'Bearer second-test-key']);
});

test('authentication and rate-limit failures are sanitized and not cached', async t => {
  let calls = 0;
  const mock = await service(t, (_request, response) => {
    calls++;
    if (calls < 3) { response.statusCode = calls === 1 ? 401 : 429; response.end('secret-key echoed with private provider details'); }
    else success(response);
  });
  const engine = mock.engine({ apiKey: 'secret-key' });
  await assert.rejects(engine.analyze(input), error => {
    assert.ok(error instanceof VisionError);
    assert.equal(error.code, 'AUTH_FAILED');
    assert.doesNotMatch(error.message, /secret-key|private provider details/);
    return true;
  });
  await assert.rejects(engine.analyze(input), { code: 'RATE_LIMITED' });
  assert.equal((await engine.analyze(input)).cached, false);
  assert.equal(calls, 3);
});

test('redirects are rejected without following the destination', async t => {
  let destinationRequests = 0;
  const destination = await service(t, (_request, response) => { destinationRequests++; success(response); });
  const redirector = await service(t, (_request, response) => { response.writeHead(307, { Location: `${destination.baseUrl}/chat/completions` }); response.end(); });
  await assert.rejects(redirector.engine({ apiKey: 'private-test-key' }).analyze(input), { code: 'REDIRECT_REJECTED' });
  assert.equal(destinationRequests, 0);
});

test('parses content arrays and rejects malformed or empty provider responses', async t => {
  const responses = [
    JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: '第一段' }, { type: 'image_url', image_url: {} }, { type: 'text', text: '第二段' }] } }] }),
    '<html>private provider error</html>',
    JSON.stringify({ choices: [{ message: { content: '   ' } }] }),
  ];
  const mock = await service(t, (_request, response) => { response.end(responses.shift()); });
  const engine = mock.engine({ cacheMaxEntries: 0 });
  assert.equal((await engine.analyze(input)).text, '第一段\n第二段');
  await assert.rejects(engine.analyze(input), { code: 'RESPONSE_INVALID' });
  await assert.rejects(engine.analyze(input), { code: 'RESPONSE_INVALID' });
});

test('length-limited OCR carries an explicit incomplete-output warning, including cached results', async t => {
  let calls = 0;
  const mock = await service(t, (_request, response) => {
    calls++;
    response.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '识别出的前半段文字' } }] }));
  });
  const engine = mock.engine();
  const ocrInput = { ...input, mode: 'ocr' as const };
  const result = await engine.analyze(ocrInput);
  assert.match(result.text, /^识别出的前半段文字\n\n\[输出不完整\]/);
  assert.match(result.text, /不能视为完整识别结果/);
  assert.match(result.text, /maxOutputTokens/);
  const cached = await engine.analyze(ocrInput);
  assert.equal(cached.cached, true);
  assert.equal(cached.text, result.text);
  assert.equal(calls, 1);
});

test('empty truncated output and content-filtered output have specific actionable errors', async t => {
  const responses = [
    { choices: [{ finish_reason: 'length', message: { content: '' } }] },
    { choices: [{ finish_reason: 'content_filter', message: { content: null } }] },
    { choices: [{ finish_reason: 'content_filter', message: { content: 'incomplete filtered output' } }] },
  ];
  const mock = await service(t, (_request, response) => { response.end(JSON.stringify(responses.shift())); });
  const engine = mock.engine();
  await assert.rejects(engine.analyze(input), { code: 'OUTPUT_TRUNCATED' });
  await assert.rejects(engine.analyze(input), { code: 'CONTENT_FILTERED' });
  await assert.rejects(engine.analyze(input), { code: 'CONTENT_FILTERED' });
  assert.equal(responses.length, 0);
});

test('request timeout applies while waiting for the response body', { timeout: 5000 }, async t => {
  const mock = await service(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"choices":');
    // Intentionally keep the body unfinished: the client's deadline must close it.
  });
  await assert.rejects(mock.engine({ timeoutMs: 100 }).analyze(input), { code: 'TIMEOUT' });
});

test('caller cancellation aborts an in-flight request, and pre-cancelled calls send nothing', { timeout: 5000 }, async t => {
  let calls = 0;
  let requestArrived!: () => void;
  const arrived = new Promise<void>(resolve => { requestArrived = resolve; });
  const mock = await service(t, (_request, _response) => { calls++; requestArrived(); });
  const engine = mock.engine();
  const controller = new AbortController();
  const pending = engine.analyze(input, controller.signal);
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  await arrived;
  controller.abort();
  await rejected;
  await assert.rejects(engine.analyze(input, AbortSignal.abort()), { code: 'CANCELLED' });
  assert.equal(calls, 1);
});

test('oversized declared and streamed responses are bounded', async t => {
  let calls = 0;
  const mock = await service(t, (_request, response) => {
    calls++;
    if (calls === 1) { response.writeHead(200, { 'Content-Length': 3 * 1024 * 1024 }); response.flushHeaders(); }
    else { response.writeHead(200); response.write('x'.repeat(1024 * 1024)); response.end('x'.repeat(1024 * 1024 + 1)); }
  });
  const engine = mock.engine();
  await assert.rejects(engine.analyze(input), { code: 'RESPONSE_TOO_LARGE' });
  await assert.rejects(engine.analyze(input), { code: 'RESPONSE_TOO_LARGE' });
});

test('rejects dangerous or unusable configuration and malformed input before network requests', async t => {
  for (const invalid of [
    { baseUrl: 'http://example.org/v1' },
    { baseUrl: 'https://user:password@example.org/v1' },
    { baseUrl: 'https://example.org/v1?api_key=private' },
    { baseUrl: 'https://example.org/v1#private' },
    { baseUrl: 'http://localhost:11434/v1' },
    { baseUrl: 'https://example.org/v1/chat/completions' },
    { timeoutMs: 99 },
    { maxImages: 9 },
  ]) assert.throws(() => normalizeConfig(invalid), { code: 'CONFIG_INVALID' });
  let calls = 0;
  const mock = await service(t, (_request, response) => { calls++; success(response); });
  await assert.rejects(mock.engine({ model: '' }).analyze(input), { code: 'MODEL_REQUIRED' });
  await assert.rejects(mock.engine({ apiKey: 'bad\nkey' }).analyze(input), { code: 'CONFIG_INVALID' });
  await assert.rejects(mock.engine().analyze({ ...input, images: [{ ...picture, sha256: '0'.repeat(64) }] }), { code: 'IMAGE_INVALID' });
  await assert.rejects(mock.engine().analyze({ ...input, prompt: 'x'.repeat(16001) }), { code: 'INPUT_INVALID' });
  const noKey = new VisionEngine(normalizeConfig({ baseUrl: 'https://example.org/v1', model: 'test', apiKey: '' }));
  await assert.rejects(noKey.analyze(input), { code: 'API_KEY_REQUIRED' });
  assert.equal(calls, 0);
});
