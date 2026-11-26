# Qinghui 看图助手 · Qinghui Vision

为 DeepSeek Harness 提供 **截图解读、文字提取、多图对比**。主模型通过两个原生工具调用你指定的视觉模型，再继续分析或编写代码。

首版参考 DSH 社区的热门视觉增强方向，独立实现，未复制 ModLens 的代码。选题数据和边界见 [社区调研](docs/market-research.md)。源码与安装包见 [GitHub Releases](https://github.com/qinghuidaqzp/dsh-qinghui-vision/releases)。

## 已实现

| 功能 | 用法 |
| --- | --- |
| 图片理解 | 解读截图、界面、图表，回答针对图片的问题 |
| OCR | 提取图片文字、标题及表格；模糊内容提示不确定 |
| 多图对比 | 按输入顺序比较设计稿、界面截图和前后变化 |
| 原生设置 | 在 Harness 插件配置中填写视觉服务、模型和凭据引用 |
| 本地模型 | 支持本机 Ollama 的兼容接口，无需云端 API Key |
| 结果缓存 | 相同图片内容、问题、模式、模型和凭据的重复请求复用内存结果 |
| 命令行诊断 | `dsh-qinghui-vision doctor` 检查配置；`analyze` 可独立运行 |

支持 PNG、JPEG、WebP；默认单张最多 10 MiB，每次最多 4 张。图片来自已保存的本地文件；首版不包含自动截屏或接管粘贴图片的输入框。识别准确率、表格还原和多图能力取决于配置的视觉模型。

## 安装

已针对 **DeepSeek Harness 0.2.2-rc.2** 的真实 Cordis / Tools / FileSystem API 开发。Harness 处于开发预览，其他版本尚未验证。

桌面版首次打开后会初始化 `desktop` profile；**完全退出 DeepSeek Harness 桌面版**，再安装预构建的发行包：

```sh
dsh plugin --profile desktop add "https://github.com/qinghuidaqzp/dsh-qinghui-vision/releases/download/v0.1.1/dsh-qinghui-vision-0.1.1.tgz"
```

如果使用 `dsh web` 启动的 Web 版，则使用独立的 `web` profile：

```sh
dsh plugin --profile web add "https://github.com/qinghuidaqzp/dsh-qinghui-vision/releases/download/v0.1.1/dsh-qinghui-vision-0.1.1.tgz"
```

也可以从 [v0.1.1 Release](https://github.com/qinghuidaqzp/dsh-qinghui-vision/releases/tag/v0.1.1) 下载 `.tgz`，将命令中的网址替换为下载文件的绝对路径。重启对应 Harness 实例，在插件设置中找到 `qinghui-vision` / 看图助手并配置。其他自定义 profile 使用对应名称；桌面版与 Web 版的插件配置彼此独立。本版本通过 GitHub Release 发行，未发布到 npm；安装无需 npm 账号。

插件包自带 `dsh.bundle` 和 `cordis.patch.yml`，安装时由 Harness 插件管理器挂载，无需手写工具注册配置。

### 从旧版升级

本项目原名 `dsh-vision-kit`。从 0.1.1 起使用唯一包名 `dsh-qinghui-vision`，GitHub 仓库同步更名，历史 Release 保留。请先记下旧插件的模型地址、模型 ID 和凭据引用，再完全退出桌面版后执行：

```sh
dsh plugin --profile desktop remove dsh-vision-kit
dsh plugin --profile desktop add "https://github.com/qinghuidaqzp/dsh-qinghui-vision/releases/download/v0.1.1/dsh-qinghui-vision-0.1.1.tgz"
```

重启后恢复配置。原生工具名改为 `qinghui_vision_read_image` 和 `qinghui_vision_compare_images`，独立 CLI 改为 `dsh-qinghui-vision`；`DSH_VISION_API_KEY` 等配置字段保持兼容。不要同时启用新旧两个版本。

## 配置视觉模型

### 方式一：本地 Ollama

先安装并启动 [Ollama](https://ollama.com/)，下载一个视觉模型，例如其[官方兼容接口文档](https://docs.ollama.com/api/openai-compatibility)中的模型：

```sh
ollama pull qwen3-vl:8b
```

在 Harness 插件设置中填写：

| 字段 | 值 |
| --- | --- |
| `baseUrl` | `http://localhost:11434/v1` |
| `model` | `qwen3-vl:8b` |
| `allowLocalServer` | `true` |
| `timeoutMs` | `120000`（首次加载可能较慢） |
| `apiKey` | 留空 |

本地模型需要相应的磁盘和内存。此插件不会自动安装 Ollama 或下载模型。

### 方式二：云端兼容视觉 API

1. 将 `baseUrl` 设置为服务商的 API 根地址，例如 `https://api.siliconflow.cn/v1`，不要包含 `/chat/completions`。
2. `model` 填写该服务商实际提供、且你的账户有权限调用的**视觉模型 ID**。普通文本模型不能识图。
3. 在 Harness 的凭据设置中保存 API Key，引用名使用 `DSH_VISION_API_KEY`，并将插件的 `apiKeyEnv` 设置为同名引用。也可以在插件的 `apiKey` 字段直接填写密钥；非空直接值优先。

Harness 内通过 `ctx.credentials` 解析凭据；独立 CLI 通过同名环境变量读取。CLI 不读取 Harness 的凭据存储。远程服务必须使用 HTTPS。

调用工具会把所选图片和问题发送到配置的视觉服务。费用由该服务商计算。本地 Ollama 配置则发送到本机地址。

## 在对话里使用

先把图片保存到当前工作区，再告诉 Harness：

> 用 qinghui_vision_read_image 看一下 `screenshots/error.png`，解释报错并给出排查步骤。

> 用 OCR 模式提取 `invoice.png` 上的所有文字，保留表格。

> 用 qinghui_vision_compare_images 比较 `before.png` 和 `after.png`，列出布局和文字差异。

工具接口：

```json
{"name":"qinghui_vision_read_image","arguments":{"file_path":"screenshot.png","mode":"describe","prompt":"这个页面有哪些可见问题？"}}
```

```json
{"name":"qinghui_vision_compare_images","arguments":{"file_paths":["before.png","after.png"],"prompt":"重点检查按钮位置和文字变化"}}
```

返回 `text`、`model`、`cached`、`imageCount`。Harness 工具卡展示文件位置；结果文本交给主模型继续处理。

## 独立命令行

构建后可直接运行，无需全局安装：

```sh
node dist/cli.js doctor --config examples/ollama.json
node dist/cli.js analyze screenshot.png --config examples/ollama.json --prompt "解释这个报错"
node dist/cli.js analyze invoice.png --config examples/ollama.json --mode ocr
node dist/cli.js analyze before.png after.png --config examples/ollama.json --mode compare
```

云端使用时复制 [examples/cloud.json](examples/cloud.json)，修改模型 ID。密钥建议通过终端环境变量 `DSH_VISION_API_KEY` 提供，不写入版本控制。`DSH_VISION_MODEL` 和 `DSH_VISION_BASE_URL` 可覆盖 JSON 配置中的相应字段。配置中的 `apiKey` 若为非空值则优先；CLI 中显式空的 `apiKey` 不会回退到环境变量，应删除该字段。

`doctor` 只检查本地配置，不联网、也不代表模型服务已经可用。`analyze` 才执行真实请求。CLI 默认只读取当前目录内的图片，解析符号链接后仍检查边界；用 `--root /图片所在目录` 明确设置允许目录。

## 配置参考

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `baseUrl` | `https://api.siliconflow.cn/v1` | 兼容 API 根地址 |
| `model` | 空 | 必填视觉模型 ID |
| `apiKeyEnv` | `DSH_VISION_API_KEY` | Harness 凭据引用 / CLI 环境变量名 |
| `apiKey` | 未设置 | 可选直接密钥 |
| `allowLocalServer` | `false` | 显式允许本机回环地址服务 |
| `timeoutMs` | `30000` | 包含响应体读取，范围 100–300000 ms |
| `maxImageBytes` | `10485760` | 单张字节上限，最大 30 MiB |
| `maxImages` | `4` | 最多图片数，范围 1–8 |
| `maxOutputTokens` | `2000` | 输出 token 上限，最大 32768 |
| `cacheTtlMs` | `300000` | 缓存有效期，设为 0 关闭 |
| `cacheMaxEntries` | `32` | 缓存结果数，设为 0 关闭 |

缓存仅存在于插件进程内，不保存图片或结果到磁盘；插件卸载、配置变化或重启时清空。缓存命中返回的是先前识别结果，并未重新调用模型。

## 故障排查

| 提示 | 处理 |
| --- | --- |
| `MODEL_REQUIRED` | 设置支持图像输入的模型 ID |
| `API_KEY_REQUIRED` / `AUTH_FAILED` | 检查凭据引用、Key、账户额度及模型权限 |
| `MODEL_OR_ENDPOINT_NOT_FOUND` | 检查根地址与模型名称 |
| `REQUEST_REJECTED` | 确认模型支持图片及 Chat Completions 格式 |
| `RATE_LIMITED` | 检查额度，稍后重试 |
| `TIMEOUT` | 确认本地模型已启动，或提高请求时限 |
| `UNSUPPORTED_IMAGE` | 先导出为 PNG、JPEG 或 WebP |
| `IMAGE_TOO_LARGE` | 压缩图片或适当调整字节限制 |
| `OUTPUT_TRUNCATED` | 提高 `maxOutputTokens` 或缩小识别区域；已有部分文字时结果会附带不完整提示 |
| `CONTENT_FILTERED` | 服务商过滤了响应，请检查输入与服务商规则 |

模型返回的文字属于外部数据，图片内的指令不应被当作系统指令执行。插件通过 Harness 的文件系统接口读取图片，保留宿主的文件权限与取消信号；CLI 使用独立目录限制。文件头检查用于识别格式，并非完整的图片解码校验。

## 从源码开发与验证

以下命令在 GitHub 源码检出目录执行，发行安装包不包含开发测试环境：

```sh
npm ci
npm run check
npm pack
```

测试使用本地模拟的兼容 API，覆盖图片和目录限制、CLI 完整调用、请求内容、缓存、认证与限流错误、重定向拒绝、超时、取消、响应大小以及真实 Cordis 插件注册和释放。未配置真实云端凭据或本地模型时，这些测试不证明实际 OCR 质量。

本次交付不修改用户现有 Harness 配置；测试使用独立环境。构建产物及本地安装包可直接交给 Harness 插件管理器。

MIT License。
