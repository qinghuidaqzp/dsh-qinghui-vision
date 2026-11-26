#!/usr/bin/env node
import { readFile, realpath, stat, open } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { isIP } from 'node:net';
import { loadImages, type ImageReader } from './images.js';
import { normalizeConfig, VisionEngine, VisionError, type VisionConfig } from './vision.js';

const HELP = `DeepSeek 看图助手 / dsh-qinghui-vision

用法：
  dsh-qinghui-vision doctor --config ./examples/ollama.json
  dsh-qinghui-vision analyze screenshot.png --config ./vision.json --prompt "解释这个报错"
  dsh-qinghui-vision analyze before.png after.png --mode compare --config ./vision.json

选项：
  --config <file>    JSON 配置文件（与插件设置字段一致）
  --mode <mode>      describe、ocr、compare，默认 describe
  --prompt <text>    想问图片的问题
  --root <path>      允许读取图片的目录，默认当前目录
  --help            显示帮助

环境变量：DSH_VISION_API_KEY、DSH_VISION_MODEL、DSH_VISION_BASE_URL
doctor 仅检查本地配置，不发送图片，不验证模型在线状态。
`;

async function localReader(rootPath: string): Promise<ImageReader> {
  const root = await realpath(resolve(rootPath));
  return {
    async resolve(path) {
      const target = await realpath(resolve(root, path));
      const rel = relative(root, target);
      if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
        throw new VisionError('IMAGE_PATH', '图片在允许目录之外。用 --root 明确指定图片所在的目录。');
      }
      return target;
    },
    async stat(path) {
      const info = await stat(path);
      return { type: info.isFile() ? 'file' : 'directory', size: info.size };
    },
    async readBytes(path, maxBytes) {
      const handle = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(maxBytes);
        let offset = 0;
        while (offset < maxBytes) {
          const { bytesRead } = await handle.read(buffer, offset, maxBytes - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        return buffer.subarray(0, offset);
      } finally { await handle.close(); }
    },
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { config: { type: 'string' }, mode: { type: 'string' }, prompt: { type: 'string' }, root: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help || !positionals.length) { console.log(HELP); return; }
  let input: Partial<VisionConfig> = {};
  if (values.config) {
    const parsed: unknown = JSON.parse(await readFile(values.config, 'utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('配置必须是 JSON 对象。');
    input = parsed as Partial<VisionConfig>;
  }
  if (process.env.DSH_VISION_MODEL) input.model = process.env.DSH_VISION_MODEL;
  if (process.env.DSH_VISION_BASE_URL) input.baseUrl = process.env.DSH_VISION_BASE_URL;
  const config = normalizeConfig(input);
  const engine = new VisionEngine(config);
  if (positionals[0] === 'doctor') {
    const issues: string[] = [];
    const url = new URL(config.baseUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const isLocal = hostname === 'localhost' || hostname === '::1' || (isIP(hostname) === 4 && hostname.startsWith('127.'));
    const apiKey = (config.apiKey !== undefined ? config.apiKey : process.env[config.apiKeyEnv || 'DSH_VISION_API_KEY'] || '').trim();
    if (!config.model.trim()) issues.push('请填写视觉模型的准确 model ID。');
    if (!isLocal && !apiKey) {
      issues.push(`请设置环境变量 ${config.apiKeyEnv || 'DSH_VISION_API_KEY'}；如配置文件中有空的 apiKey 字段，请删除它。`);
    }
    if (/[\r\n]/.test(apiKey)) issues.push('API Key 包含无效的换行字符。');
    console.log(JSON.stringify({
      status: issues.length ? 'needs_configuration' : 'configured',
      model: config.model || '(未设置)',
      endpoint: url.origin + url.pathname,
      localServer: isLocal,
      imageFormats: ['PNG', 'JPEG', 'WebP'],
      maxImages: config.maxImages,
      maxImageMiB: config.maxImageBytes / 1024 / 1024,
      issues,
      note: '仅检查本地配置；尚未请求服务或验证模型的视觉能力。',
    }, null, 2));
    process.exitCode = issues.length ? 1 : 0;
    return;
  }
  if (positionals[0] !== 'analyze') throw new Error('未知命令，请运行 dsh-qinghui-vision --help。');
  const mode = values.mode ?? 'describe';
  if (!['describe', 'ocr', 'compare'].includes(mode)) throw new Error('--mode 只能是 describe、ocr 或 compare。');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  try {
    const images = await loadImages(positionals.slice(1), await localReader(values.root ?? process.cwd()), config);
    const result = await engine.analyze({ images, mode: mode as 'describe' | 'ocr' | 'compare', prompt: values.prompt ?? '' }, controller.signal);
    console.log(JSON.stringify(result, null, 2));
  } finally { process.removeListener('SIGINT', cancel); }
}

main().catch((error: unknown) => {
  const code = error instanceof VisionError ? error.code : 'CLI_ERROR';
  // Provider errors are already sanitized. Never dump config, headers, or stack traces.
  const message = error instanceof VisionError ? error.message : '命令或本地文件读取失败，请检查参数、JSON 配置与图片访问权限。运行 --help 查看用法。';
  console.error(JSON.stringify({ error: code, message }));
  process.exitCode = 1;
});
