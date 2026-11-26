# 交付验证

验证日期：2026-11-26（北京时间）。

## 自动化检查

执行 `npm run check` 成功：TypeScript 类型检查、34 项测试、发行构建均通过。

| 范围 | 测试数量 | 重点 |
| --- | ---: | --- |
| 视觉引擎 | 14 | 兼容 API 请求、OCR/对比、缓存、凭据轮换、响应截断、过滤、取消、超时、重定向和响应限额 |
| Harness 集成 | 8 | 真实 Cordis / ToolsService、设置更新、宿主文件读取、凭据解析、工具卸载及运行中取消 |
| 图片读取 | 7 | 格式识别、顺序、内容哈希、文件和数量限制、宿主权限错误 |
| 独立 CLI | 5 | 诊断、凭据优先级、完整图片请求、目录边界和错误信息 |

模拟服务全部运行在本机，使用测试图片和测试凭据。没有调用付费模型服务。

## 本机 Harness 验证

本机 `dsh --version`：`0.2.2-rc.2`。

在项目专用 `.dsh-test` 目录设置独立 `DSH_HOME`，执行了以下验证：

1. 初始化 Web profile。
2. 通过 `dsh plugin --profile web add <本地 tgz>` 成功安装；profile bundle 列表出现 `dsh-qinghui-vision`。
3. `dsh --profile web --dump-config` 输出包含 `qinghui-vision` 插件节点。
4. 启动 `dsh web --host 127.0.0.1 --port 0 --no-open`，使用该测试实例生成的认证信息读取页面，收到 HTTP 200 和完整 HTML。
5. 关闭测试服务。用户的正常 `desktop` / `web` profile 未被修改。

pnpm 在独立 profile 安装时提示 peer dependency 警告；运行时由 Harness 提供对应核心服务，实际启动与 Cordis 注册测试通过。安装包明确声明兼容的核心 peer 版本。

## 尚未验证

- 用户未提供云端视觉凭据，本机也未安装可调用的 Ollama，因此尚未执行真实模型识图，不能据此评价 OCR 准确率。
- 未验证 Harness 的其他版本。
- 本文记录代码验证，不代表 npm 或第三方社区收录状态；发行包以 [GitHub Releases](https://github.com/qinghuidaqzp/dsh-qinghui-vision/releases) 为准。
