# 选题依据：视觉增强插件

核实日期：2026-11-26（北京时间）。本项目选择为 DeepSeek Harness 增加图片理解、OCR 与截图问答能力，依据是相关开源项目已有较明显的使用热度；这不是对新插件未来排名的承诺。

社区入口参考 [DSH 社区目录](https://www.dsharness.io/en) 和 [awesome-dsh-plugins](https://github.com/dshworks/awesome-dsh-plugins)，再到具体仓库和 npm 官方接口核对指标。目录中的部分条目指向大型项目的子插件，共享主仓库 Stars，不能直接当成插件独立热度比较；目录缓存日期也可能落后于查询日。

## 核实数据

GitHub Stars 来自当日仓库 API；npm 下载来自官方 `last-month` 接口，其实际返回窗口为 **2026-10-26 至 2026-11-24**。

| 项目 | 方向 | GitHub Stars | 窗口内 npm 下载 |
| --- | --- | ---: | ---: |
| [ModLens](https://github.com/liustack/modlens) | 视觉增强 | 5,084 | 341,082 |
| [ModSearch](https://github.com/liustack/modsearch) | 联网搜索 | 1,044 | 88,503 |
| [AnySearch DSH](https://github.com/anysearch-team/anysearch-dsh) | 联网搜索 | 708 | 16,319 |
| [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) | 视觉路由与图像工具 | 1,303 | 未核实 |
| [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 侧边栏工作台 | 5,336 | 未核实 |

原始数据：

- GitHub：[ModLens](https://api.github.com/repos/liustack/modlens)、[ModSearch](https://api.github.com/repos/liustack/modsearch)、[AnySearch](https://api.github.com/repos/anysearch-team/anysearch-dsh)、[vision-router](https://api.github.com/repos/ysr666/dsh-vision-router)、[better-sidebar](https://api.github.com/repos/omdsh-dev/DSH-better-sidebar)。
- npm：[ModLens](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-24/@liustack/modlens)、[ModSearch](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-24/@liustack/modsearch)、[AnySearch](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-24/@anysearch/anysearch-dsh)。链接使用固定日期保留本次统计窗口。

## 判断与定位

在上述功能类项目的比较中，视觉增强具有较强需求信号：ModLens 的关注量和包下载量均高于所比较的搜索插件，另有独立视觉项目获得关注。首版因此聚焦图片理解、文字提取和截图分析，并通过可配置的兼容接口支持云端视觉模型或本地服务。

定位是轻量、透明、适合中文使用的 DSH 原生插件。提供明确的配置与诊断、受约束的图片读取、请求时限和缓存；是否具备某项能力，以实际实现和测试为准。插件不会凭空赋予文本模型视觉能力，仍需一个可用的视觉推理服务。

## 数据边界

- 这不是全生态排名，不能据此宣称本项目或视觉插件是“全球最受欢迎”。侧边栏等方向也有高关注项目。
- Stars 表示累计关注，下载包含升级、自动化和重复安装，均不等同独立用户或活跃用户。
- ModLens 和 ModSearch 同时支持其他宿主，下载量不能全部归因于 DeepSeek Harness。
- 这是有限样本的开发选题依据，没有进行用户付费意愿调查；数据会随时间变化。

## 本地视觉接口依据

[Ollama 官方兼容接口文档](https://docs.ollama.com/api/openai-compatibility)提供本地 `http://localhost:11434/v1/` 和 `/chat/completions` 视觉调用示例，示例模型为 `qwen3-vl:8b`。本地服务忽略客户端占位 API key；云端模型另有登录要求。用户仍需自行安装并运行 Ollama、下载兼容视觉模型，实际速度与内存需求取决于设备及模型。

[Ollama 官方视觉说明](https://docs.ollama.com/capabilities/vision)确认视觉模型接受图片和文本，并可执行描述、分类和图片问答。上述文档支持兼容接口的实现方向，并不代表本项目已经在用户机器上完成真实模型推理验证。
