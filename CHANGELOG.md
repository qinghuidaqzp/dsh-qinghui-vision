# 更新记录

## 0.1.0 — 2026-11-26

首次发布 DeepSeek Harness 看图助手。

- 原生 `vision_read_image`：截图与图片理解、OCR。
- 原生 `vision_compare_images`：按顺序比较多张图片。
- 支持 OpenAI 兼容视觉接口和本机 Ollama。
- 中文插件设置、凭据引用、图片类型与大小限制。
- 内存缓存、取消、请求超时、响应截断与错误提示。
- 独立 CLI 配置诊断和图片分析。

兼容性：已验证 DeepSeek Harness 0.2.2-rc.2。34 项自动化测试通过，并在独立 Harness profile 完成安装和启动验证。真实识图需配置视觉模型，OCR 质量取决于该模型；其他 Harness 版本尚未验证。
