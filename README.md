# AI CLI Hub

**A unified desktop GUI for AI coding CLIs** — chat-style interface on top of Kimi Code, Claude Code, Gemini CLI, Codex CLI, Qwen Code, OpenCode and Aider. Switch the underlying CLI mid-task without losing context.

把各 AI 编程 CLI 的交互本身图形化：聊天式界面、一个任务随时切换底层 CLI 并保留上下文。[中文说明](#简体中文)

Built with Electron + React + TypeScript.

---

## Features

- **Chat UI, not a terminal emulator** — streaming markdown, code highlighting, tool-call cards (diff view for edits, terminal block for shell, image inline preview), collapsible thinking stream
- **True streaming via ACP** (Kimi) — token-level thought/message chunks, live tool lifecycle, plan updates; other CLIs via headless `stream-json`
- **Turn-level navigation rail** — tick rail at the chat edge; hover to expand round titles, click to jump
- **Switch CLI mid-task** — a summary of the current conversation is generated, previewed, and injected into the new CLI's first message
- **Unified model registry** — add GLM / DeepSeek / Qwen / Moonshot etc. as first-class models; picking a model routes to the right CLI + endpoint automatically (CC-Switch-style, without touching CLI config files)
- **Per-CLI permission modes** — default (interactive approval cards in-app) / auto / yolo, adapted to each CLI's real mechanism (ACP `set_config_option`, CLI flags)
- **Skills & MCP management** — list/enable/disable/create skills; manage MCP servers for each CLI's native config format
- **File panel, Monaco editor & built-in browser** — project file tree with AI-change markers, code preview/edit (Monaco), image preview, web page preview
- **Usage stats** — per-turn token lines, per-task hover details, totals page with GitHub-style heatmap, donuts by CLI/model/project, time-range filter
- **Task management** — date groups, search, pin, rename, delete with undo, keep/discard file changes (git restore)
- **System notifications** for approvals and completed turns; zh/en UI; light/dark/system theme

## Supported CLIs

| CLI | Channel | Notes |
| --- | --- | --- |
| Kimi Code | **ACP** long-lived connection (default) / headless fallback | token-level streaming, thinking, permission, plan |
| Claude Code | headless `stream-json` (bidirectional) | permission prompts via `--permission-prompt-tool stdio` control protocol |
| Gemini CLI | headless json | untested on maintainer's machine |
| Codex CLI | headless json | untested |
| Qwen Code | headless json | auth via Coding Plan API key |
| OpenCode / Aider | headless text | untested |

Not-installed CLIs are shown as unavailable and never block the rest. One-click install for npm/pip-based CLIs is built in.

## Install & Run

Download / build the Windows package:

```bash
npm install
npm run dist        # electron-builder; release-v*/win-unpacked is directly runnable
```

Development:

```bash
npm run dev         # vite + electron dev mode
npm run build       # type-check + renderer bundle + main/preload bundle
```

Requirements: Node.js 20+, and at least one AI CLI installed and logged in (e.g. `kimi`, `claude`).

## Architecture

```
electron/                 main process
  acpClient.ts            hand-written ACP (JSON-RPC over stdio) client, per-task long-lived connection
  headlessManager.ts      per-CLI headless adapters, NDJSON -> unified event stream
  modelRegistry.ts        unified model entries + provider routing (env injection, safeStorage keys)
  permissionManager.ts    per-CLI permission mode mapping (ACP mode / CLI args / config file)
  taskStore.ts            task persistence (debounced writes)
  usageStore.ts           token usage records & aggregation
src/                      renderer (React + zustand + i18next)
  components/             chat view, tool cards, right panel (files/preview/browser), settings
```

Key design points:

- **Context isolation on, nodeIntegration off**; all IPC via a typed preload bridge
- **Secrets** (API keys) encrypted with Electron `safeStorage` (DPAPI on Windows)
- GBK/UTF-8 mojibake repair for Windows console output (both directions, conservative heuristics)

## Known limitations

- Kimi's ACP has no usage/token telemetry — Kimi token numbers are **estimates** (marked in UI); Claude's are real
- Gemini/Codex/Qwen/OpenCode/Aider adapters follow public docs but are untested on the maintainer's machine
- Some GBK bytes are destroyed upstream (U+FFFD) before we see them and cannot be recovered ("锟斤拷"); the system-level fix is Windows' "Beta: Unicode UTF-8" locale option
- NSIS installer build is flaky on the maintainer's machine; the app is deployed from `win-unpacked`

## License

MIT

---

## 简体中文

**AI CLI Hub 是一款把各 AI 编程 CLI 交互图形化的桌面应用**——聊天式界面，一个开发任务可随时切换底层 CLI 且不丢上下文。

### 功能一览

- **聊天界面而非终端模拟器**：流式 Markdown、代码高亮、工具调用卡片（编辑 diff 视图、命令终端块、图片内联预览）、可折叠的思考流
- **真流式（Kimi 走 ACP 协议）**：token 级思考/正文流、工具运行全生命周期、计划更新；其余 CLI 走 headless `stream-json`
- **轮次定位刻度轨**：聊天区右缘刻度，悬停展开轮次标题，点击跳转
- **任务中切换 CLI**：自动生成会话摘要、预览确认后注入新 CLI 首条消息
- **统一模型列表**：GLM / DeepSeek / 千问 / Moonshot 等添加为一等模型，选择即自动路由到对应 CLI 与端点（类似 CC Switch，但不改写 CLI 配置文件）
- **按 CLI 适配的权限模式**：默认（应用内审批卡片）/ 自动 / 全部允许
- **Skills / MCP 管理**：启停、新建、编辑，按各 CLI 原生配置格式读写
- **文件面板 + Monaco 编辑器 + 内置浏览器**：项目文件树（AI 改动标记）、代码预览编辑、图片预览、网页预览
- **用量统计**：每轮消耗、任务悬浮明细、总量页（热力图 + 按 CLI/模型/项目分布 + 时间筛选）
- **任务管理**：日期分组、搜索、置顶、重命名、删除可撤销、文件变更保留/还原（git）
- **系统通知**（审批请求、任务完成）；中英文界面；明暗主题

### 运行

```bash
npm install
npm run dev    # 开发模式
npm run dist   # 打包（release-v*/win-unpacked 可直接运行）
```

要求：Node.js 20+，至少安装并登录一个 AI CLI（如 `kimi`、`claude`）。

### 已知限制

- Kimi 的 ACP 不提供用量数据，其 token 数字为**估算**（界面有标注）；Claude 为真实值
- Gemini / Codex / 千问 / OpenCode / Aider 适配器按公开文档实现，未实测
- 部分 GBK 字节在上游已永久丢失（显示为「锟斤拷」）无法还原；根治方法是开启 Windows 区域设置里的「Beta 版：使用 Unicode UTF-8」
