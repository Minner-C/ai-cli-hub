# AI CLI Hub

把各 AI CLI 的交互本身图形化的 Electron 桌面应用：**聊天式 GUI + 可随时切换底层 CLI 的任务线程**。支持 Kimi Code CLI、Claude Code、Gemini CLI、Codex CLI、Qwen Code、OpenCode、Aider（后三者按公开无头用法实现，未实测）。

## 架构：ACP 长连接（kimi）+ headless 调用（其他 CLI）+ 聊天 UI

**kimi 默认走 ACP（Agent Client Protocol）长连接**（设置页可关，回退 headless）：每任务一个长驻 `kimi acp` 进程，stdio 换行分隔 JSON-RPC 2.0（手写客户端 `electron/acpClient.ts`，不依赖 SDK）。实测能力（探针 `scripts/probe-acp.cjs`）：

- `agent_thought_chunk`：token 级思考流（headless 拿不到的思考过程由此解决）
- `tool_call(pending) → tool_call_update(in_progress, 参数增量) → completed/failed`：工具运行过程实时可见
- `agent_message_chunk`：token 级正文流
- `session/new` 返回 configOptions：model（4 个模型可选）、thinking（thought_level，k3 仅 on）、mode（default/plan/auto/yolo）——模型/思考切换走 `session/set_config_option`，不再需要临时改写 config.toml（headless fallback 路径仍保留该机制）
- `session/load` 恢复历史会话；`session/cancel` 接停止按钮；plan 更新映射为 TodoList 清单

其他 CLI 仍为 headless 一次性调用（见下表）。

### headless 适配器（非 kimi 或 kimi fallback）

不再是终端模拟器。GUI 以子进程方式调用各 CLI 的**非交互（headless）模式**，逐行解析结构化输出（stream-json / JSONL），渲染为对话界面：

| CLI | 首轮 | 续轮 | 输出解析 |
| --- | --- | --- | --- |
| Kimi Code CLI | `kimi -p "<msg>" --output-format stream-json` | `kimi -r <sessionId> -p "<msg>" --output-format stream-json` | `{"role":"assistant","content":...}` / `tool_calls` / `{"role":"meta","type":"session.resume_hint","session_id":...}` |
| Claude Code | `claude -p "<msg>" --output-format stream-json --verbose` | 加 `--resume <sessionId>` | `system.init` / `assistant.message.content[]`（text / tool_use）/ `user`(tool_result) / `result` |
| Gemini CLI | `gemini -p "<msg>" --output-format json` | — | 一次性 JSON `{response}`（**未实测**） |
| Codex CLI | `codex exec "<msg>" --json --skip-git-repo-check` | — | item 事件流（**未实测**） |
| Qwen Code | `qwen -p "<msg>" --output-format json` | — | 复用 gemini 解析（**未实测**） |
| OpenCode | `opencode run "<msg>"` | — | 纯文本流（**未实测**） |
| Aider | `aider --message "<msg>" --yes-always` | — | 纯文本流（**未实测**） |

主进程 `electron/headlessManager.ts` 按任务线程 spawn 上述命令，把 JSONL 解析成统一事件流（`delta` / `tool_call` / `tool_result` / `session` / `done` / `error`），经 IPC 推给渲染进程。

## 任务线程模型

- 一个「任务」= 项目目录 + 消息历史 + 当前 CLI + `cliSessions`（各 CLI 各自的会话 id 映射）
- 同一 CLI 内续轮用对应 session id 恢复上下文（kimi 的 session 与 cwd 绑定，任务模型天然契合）
- **切换 CLI**：先用当前 CLI 无头生成摘要（约 200 字：进展/关键决定/已改文件/待办），界面预览确认后，摘要 + 项目目录作为新 CLI 首条消息的前缀注入；摘要以系统消息形式留在对话里
- 任务元数据与消息历史经 electron-store 持久化，重启应用后任务还在、可继续

## 功能

- 消息气泡：用户 / AI（react-markdown + highlight.js 代码高亮）/ 系统消息
- 工具调用折叠块：工具名 + 状态（运行中/完成/出错），可展开看参数与结果
- 流式渲染 + 生成中「停止」按钮（kill 子进程）
- Enter 发送、Shift+Enter 换行
- 顶栏：当前 CLI 标识 + 切换 CLI + 项目目录
- 中/英文 UI + 中文/英文原生菜单、明暗/跟随系统主题、CLI 安装检测与自定义路径

### 供应商切换（CC Switch 等价能力，设置页「供应商」tab）

让 CLI 通过 Anthropic / OpenAI 兼容端点使用其他家大模型（机制同 [CC Switch](https://github.com/farion1231/cc-switch)：注入 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` 或 `OPENAI_BASE_URL`/`OPENAI_API_KEY`）：

- claude 预设：Anthropic 官方、GLM (z.ai)、DeepSeek、Qwen、Kimi (Moonshot)、自定义
- codex 预设：OpenAI 官方、DeepSeek、GLM、自定义
- key 经 safeStorage 加密存储；优先级：供应商预设 > 应用内 key > 系统环境变量
- 检测到 `~/.claude/settings.json` 已有 env 配置（如 CC Switch 写入）时显示「外部配置」预设，**不会覆盖**
- 聊天页顶栏 CLI 徽章旁可一键切换当前预设

### 思考强度（输入栏工具栏）

关/低/中/高四档，按任务持久化。各 CLI 支持情况（调研结论）：

| CLI | 支持方式 |
| --- | --- |
| claude | 注入 `MAX_THINKING_TOKENS`（官方文档：0=关，默认 31999）→ 关/1024/8000/31999 |
| codex | 追加 `-c model_reasoning_effort=<minimal/low/medium/high>`（未实测） |
| kimi | spawn 前临时改写 `~/.kimi-code/config.toml` 的 `[thinking]`（关→`enabled=false`；低/中/高→`enabled=true, effort=<level>`），进程退出恢复原文 |
| 其他 | 置灰不支持 |

### 账号与密钥（设置页）

每个 CLI 一张卡片，包含：

- **状态检测**（优先级从高到低）：
  - 应用内密钥（「已配置（应用内密钥）」）
  - 进程环境变量（claude→`ANTHROPIC_API_KEY`、gemini→`GEMINI_API_KEY`、codex→`OPENAI_API_KEY`）
  - CLI 自身登录凭证文件：
    - kimi：`~/.kimi-code/credentials/kimi-code.json`（含 `access_token`）
    - claude：`~/.claude/.credentials.json`
    - gemini：`~/.gemini/oauth_creds.json` / `google_accounts.json`
    - codex：`~/.codex/auth.json`
- **API Key 管理**：password 输入 + 显示/隐藏切换 + 保存/清除。密钥经 **Electron safeStorage（Windows 上为 DPAPI）加密后 base64 存于本地 electron-store**，仅当前系统用户可解密。⚠️ 仍属本地可逆加密，请勿在共享/不受信机器上保存高权限密钥
- **密钥注入**：headless 子进程 spawn 时注入对应 env（应用内 key 优先于进程环境变量）；kimi 无通用 key env（走 OAuth），不注入
- **登录按钮**：经 `cmd /c start cmd /k <cli> login` 在系统终端窗口中拉起官方交互式登录（kimi 为设备码流程），完成后点「刷新状态」重新检测

### 模型管理与切换

- kimi：主进程执行 `kimi provider list --json` 实时获取 models（`{models: {"<provider>/<model>": {displayName}}}`）
- claude / gemini / codex：内置常见型号列表（无公开 list 命令）
- 模型选择器在输入卡片底部工具栏（pill 下拉样式）：任务级覆盖（持久化到任务），聊天中随时切换、下一条消息生效，spawn 时追加 `--model`（kimi/claude）或 `-m`（gemini/codex）；未选则用设置页「模型」tab 的 CLI 默认模型

### Skill 管理（设置页 Skills tab）

- kimi 扫描：`~/.kimi-code/skills`、`~/.agents/skills`（用户级）+ `<cwd>/.kimi-code/skills`、`<cwd>/.agents/skills`（项目级）；目录形式 `<name>/SKILL.md` 与平铺形式 `<name>.md`，解析 frontmatter name/description
- claude 扫描：`~/.claude/skills` + `<cwd>/.claude/skills`
- 支持启用/禁用（重命名 ± `.disabled` 后缀）、新建（SKILL.md 模板，用户级）、删除（有确认）、在编辑器打开（`shell.openPath`）
- gemini / codex 无 skill 机制，界面标注不支持
- **内置 skill**：kimi 为编译二进制、内置 skill 嵌入其中且无 list 命令，按官方文档 Built-in 一节硬编码（check-kimi-code-docs / update-config / write-goal）；claude 通过 `claude -p ... --output-format stream-json --verbose` 的 system.init 事件真实枚举（未登录也会发 init），失败时用实测兜底列表。内置项显示「内置」徽章，开关置灰（无官方禁用机制）
- 输入栏左侧 `＋` 按钮弹出面板：当前 CLI 的 Skills（内置/用户/项目）与 MCP 服务器列表，带启停开关，随 CLI 切换刷新

### MCP 管理（设置页 MCP tab）

| CLI | 配置文件 | 格式 |
| --- | --- | --- |
| kimi | `~/.kimi-code/mcp.json` | `{mcpServers: {name: {command,args,env \| url,transport,headers,enabled}}}` |
| claude | `~/.claude.json` | `mcpServers` 字段（保留其他顶层字段） |
| gemini | `~/.gemini/settings.json` | `mcpServers` 字段 |
| codex | `~/.codex/config.toml` | `[mcp_servers.<name>]` 表（smol-toml 解析-修改-写回） |

列表（名称/类型 stdio·http·sse/命令或 URL/启用状态）、新增/编辑对话框、启停开关、删除。修改写入配置文件后新会话生效，文件其他字段保留。

## CLI 安装前提

| CLI | 安装命令 | 无头模式前提 |
| --- | --- | --- |
| Kimi Code CLI | 见 https://github.com/MoonshotAI/kimi-cli | 已验证 ✅（需登录） |
| Claude Code | `npm install -g @anthropic-ai/claude-code` | 结构已验证（stream-json 需 `--verbose`）；本机未登录，真实问答未测 |
| Gemini CLI | `npm install -g @google/gemini-cli` | 适配器按公开用法实现，**未实测** |
| Codex CLI | `npm install -g @openai/codex` | 适配器按 `codex exec --json` 实现，**未实测** |

PATH 检测不到时，可在设置页填写自定义可执行文件路径。Windows 下 `.cmd` 包装自动经 `cmd.exe /c` 启动。

## 开发命令

```bash
npm install        # 安装依赖（无原生模块，纯 JS）
npm run dev        # 开发模式：vite dev server + electron
npm run build      # 类型检查 + vite 构建渲染层 + esbuild 编译主进程到 dist-electron/
npm run dist       # electron-builder 打包 Windows nsis 安装包（输出 release/）
```

解析器单元验证：`scripts/test-parsers.ts`（喂样例 JSONL 校验四个适配器 parseLine 输出）。

## 安全模型

- `contextIsolation: true`，`nodeIntegration: false`，全部 IPC 经 preload `contextBridge`
- headless `-p` 模式默认为 auto 权限，无需人工批准；Claude 未加 `--dangerously-skip-permissions`，工具调用遵循其默认权限策略

## UI 特性

- **工具调用卡片**：Read（文件卡片 + 语法高亮内容）、Write/Edit（行级 diff 红删绿增，diff 包计算，长上下文折叠）、Bash（终端风格块 + exit 徽标）、Glob/Grep（结果列表 + 计数）；状态用左侧色条 + 脉冲点表达（黄=运行中/绿=完成/红=失败）
- **文件预览**：工具卡片与结果列表中的路径可点击 → 右侧预览面板（文本语法高亮、图片预览、二进制提示，512KB 截断，可跳系统编辑器）
- **思考过程**：assistant 消息上方可折叠思考块（流式动画）。实测：kimi headless 的 stream-json 与 stderr 均不输出 thinking（协议预留）；claude 的 assistant content 支持 thinking block，解析器已实现
- **设计 token**：theme.css 统一间距/圆角/字号/阴影/语义色变量，明暗双主题；图标统一 lucide-react

### kimi 思考改写的安全机制与风险

- 改写前原文备份到内存 + electron-store（pendingRestore 标记）；finally 必恢复；**应用启动时自检标记并恢复**（防异常退出遗留）；多并发 kimi 调用经 Promise 队列串行化
- 改写用 smol-toml 解析-修改-写回（保留其他字段；实测：append 会造成重复表导致 kimi 报 Invalid configuration）
- ⚠️ 风险：改写窗口（秒级）内其他 kimi 会话 `/reload` 会读到临时值；窗口内应用被杀且启动自检失败时可能遗留改写（下次启动自愈）
- 实测：改写后 kimi 启动即读到新配置（以 Invalid configuration 实验证明读取时机），恢复后 config 完好

## 统一模型列表（选择即路由）

软件级模型列表：每项 = {显示名, 模型id, 执行CLI, 协议(native/anthropic/openai/gemini), baseURL, apiKey(safeStorage 加密)}。内置预填：kimi 官方（K3/K2.7）、claude 官方（Sonnet/Opus）、GLM（claude+anthropic+z.ai）、DeepSeek、Qwen 百炼、Kimi Moonshot。

- 对话输入栏模型下拉（截图风格）：分组（当前模型/当前 CLI 模型/其他模型）、品牌字母标、底部「添加模型」直达设置
- **选择即路由**：选中模型 → 任务自动切到对应 CLI（各 CLI session 独立保留）→ spawn 注入对应 `ANTHROPIC_BASE_URL/AUTH_TOKEN` 或 `OPENAI_BASE_URL/API_KEY` 与模型参数
- 设置页「模型与供应商」tab：列表管理（启停/编辑/删除）+ 添加对话框（显示名/执行 CLI/协议/baseURL/key/模型 id/品牌 + 测试连接按钮，最小请求实测）
- 旧「供应商」预设一次性迁移进统一列表（自定义预设与加密 key 不丢）；「模型」tab 已移除（模型在对话中直接选）

## 设置页结构（两级导航）

通用 / 账号与密钥 / 供应商 / 模型 / Skills / MCP / 用量 / **CLI 设置**（分组，下挂每个 CLI）。

每个 CLI 的设置分区三块：
- **版本与更新**：当前版本（`cli --version` 实测）+「检查更新」（npm 系 `npm view` 比对）+「执行更新」（系统终端弹窗跑 `kimi upgrade` / `npm update -g` / `pip install --upgrade aider-chat`）；未安装显示安装指引
- **常用设置表单**：kimi（config.toml：default_model / default_permission_mode / default_plan_mode / telemetry / thinking.enabled / thinking.effort / loop_control.*）；claude/gemini（model）；codex（model / model_reasoning_effort）；其余 CLI 走高级编辑
- **高级原文编辑**：配置文件全文 textarea，保存前语法校验（报错带行号）、自动备份 .bak、可从备份恢复；解析-修改-写回保留其他字段
- 有任务生成中禁止保存（避免与 kimi 临时改写等机制冲突）

## 用量统计

- **数据来源（实测探测结论）**：claude 为 stream-json `result.usage` 真实值（含 cache tokens）；kimi ACP 的 prompt 响应仅 `{stopReason}`、`kimi web` REST 66 个端点无任何 usage/quota/membership 接口（已核实 `openapi.json`），故 kimi/gemini/codex 等为**估算**（字符数/4，UI 标注）
- **三处展示**：每轮 done 追加轻量系统行「本轮消耗 ↑x ↓y tokens」；侧边栏任务条目累计用量小字 + hover 按 CLI/模型明细悬浮层；设置页「用量」tab（总览卡片 + 按 CLI/模型/项目分组表 + 近 7 天纯 CSS 柱状图）
- **上下文占用**：输入卡片上方进度条 + 百分比（估算：消息字符数/4 vs 内置窗口表 k3=1M / claude=200k 等，>80% 警示色）
- **会员信息**：kimi/claude/gemini/codex 本地均无会员/额度查询接口（kimi web REST 已核实无此端点），账号卡片明确标注「会员信息暂不支持查询」，不造假数据

## 已知限制

- Gemini / Codex 适配器未在本机验证（未安装），设置页显示「未安装」，不阻塞其他 CLI
- kimi/claude 的 assistant 输出按「增量或累积快照」两种形态兼容处理；若某 CLI 输出形态变化可能出现文本重复
- Claude 本机未登录，真实多轮对话未端到端验证
- kimi thinking 文本：stream-json 模式 stderr 为空（实跑验证）；**text 模式 stderr 确有思考**（• 前缀 transcript 风格，已实捕验证）——设置页「kimi 显示思考过程（实验）」开启后 kimi 走 text 模式解析（stderr→thinking 事件，stdout→正文），默认关闭（stream-json 工具卡片体验更好）；思考强度开关可用（临时改写机制）
- GBK 乱码定性：「锟斤拷」= U+FFFD(EF BF BD) 被 GBK 二次解码的产物（已用 iconv 双向验证：2×U+FFFD 的 UTF-8 字节按 GBK 解码恰为「锟斤拷」），**原始字节已永久丢失，任何下游处理无法还原**。展示层把连续乱码字符折叠为单个 �。系统级根治：Windows 区域设置开启「Beta 版: 使用 Unicode UTF-8 提供全球语言支持」（需重启）；应用层无法预防（CLI 内部按 UTF-8 解码其子进程输出，无 env 可改）
- claude thinking 解析已实现但本机未登录，未经真实对话验证
- GUI 交互无法在无头环境验证；解析器、headless 链路（kimi 真实 spawn）均已实测
