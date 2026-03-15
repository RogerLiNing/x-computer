# X-Computer 开发状态文档

本文档描述当前（v0.1.1）开发状态，作为下一步迭代的标准参考。最后更新：2026-02-24。

> **基础设施计划**：多用户支持与云端存储的详细设计见 [INFRASTRUCTURE_MULTIUSER_CLOUD.md](./INFRASTRUCTURE_MULTIUSER_CLOUD.md)。
> **需求管理**：所有功能需求以表格形式记录在 [REQUIREMENTS.md](./REQUIREMENTS.md)，含状态（待开发/开发中/已完成）与优先级（P0–P3）。提供新需求时会先评估并录入该表，再按优先级开发。

---

## 1. 项目概述

**X-Computer** 是一台「AI 驱动的自主电脑」系统：

- **默认体验**：Web 桌面 + 办公应用（文件、终端、浏览器、邮件、日历、表格、编辑器等），用户可像使用普通电脑一样操作。
- **AI 能力**：系统级 Agent 可执行四大域任务——聊天协作、编程开发、智能体任务、办公工作流；支持自动模式与审批模式切换。
- **隔离与治理**：默认容器级沙箱（文件系统、命令执行）；敏感任务可升级 VM；全链路审计（意图-动作-结果）。

**产品目标**：用户既可手动操作，也可将任务交给 AI 全流程执行，并在任务时间线中查看进度、审批、回放。

---

## 2. 当前版本与状态

| 项目 | 说明 |
|------|------|
| **版本** | 0.1.1 |
| **Monorepo** | npm workspaces：`shared`、`server`、`frontend` |
| **前端** | React 19 + TypeScript + Vite + Tailwind + Zustand，单页桌面应用 |
| **后端** | Node.js + Express + WebSocket，单进程；可选 SQLite 持久化（任务、审计、聊天会话、定时任务、用户配置等） |
| **状态** | MVP 已完成；前后端联通、四域工作流、沙箱 FS/Shell、X 定时/智能体/图片与多媒体生成、对话 UI 与多用户/云端存储已实现；R039 agent 独立目录、R040 日志东八区、R041 工作流引擎（workflow-engine、script/ai 回调、X 提示词指引）已完成；下一重点为 X 编程与制作 Skill/工具（R035）或小程序/小游戏创作增强（R023） |

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Frontend (React, port 3000)                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ Desktop     │  │ Window       │  │ Taskbar     │  │ 11 内置应用      │ │
│  │ ContextMenu │  │ Manager      │  │ StatusBar   │  │ (文件/终端/聊天  │ │
│  │ SearchLauncher│ │ LockScreen   │  │ Notifications│ │  代码/文本/表格  │ │
│  └─────────────┘  └──────────────┘  └─────────────┘  │  邮件/日历/设置  │ │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ Zustand Store │ useWebSocket │ useKeyboardShortcuts │ api (fetch)    ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    HTTP /api/*  +  WebSocket /ws
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                         Server (Express, port 4000)                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ api.ts      │  │ fs.ts       │  │ shell.ts    │  │ index.ts        │ │
│  │ 任务/模式   │  │ 沙箱文件系统  │  │ 沙箱命令    │  │ WS 连接与广播   │ │
│  │ 工具/策略   │  │ list/read/   │  │ POST /exec  │  │ init/task_event │ │
│  │ 审计/健康   │  │ write/mkdir  │  │             │  │ audit_entry     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
│         │                │                │                    │          │
│  ┌──────┴────────────────┴────────────────┴────────────────────┴────────┐ │
│  │ AgentOrchestrator │ TaskPlanner │ ToolExecutor │ PolicyEngine        │ │
│  │ AuditLogger      │ SandboxFS   │ SandboxShell │                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                         shared/src/index.ts (类型)
```

---

## 4. 模块清单与职责

### 4.1 前端 (frontend)

| 路径 | 职责 |
|------|------|
| `src/App.tsx` | 根组件；启动时检查登录状态（GET /api/users/me 判断 email），未登录则渲染 LoginScreen，否则渲染 Desktop |
| `src/components/auth/LoginScreen.tsx` | Mac 风格登录页：登录/注册 Tab、验证码、错误与限流提示；成功后回调进入 Desktop |
| `src/components/desktop/Desktop.tsx` | 桌面容器，挂载 WebSocket/快捷键，桌面右键菜单 |
| `src/components/desktop/WindowManager.tsx` | 窗口列表渲染 |
| `src/components/desktop/AppWindowFrame.tsx` | 单窗口：标题栏、拖拽、缩放、最小化/最大化、AI 接管按钮 |
| `src/components/desktop/Taskbar.tsx` | 任务栏：固定应用、运行中窗口、模式切换、通知、时钟 |
| `src/components/desktop/StatusBar.tsx` | 顶部状态栏：品牌、连接状态、模式、锁屏、时间 |
| `src/components/desktop/DesktopIcons.tsx` | 桌面图标，双击打开应用 |
| `src/components/desktop/NotificationCenter.tsx` | 通知气泡 |
| `src/components/desktop/ContextMenu.tsx` | 全局右键菜单 |
| `src/components/desktop/SearchLauncher.tsx` | Cmd+K 搜索启动器 |
| `src/components/desktop/LockScreen.tsx` | 锁屏界面 (Cmd+L) |
| `src/components/apps/AppContent.tsx` | 根据 appId 渲染对应应用 |
| `src/components/apps/FileManagerApp.tsx` | 文件管理器：列表/导航/新建/重命名/删除，展示宿主机沙箱路径并可复制（api.getWorkspacePath），调用 api.fs |
| `src/components/apps/TerminalApp.tsx` | 终端：命令历史、内置 help/clear/ai，真实命令走 api.shell |
| `src/components/apps/ChatApp.tsx` | AI 助手：会话列表与持久化、消息列表、最近 N 轮上下文、任务创建、普通对话走 Agent 流式（POST /chat/agent/stream）、工具调用可展开展示、Markdown 渲染、复制/重试/删除消息 |
| `src/components/apps/XApp.tsx` | X 主脑：与 X 直接对话（scene=x_direct）、工具调用与 Markdown 展示与 AI 助手一致、X 主动消息、定时任务与立即执行入口、查看任务时间线；当前对话仅内存，未持久化 |
| `src/components/apps/TaskTimelineApp.tsx` | 任务时间线：定时任务与执行记录合并展示、任务列表/详情、审批/拒绝/暂停/恢复、刷新选中任务、审计视图 |
| `src/components/apps/CodeEditorApp.tsx` | 代码编辑器：多标签、从 FS 打开文件、保存到沙箱 |
| `src/components/apps/TextEditorApp.tsx` | 文本编辑器：从 FS 打开/保存 |
| `src/components/apps/BrowserApp.tsx` | 浏览器：URL 栏、书签（模拟） |
| `src/components/apps/EmailApp.tsx` | 邮件：收件箱列表、阅读、AI 草拟（模拟） |
| `src/components/apps/SpreadsheetApp.tsx` | 表格：单元格编辑（模拟） |
| `src/components/apps/CalendarApp.tsx` | 日历：月视图、日程（模拟） |
| `src/components/apps/SettingsApp.tsx` | 设置：通用/AI/大模型配置（含「保存到云端」）/安全/运行时/多媒体 API/关于 |
| `src/store/desktopStore.ts` | Zustand：窗口/任务/审批/审计/通知/模式/上下文菜单/锁屏/搜索 |
| `src/hooks/useWebSocket.ts` | WebSocket 连接、init/task_event 等消息处理、与 store 同步 |
| `src/hooks/useKeyboardShortcuts.ts` | 全局快捷键：Cmd+W/L/M/T/N/K、Esc |
| `src/utils/api.ts` | 封装 fetch，调用 /api 下所有 REST 接口 |

### 4.2 后端 (server)

| 路径 | 职责 |
|------|------|
| `src/index.ts` | 创建 Express、挂载路由、创建 WSS、初始化 SandboxFS、启动 HTTP |
| `src/config/defaultConfig.ts` | 默认配置加载：从 .x-config.json 读取 llm_config 等，支持 `{env:VAR}` 占位符 |
| `src/routes/api.ts` | 任务 CRUD、暂停/恢复、审批/拒绝、模式、工具、策略、运行时、审计、健康 |
| `src/routes/fs.ts` | 沙箱文件系统：list / read / write / mkdir / delete / rename / stat |
| `src/routes/shell.ts` | 沙箱命令：POST /exec |
| `src/orchestrator/AgentOrchestrator.ts` | 任务生命周期、步骤循环、策略检查、审批挂起、事件广播 |
| `src/orchestrator/TaskPlanner.ts` | 按域生成步骤模板（chat/coding/agent/office） |
| `src/orchestrator/ToolExecutor.ts` | 内置工具：llm.generate、llm.analyze、llm.generate_image、**llm.generate_sound_effect**、**llm.generate_music**、skill.load、skill.install、skill.uninstall、skill.list_remote（SkillHub 搜索）、file.write/read/**tail**（读取末尾 N 行）/**replace**/**parse**（智谱解析 PDF/Word/Excel 等，解析后自动入向量库）/list、**office.create_docx/read_docx、office.create_xlsx/read_xlsx、office.create_pptx**（办公文档）、grep、shell.run、**sleep**、**python.run**、http.request、search.web；X 工具：**x.create_app**、**x.list_apps**（制作有界面小程序）、x.schedule_run（支持 **in_minutes**/**in_hours** 相对时间）、x.list_scheduled_runs、x.remove_scheduled_run；**signal.emit**、**signal.add_trigger**、**signal.list_triggers**、**signal.remove_trigger**（R037 信号/条件触发）；x.create_agent/list_agents/run_agent/update_agent/remove_agent、**x.create_team/list_teams/run_team**、**x.create_group/...**、x.notify_user、**x.send_email**（邮件通知）、**x.send_whatsapp**（WhatsApp，R052）、**x.check_email**（IMAP 收信，R042 邮件渠道）、**x.list_email_configs**、**x.set_email_config**、**x.delete_email_config**、**x.set_email_imap_config**、**x.list_email_imap_config**、**x.set_email_from_filter**、**x.list_email_from_filter**（收件箱与发件人过滤）；**x.list_mcp_config**、**x.add_mcp_server**、**x.update_mcp_server**、**x.remove_mcp_server**（MCP 配置管理）等。音效/音乐见 `src/audio/falAudio.ts`。信号触发见 `src/signals/signalService.ts`。 |
| `src/policy/PolicyEngine.ts` | 风险评分、审批门控、规则匹配 |
| `src/observability/AuditLogger.ts` | 内存审计日志，按任务/类型/时间查询，可广播新条目 |
| `src/audio/falAudio.ts` | fal.ai 队列 API：音效（cassetteai/sound-effects-generator）、音乐（cassetteai/music-generator）；配置来自用户配置 `audio_api_config` 或环境变量 FAL_KEY；llm.generate_music 仅使用 fal |
| `src/fileParser/zhipuFileParser.ts` | 智谱文件解析 API：PDF、Word、Excel、PPT 等解析为文本或结构化结果，供 file.parse 工具调用 |
| `src/tooling/SandboxFS.ts` | 基于目录的沙箱 FS，防路径穿越，启动时初始化示例目录与文件 |
| `src/tooling/SandboxShell.ts` | 子进程执行命令，工作目录限制在 workspace，超时与危险命令拦截 |

### 4.3 共享 (shared)

| 路径 | 职责 |
|------|------|
| `src/index.ts` | 统一导出类型：TaskDomain/TaskStatus/Task/TaskStep、ExecutionMode/RuntimeType、RiskLevel/PolicyRule/ApprovalRequest/AuditEntry、ToolDefinition/ToolCall、AppId/AppWindow/DesktopState/Notification、CreateTaskRequest/TaskEvent、WorkflowTemplate 等 |

---

## 5. 技术栈与依赖

| 层级 | 技术 | 版本/说明 |
|------|------|-----------|
| 包管理 | npm workspaces | shared, server, frontend |
| 前端 | React | 19.x |
| 前端 | TypeScript | 5.7 |
| 前端 | Vite | 6.x |
| 前端 | Tailwind CSS | 3.x |
| 前端 | Zustand | 5.x |
| 前端 | lucide-react | 图标 |
| 后端 | Node.js | 建议 18+ |
| 后端 | Express | 5.x |
| 后端 | ws | WebSocket |
| 后端 | uuid / cors | 工具 |
| 后端 | tsx | 开发时运行 TS |
| 共享 | 仅 TypeScript 类型 | 无运行时依赖 |

---

## 6. 目录结构（精简）

```
x-computer/
├── docs/
│   └── DEVELOPMENT.md          # 本文档
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   │   ├── desktop/        # 桌面壳、任务栏、窗口、菜单、锁屏、搜索
│   │   │   └── apps/           # 11 个应用组件
│   │   ├── hooks/               # useWebSocket, useKeyboardShortcuts
│   │   ├── store/               # desktopStore
│   │   ├── styles/              # global.css
│   │   └── utils/               # api.ts
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── package.json
├── server/
│   └── src/
│       ├── index.ts
│       ├── audio/              # falAudio（音效/音乐生成）
│       ├── orchestrator/       # AgentOrchestrator, TaskPlanner, ToolExecutor
│       ├── policy/             # PolicyEngine
│       ├── observability/      # AuditLogger
│       ├── tooling/            # SandboxFS, SandboxShell
│       └── routes/             # api, fs, shell
├── shared/
│   └── src/
│       └── index.ts            # 所有共享类型
├── package.json
└── README.md
```

---

## 7. 数据模型摘要（shared）

- **TaskDomain**: `'chat' | 'coding' | 'agent' | 'office'`
- **TaskStatus**: `pending | planning | running | awaiting_approval | paused | completed | failed | cancelled`
- **Task**: id, domain, title, description, status, steps[], createdAt, updatedAt, result?
- **TaskStep**: id, taskId, action, toolName, toolInput, status, output?, error?, riskLevel, startedAt?, completedAt?
- **ExecutionMode**: `'auto' | 'approval'`
- **RuntimeType**: `'container' | 'vm'`
- **RiskLevel**: `'low' | 'medium' | 'high' | 'critical'`
- **AppId**: 如 'file-manager' | 'terminal' | 'chat' | 'task-timeline' 等 11 个
- **AppWindow**: id, appId, title, x, y, width, height, isMinimized, isMaximized, isFocused, zIndex, metadata?
- **CreateTaskRequest**: domain, title, description, mode?
- **TaskEvent**: type (status_change | step_start | step_complete | step_error | approval_needed | task_complete), taskId, stepId?, data, timestamp
- **AuditEntry**: id, timestamp, taskId, stepId?, type, intent?, action?, result?, riskLevel?, metadata?

**大模型配置（LLM System Config）**：

- **LLMModality**: `'chat' | 'text' | 'video' | 'image' | 'vector'`
- **ModalityModelSelection**: providerId, modelId
- **LLMProviderConfig**: id, name, baseUrl?, apiKeyConfigured?
- **LLMSystemConfig**: providers[], defaultByModality: Record<LLMModality, ModalityModelSelection>

完整定义见 `shared/src/index.ts`。

### 7.1 默认配置文件 (.x-config.json)

首次进入系统时，若用户尚未配置 LLM 等，会使用默认配置。默认值来自 `.x-config.json`（参考 OpenClaw / OpenCode 的配置机制）。

**查找顺序**（按优先级）：

1. `X_COMPUTER_CONFIG_PATH` - 显式指定配置文件路径
2. `X_COMPUTER_WORKSPACE/.x-config.json` - 工作区根目录
3. `~/.x-computer/.x-config.json` - 用户主目录
4. `process.cwd()/.x-config.json` - 当前工作目录

**API Key 占位符**：支持 `{env:VAR_NAME}` 从环境变量读取，例如 `"apiKey": "{env:OPENAI_API_KEY}"`。

**Schema 示例**：见 `.x-config.example.json`。主要字段：

- `auth.allowRegister`：是否允许注册新账号，默认 `true`；设为 `false` 可关闭注册（仅登录）
- `llm_config.providers`：提供商列表（id, name, baseUrl, apiKey?）
- `llm_config.defaultByModality`：各模态默认模型（chat, text, video, image, image_edit, **vector**）。**vector** 用于记忆召回与工具描述语义检索，需对应 provider 有 baseUrl 和 apiKey
- `mcp_servers`：默认 MCP 服务器（联网搜索等），用户无 mcp_config 时生效；格式同 mcp-servers.json（servers 数组或 mcpServers 对象），headers 支持 `{env:VAR}`
- `email_smtp_config`：邮件 SMTP 配置（host, port, secure, user, pass, from?），供 x.send_email 工具使用；QQ 邮箱：smtp.qq.com、465、授权码
- `email_imap_config`：IMAP 收件箱配置（host, port, secure, user, pass）；QQ 邮箱：imap.qq.com、993
- `email_from_filter`：发件人过滤，仅处理来自指定邮箱的新邮件；可用 x.set_email_from_filter / x.list_email_from_filter 管理
- `email_processed_uids`：已处理的邮件 UID 列表（内部使用，用于 email_received 去重）
- `tool_loading_mode`：工具加载模式。`all`（默认）= 每次加载全部工具；`on_demand` = 仅预置 capability.search/capability.load，X 按需搜索并加载工具，可大幅减少系统提示 token。**工具描述向量库**：capability.search 在用户已配置向量嵌入时使用独立向量集合（`data/tool_vector_index.json`，与记忆向量库分离）做语义检索；工具增删改后下次搜索时自动同步索引。

**环境变量**：
- `X_COMPUTER_EMAIL_CHECK_INTERVAL_MS`：邮件检查间隔毫秒数，默认 60000（1 分钟）；设为 30000 可改为 30 秒
- `X_COMPUTER_TOOL_LOADING_MODE`：`all` 或 `on_demand`，覆盖 .x-config.json 中的 tool_loading_mode

用户可在设置页修改配置，修改后的值优先于默认配置并同步到云端。

---

## 8. API 参考

**Base URL**: `http://localhost:4000`（前端通过 Vite 代理 `/api` → `localhost:4000/api`）

### 8.1 任务与编排 (/api)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/tasks | 创建并执行任务。Body: `{ domain, title, description, mode?, llmConfig?, useLlmPlan? }`；`useLlmPlan: true` 且带 `llmConfig` 时用 LLM 生成步骤 |
| GET | /api/tasks | 获取所有任务。定时/触发产生的任务 metadata 含 `source`（scheduled_job / event_driven / run_now / signal_trigger）、`sourceId`（job.id / trigger.id） |
| GET | /api/tasks/:id | 获取单个任务 |
| POST | /api/tasks/:id/pause | 暂停任务 |
| POST | /api/tasks/:id/resume | 恢复任务 |
| POST | /api/tasks/:id/steps/:stepId/approve | 批准步骤 |
| POST | /api/tasks/:id/steps/:stepId/reject | 拒绝步骤 |
| GET | /api/mode | 获取执行模式 `{ mode }` |
| POST | /api/mode | 设置模式。Body: `{ mode: 'auto' | 'approval' }` |
| GET | /api/tools | 工具定义列表（含 python.run、x.create_app、x.list_apps、video.reference_to_video 等） |
| GET | /api/apps | X 制作的小程序列表（按用户隔离），返回 `{ apps: [{ id, name, path }] }` |
| GET | /api/apps/sandbox/:userId/apps/... | 提供小程序静态资源（路径式，推荐）。URL 含 userId，iframe 内相对引用 style.css、app.js 会带同一路径，子资源可正确鉴权；对 .html 自动注入运行时错误上报脚本；返回文件内容，Content-Type 按扩展名 |
| GET | /api/apps/sandbox | 提供小程序静态资源（查询式）。Query: `path`（必填，须以 apps/ 开头）、`userId`（可选，或 X-User-Id）；返回文件内容 |
| POST | /api/apps/sandbox-logs | 小程序运行时上报日志。Body: `appId`、`userId`（可选，须与当前用户一致）、`level`（error/warn/info）、`message`、`detail?`；iframe 内注入的脚本会 POST 控制台错误与未捕获异常 |
| GET | /api/apps/sandbox-logs | 获取指定小程序的最近运行时日志。Query: `appId`（必填）、`limit?`（默认 30）；X 排错请用工具 **x.get_app_logs** |
| GET / PUT / DELETE | /api/x-apps/backend/kv/:appId | 小程序后端 KV：GET 带 `?key=xxx` 读单键，无 key 时带 `?prefix=` 列 key；PUT 带 `?key=xxx` 或 body.key，body.value 写入；DELETE 带 `?key=xxx`。需登录 |
| POST / GET | /api/x-apps/backend/queue/:appId/:queueName/push、.../pop、.../len | 小程序后端队列：push 的 body `{ payload }`；pop 返回一条并删除；len 返回长度。需登录 |
| GET | /api/policy/rules | 策略规则列表 |
| GET | /api/runtime/sessions | 运行时会话列表 |
| GET | /api/audit | 审计日志，query: `limit`（默认 100） |
| GET | /api/audit/task/:taskId | 指定任务的审计时间线 |
| GET | /api/prompts/welcome | 主脑欢迎语，返回 `{ content }` |
| POST | /api/chat | 普通对话。Body: `{ messages, providerId, modelId, baseUrl?, apiKey?, stream?, scene?, computerContext?, taskSummary?, memory? }`；scene 注入主脑提示，stream 时 SSE 推送 |
| POST | /api/chat/with-tools | 带工具对话；支持 scene/computerContext/taskSummary/memory 同 /chat |
| POST | /api/chat/agent | 聊天 Agent 循环：带工具执行，后端循环调用 LLM + 执行工具直至无 tool_calls，返回 `{ content }`。Body 支持 `referenceImagePaths?: string[]`（参考图）、`attachedFilePaths?: string[]`（用户附带的文档路径，注入最后用户消息供 X 使用 file.read / memory_embed_add） |
| POST | /api/chat/agent/stream | 聊天 Agent 流式：SSE 推送工具调用进度（tool_start、tool_complete、done），前端可展示 Cursor 风格可展开工具操作。Body 支持 referenceImagePaths、attachedFilePaths 同上 |
| POST | /api/chat/classify-writing-intent | 写作意图分类。Body: `{ userMessage, hasOpenAiDocument, providerId, modelId, baseUrl?, apiKey? }`，返回 `{ intent, suggestedPath? }` |
| POST | /api/chat/editor-agent-stream | 编辑器 Agent 流式写入；同上 |
| POST | /api/chat/generate-image | 图片生成。Body: `{ prompt, providerId, modelId, baseUrl?, apiKey? }`；使用 OpenRouter/OpenAI 兼容接口 `modalities: ["image"]`，返回 `{ content, images: string[] }`（images 为 data URL 或图片 URL） |
| POST | /api/chat/task-completion-reply | 任务完成后 AI 助手回复。Body: `{ sessionId?, taskId, userMessage?, task: { title?, description?, status?, result?, steps? } }`；用系统设置中的 LLM 生成「任务完成了，根据结果xxxx」风格摘要，返回 `{ content }`。供 ChatApp 在任务完成时追加跟帖。 |
| GET / POST / PUT / DELETE | /api/chat/sessions、/api/chat/sessions/:id、/api/chat/sessions/:id/messages | 聊天会话与消息 CRUD（按用户隔离）；详见 [CHAT_SESSIONS_PLAN.md](./CHAT_SESSIONS_PLAN.md) |
| GET | /api/memory/status | 记忆状态（对齐 OpenClaw status）。Query: `workspaceId?`；返回 `{ vectorEnabled, indexCount, filesInMemory, indexPath, workspaceRoot, lastEmbedError? }` |
| GET | /api/memory/read | 按路径读记忆文件（对齐 OpenClaw readFile）。Query: `path`（必填，如 memory/2026-02-11.md）、`from?`、`lines?`；返回 `{ text, path }` |
| GET | /api/memory/recall | 记忆召回（关键词）。Query: `q`, `days`（默认 2），返回 `{ content }` |
| POST | /api/memory/recall | 记忆召回（支持向量/混合/多 workspace）。Body: `{ query, days?, topK?, useHybrid?, vectorWeight?, textWeight?, workspaceId?, providerId?, modelId?, baseUrl?, apiKey? }`；传向量配置则向量或混合检索（useHybrid 时 FTS+向量加权），否则关键词 |
| POST | /api/memory/capture | 记忆捕获。Body: `{ content, type?, workspaceId?, providerId?, modelId?, baseUrl?, apiKey? }`；传向量配置则写入后建向量索引（可指定 workspaceId） |
| POST | /api/memory/rebuild-index | 从已有 memory/*.md 重建向量索引（batch 嵌入）。Body: `{ providerId, modelId, baseUrl?, apiKey?, workspaceId? }`，返回 `{ indexed, filesFound, fileNames, workspaceRoot, embedError? }` |
| POST | /api/memory/consider-capture | 自动记忆判断（OpenClaw 式）。Body: `{ userMessage, assistantReply, providerId, modelId, baseUrl?, apiKey?, vectorProviderId?, vectorModelId?, vectorBaseUrl?, vectorApiKey?, workspaceId? }`，传向量配置则写入后建索引（可指定 workspaceId） |
| POST | /api/signals/emit | 脚本发送信号（监控脚本判断条件满足后调用，唤醒 agent）。Body: `{ signal: string, payload?: object }`；需登录（X-User-Id）。返回 `{ ok, fired, skipped }` |
| GET | /api/capabilities | 能力列表（内置工具 + 已注册 MCP/Skill），返回 `[{ name, description }]` |
| GET | /api/skills/search | Skill 市场搜索（SkillHub）。Query: `q`（关键词）、`limit`（默认 20）；返回 `{ ok, skills }`，skills 含 slug、description、version |
| GET | /api/skills/recommended | 精选 Skill 推荐（已安装的标记 installed） |
| POST | /api/capabilities/register | 注册能力。Body: `{ name, description, source?: mcp|skill }` |
| GET | /api/email/inbox | 从数据库读取已同步的收件箱（query: limit 默认 20，最大 50）。需登录。邮件由定时任务从 IMAP 同步到 DB。返回 `{ ok, emails, error? }` |
| POST | /api/email/sync | 手动触发邮件同步（IMAP → DB）。新邮件会发出 email_received 信号。需登录。返回 `{ ok, message }` |
| GET | /api/whatsapp/status | WhatsApp 连接状态（R052）。需登录。返回 `{ ok, enabled, status, allowFrom }` |
| POST | /api/whatsapp/login | WhatsApp 登录，返回 QR 码或 alreadyConnected。需登录。返回 `{ ok, qr?, alreadyConnected? }` |
| POST | /api/whatsapp/logout | WhatsApp 登出，清除凭证。需登录。返回 `{ ok, message }` |
| GET | /api/whatsapp/inbox | WhatsApp 收件箱（query: limit 默认 20）。需登录。返回 `{ ok, messages }` |
| GET | /api/mcp/status | MCP 状态：已加载的服务器与工具数 |
| GET | /api/mcp/config | MCP 配置（servers, configPath, fromEnv） |
| GET | /api/mcp/registry/search | MCP 市场搜索。Query: `q`（关键词，可空则返回热门）、`limit`（默认 20）；返回 `{ ok, servers }`，servers 含 name、description、config（id/url/command/args 等） |
| POST | /api/mcp/config | 保存 MCP 配置并重载 |
| POST | /api/mcp/test | 测试 MCP 服务器连接 |
| POST | /api/mcp/reload | 重载 MCP 配置 |
| GET | /api/health | 健康检查（status, version, uptime, tasks, sessions, auditEntries） |
| GET | /api/context | 当前整机上下文（总 AI 感知的桌面状态，由前端通过 WS 上报） |
| GET | /api/users/me | 当前用户信息（id, displayName, email, createdAt, updatedAt） |
| GET | /api/users/me/config | 获取所有用户配置；缺失项合并 .x-config.json 默认值 |
| GET | /api/users/me/config/:key | 获取单个配置；缺失时尝试返回默认值 |
| PUT | /api/users/me/config | 批量更新配置。Body: `{ key: value, ... }` |
| PUT | /api/users/me/config/:key | 更新单个配置。Body: `{ value }` |
| DELETE | /api/users/me/config/:key | 删除单个配置 |
| GET | /api/admin/check | **Admin** 校验是否为管理员。200 表示是，403 表示否。管理员邮箱由 `admin.emails` 或 `X_COMPUTER_ADMIN_EMAILS` 指定 |
| GET | /api/admin/users | **Admin** 用户列表。Query: `limit?`, `offset?`, `search?`。返回 `{ users, total }` |
| GET | /api/admin/users/:id | **Admin** 用户详情 |
| POST | /api/admin/users/:id/ban | **Admin** 封禁用户 |
| POST | /api/admin/users/:id/unban | **Admin** 解封用户 |
| GET | /api/admin/stats | **Admin** 系统概览：`{ totalUsers, totalTasks }` |
| GET | /api/admin/config | **Admin** 全局配置（只读）：`{ allowRegister }` |
| GET | /api/auth/captcha | 获取验证码（登录/注册前调用）。无需 X-User-Id。返回 `{ id, question }`（如 `"3 + 5 = ?"`） |
| POST | /api/auth/register | 注册。Body: `{ email, password, captchaId, captchaAnswer }`（密码至少 6 位，验证码必填）。若为匿名则注册成功后将该匿名用户的数据合并到新账号并返回 `{ userId }` |
| POST | /api/auth/login | 登录。Body: `{ email, password, captchaId, captchaAnswer }`。若为匿名则登录成功后将该匿名用户的数据合并到该账号并返回 `{ userId }`。安全：验证码防自动化；连续 5 次失败锁定 15 分钟 |
| GET | /api/agents | X 智能体列表（与 x.list_agents 共用 user_config.x_agents）。需登录。返回 `{ agents: AgentDefinition[] }`（含可选 role） |
| POST | /api/agents | 创建智能体。Body: `{ name, system_prompt, tool_names?, role?, goal_template?, output_description?, llm_provider_id?, llm_model_id? }`。需登录。返回 `{ agent, message }` |
| PUT | /api/agents/:id | 更新智能体。Body 同创建，字段可选。需登录。返回 `{ agent, message }` |
| DELETE | /api/agents/:id | 删除智能体。需登录。返回 `{ message }` |
| GET | /api/teams | X 智能体团队列表（与 x.list_teams 共用 user_config.x_agent_teams）。需登录。返回 `{ teams: AgentTeam[] }` |
| POST | /api/teams | 创建团队。Body: `{ name, agent_ids: string[] }`。需登录。返回 `{ team, message }` |
| PUT | /api/teams/:id | 更新团队。Body: `{ name?, agent_ids? }`。需登录。返回 `{ team, message }` |
| DELETE | /api/teams/:id | 删除团队。需登录。返回 `{ message }` |
| GET | /api/groups | X 智能体群组列表（与 x.list_groups 共用 user_config.x_agent_groups）。需登录。返回 `{ groups: AgentGroup[] }` |
| POST | /api/groups | 创建群组。Body: `{ name, agent_ids?: string[] }`（agent_ids 可选，可先建空群）。需登录。返回 `{ group, message }` |
| PUT | /api/groups/:id | 更新群组。Body: `{ name?, agent_ids? }`。需登录。返回 `{ group, message }` |
| DELETE | /api/groups/:id | 删除群组。需登录。返回 `{ message }` |
| POST | /api/x/cancel-group-run | 请求停止当前用户正在执行的群组任务（x.run_group 在每名成员间检查）。需登录。返回 `{ success, message }` |
| GET | /api/x/group-run-history | 群组执行记录（对话与工作过程）。Query: groupId（可选）、limit（默认 30，最大 50）。需登录。返回 `{ runs: GroupRunRecord[] }` |
| POST | /api/llm/import-models | 从提供商 baseUrl 请求 /models 或 /v1/models 导入模型列表（服务端代理，避免浏览器 CORS）。Body: `{ baseUrl, apiKey? }`。需登录。返回 `{ models: [{ id, name? }] }` |

### 8.2 文件系统 (/api/fs)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/fs?path=... | 列出目录，path 需 URL 编码。返回 `{ path, entries }`，每项含 `name, type, size, modified, created, permissions`（modified/created 为 ISO 字符串精确到秒） |
| GET | /api/fs/read?path=... | 读取文件内容（UTF-8 文本） |
| GET | /api/fs/read-binary?path=... | 读取二进制文件并原样返回，按扩展名设置 Content-Type（供图片查看器等使用） |
| GET | /api/fs/download?path=... | 下载文件：读取二进制文件并设置 Content-Disposition 触发浏览器下载 |
| GET | /api/fs/read-office?path=... | 读取办公文档：docx 返回 `{ type, path, text }`，xlsx 返回 `{ type, path, sheets }`，pptx 返回 `{ type, unsupported, message }` |
| POST | /api/fs/write-office | Body: `{ path, type: 'docx'|'xlsx', content }`。docx 为 `{ text, title? }`，xlsx 为 `{ sheets: [{ name, rows }] }` |
| POST | /api/fs/write | Body: `{ path, content }` |
| POST | /api/fs/write-binary | Body: `{ path, contentBase64 }`，写入二进制到沙箱（如图片） |
| POST | /api/fs/upload | 上传文件：multipart/form-data，字段名 `file`，可选 `path`（目标路径，默认使用文件名）。返回 `{ success, path, fileName, size }` |
| POST | /api/fs/mkdir | Body: `{ path }` |
| POST | /api/fs/delete | Body: `{ path }` |
| POST | /api/fs/rename | Body: `{ oldPath, newPath }` |
| GET | /api/fs/stat?path=... | 文件/目录元信息 |

### 8.3 命令执行 (/api/shell)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/shell/exec | Body: `{ command, cwd? }`。返回 `{ stdout, stderr, exitCode, command, duration }` |

---

## 9. WebSocket 协议

- **URL**: `ws://localhost:4000/ws`
- **连接后**：服务端推送 `{ type: 'init', data: { mode, tasks, sessions, auditLog? } }`
- **服务端推送**：
  - `task_event`: `{ type: 'task_event', data: TaskEvent }`
  - `audit_entry`: `{ type: 'audit_entry', data: AuditEntry }`（若启用）
  - `mode_changed`: `{ type: 'mode_changed', data: { mode } }`
  - `task_created`: `{ type: 'task_created', data: Task }`（仅响应 create_task 的客户端）
  - `editor_stream`: `{ type: 'editor_stream', data: { windowId, chunk } }` — 编辑器 Agent 流式输出片段
  - `editor_stream_end`: `{ type: 'editor_stream_end', data: { windowId } }` — 流式结束
  - `editor_stream_error`: `{ type: 'editor_stream_error', data: { windowId, error } }` — 流式出错
- **客户端发送**：
  - `auth`: `{ type: 'auth', data: { userId } }` — 关联连接与用户，用于按用户推送
  - `subscribe_app`: `{ type: 'subscribe_app', data: { appId } }` — 订阅小程序通道（打开小程序窗口时发送）；收到 **backend.broadcast_to_app** 推送时服务端会向该连接发 `app_channel`
  - `unsubscribe_app`: `{ type: 'unsubscribe_app', data: { appId } }` — 取消订阅
  - `create_task`: `{ type: 'create_task', data: CreateTaskRequest }`
  - `set_mode`: `{ type: 'set_mode', data: { mode } }`
  - `pause_task`: `{ type: 'pause_task', data: { taskId } }`
  - `resume_task`: `{ type: 'resume_task', data: { taskId } }`
  - `approve_step`: `{ type: 'approve_step', data: { taskId, stepId } }`
  - `reject_step`: `{ type: 'reject_step', data: { taskId, stepId } }`
  - `set_computer_context`: `{ type: 'set_computer_context', data: ComputerContext }`（前端上报整机状态供总 AI 感知）
- **服务端推送（小程序通道）**：`app_channel`: `{ type: 'app_channel', data: { appId, message } }` — X 调用 **backend.broadcast_to_app** 时向已订阅该 appId 的客户端推送；前端将 message 通过 postMessage 传给小程序 iframe（`x_app_channel`），见 MINIAPP_BACKEND.md
- **浏览器控制**：X 可调用 **browser.navigate** 工具，服务端向已订阅 `appId: 'browser'` 的客户端推送 `{ action: 'navigate', url, openIfNeeded }`；Desktop 与 BrowserApp 均订阅，未打开时若 openIfNeeded 则自动打开并导航

---

## 10. 已实现功能清单

- [x] 桌面壳：窗口管理（拖拽、缩放、最小化、最大化、聚焦、关闭）
- [x] 任务栏、桌面图标、顶部状态栏、通知中心
- [x] 右键上下文菜单、Cmd+K 搜索启动器、锁屏 (Cmd+L)
- [x] 全局快捷键：Cmd+W/M/T/N/K/L、Esc
- [x] 11 个内置应用入口及基础 UI
- [x] 文件管理器：与后端 FS 联通，列表/导航/新建/重命名/删除，双击打开编辑器
- [x] 终端：真实命令执行 (SandboxShell)、help/clear/ai 内置命令
- [x] AI 助手：创建任务 (API)、域检测、跳转任务时间线
- [x] 任务时间线：任务列表/详情、过滤、审批/拒绝/暂停/恢复、审计视图
- [x] 代码/文本编辑器：多标签(代码)、从 FS 打开、保存到沙箱
- [x] **AI 编辑器与编辑器 Agent**：文本编辑器可由主 AI 对话驱动；用户说「写文章并更新到编辑器」时，主 AI 调用编辑器 Agent 流式生成，通过 WebSocket `editor_stream` 实时输出到编辑器窗口
- [x] **主脑提示词与进化**：主系统提示（身份/使命/能力/进化/元认知）集中维护于 `server/src/prompts/systemCore.ts`；对话支持 scene 注入、能力列表与整机状态/任务摘要/记忆注入；记忆系统（memory/ Daily + MEMORY.md、召回与捕获）；能力注册表（内置 + MCP/Skill 占位）；**自动记忆**：每轮对话后由 LLM 判断是否写入记忆（OpenClaw 式，无需说「记住」）；用户仍可说「记住：xxx」显式写入；**提示词随对话丰富**：每轮对话后抽取「用户希望长期遵守的规则/偏好」写入 `memory/LEARNED_PROMPT.md`，并在后续请求中注入主脑系统提示的「从对话中学习到的规则与偏好」块；**主脑自我进化**：主脑可在对话中调用工具 `evolve_system_prompt` 追加自己遵循的规则/策略到 `memory/EVOLVED_CORE_PROMPT.md`，系统组装提示时会注入「自我约定」块；也可调用 **replace_system_prompt** **完全替换**整份基础系统提示词（写入 `memory/BASE_PROMPT.md`），换人设、改身份、重写约束均可，不限制想象，组装时若有 BASE_PROMPT 则替代代码中的默认 CORE_SYSTEM_PROMPT；也可由用户设定定时任务（如「每周反思并进化提示词」）在任务中触发进化；GET `/api/prompt/evolved` 可查看当前进化内容
- [x] **X 主脑：有抱负、主动学习、主动找用户**：主脑人设为「不断进步的智能」——利用搜索/工具学习、后台更新提示词（用户无感知）、可自行搜索并学习 Skills（如 [SkillHub](https://skillhub.ai/)）、自配 MCP/Skills；缺 API Key 时先搜索免费方案，找不到则通过工具 **x.notify_user** 告知用户；**X 主脑**专属入口（内置应用「X 主脑」）：与 X 对话时**可使用全部工具**（文件、Shell、**llm.generate_image**、定时、智能体等）；用户请求具体任务（如图片生成、写文件）时 X 应使用工具或 **x.create_agent** / **x.run_agent** 派发智能体完成，不以「纯对话」为由拒绝；并展示 X 主动推送给用户的消息；GET `/api/x/proactive-messages`、POST `/api/x/proactive-messages/read`（标记已读，用户点击或 X 用 **x.mark_proactive_read**）、WebSocket `x_proactive_message`、工具 `x.notify_user`、**x.mark_proactive_read**
- [x] **X 感知用户与 AI 助手对话并优化助手**：X 作为「电脑主人」可感知用户与 AI 助手的近期对话（工具 **read_recent_assistant_chat**，读 DB 中聊天会话），并可更新「AI 助手专用说明」（**update_assistant_prompt** 写入 `memory/ASSISTANT_PROMPT.md`），该说明在用户与 AI 助手对话时注入系统提示，使助手更好服务用户；可定时执行（如每日自检：读近期对话 → 判断助手表现 → 必要时更新助手提示词）
- [x] **X 创建与管理智能体**：X 是**管理者**，可创建多个**智能体**作为执行者。工具 **x.create_agent**：创建智能体（name、system_prompt、tool_names、可选 goal_template / output_description）；**x.list_agents**：列出当前用户的智能体；**x.run_agent**：派发任务（agent_id、goal），智能体用自己的提示词与工具执行并返回结果；**x.update_agent** / **x.remove_agent**：更新或删除。智能体定义存用户配置 `x_agents`；派发时用该用户 LLM 配置与限定工具列表执行一轮 Agent 循环。
- [x] **X 主脑自主定时执行**：X 可**自己指定何时执行**，不依赖用户主动来找。工具 **x.schedule_run**：传入 intent（到点要做什么）、at（单次时间，ISO 或时间戳）或 cron（五段 cron 如 `0 9 * * *` 每天 9:00）；到点后以对应用户身份自动跑一次 Agent，不限制内容（进化提示词、搜索、写脚本、通知用户等）。**添加前先查已有**：**x.list_scheduled_runs** 列出当前用户已有定时任务（id、intent、下次运行、cron），避免重复添加；**x.remove_scheduled_run** 传入 jobId 可删除重复或不再需要的任务。定时任务持久化到 DB（`scheduled_jobs` 表），重启后自动加载；每次定时执行结束后若该用户无任何定时任务则自动添加一条默认定时（每天 9:00 自检），**保证至少有一个唤醒任务**。主脑被提示：每次运行应有目标、用沙箱记录任务清单、完成后定下一个定时；添加定时前先 list 避免重复。**定时任务用到的 LLM 配置**：优先读该用户 DB 中的 `llm_config`（前端「系统设置」同步）；若未配置或未同步，则使用环境变量 **OPENROUTER_API_KEY**（及可选 **OPENROUTER_MODEL**，默认 `openai/gpt-4o-mini`），或 **LLM_API_KEY** / **LLM_MODEL**，避免因「未在云端保存配置」而跳过执行；若仍无配置则跳过并在 X 主脑入口推送「需要配置」类消息。GET `/api/x/scheduled-jobs` 可查看当前用户的定时任务列表；GET `/api/x/scheduler-status` 可确认调度器是否运行、任务数与下次运行时间。**用户可手动触发立即执行**：POST `/api/x/run-now`（可选 body `{ intent }`），与定时任务同流程（自检、工具可用），便于观察 X 如何操作；X 主脑入口提供「立即执行一次」按钮。**R018 失败重试**：定时与 run-now 在 LLM/网络瞬时错误时自动重试（最多 2 次、指数退避）。**R014 事件驱动**：用户追加聊天消息（POST /chat/sessions/:id/messages）或任务完成（task_complete 钩子）时自动触发 X 执行一次（节流 60s/用户）。**R015 用户待办**：GET/POST/DELETE `/api/x/pending-requests` 管理「给 X 的待办/留言」；X 工具 **read_pending_requests**、**clear_pending_requests** 读取与清除。
- [x] 后端：任务编排、四域步骤模板、17 个模拟工具、策略与风险、审计日志
- [x] 后端：沙箱文件系统 (SandboxFS)、沙箱命令 (SandboxShell)
- [x] **Python 执行**（R020）：工具 **python.run** 在用户沙箱内执行 .py 脚本，可传 args、timeout，返回 stdout/stderr/exitCode；X 可用 file.write 写脚本后调用以编写、执行与调试
- [x] **X 制作有界面小程序**（R021）：支持工程化与快速两种方式。**工程化**（须分阶段、勿一次性创建所有文件）：① 先只写 apps/&lt;id&gt;/plan.md；② file.read 自检 plan；③ 再创建 index.html/style.css/app.js、可选 icon.png，最后 x.create_app 注册；**快速**：x.create_app 传 html_content 生成单页。路径式 URL（/api/apps/sandbox/&lt;userId&gt;/apps/&lt;id&gt;/index.html）中 userId 在路径内；**userContextMiddleware 从 URL 提取 userId**，iframe 加载无需 X-User-Id header，子资源可正确加载
- [x] **应用/游戏多媒体资源生成**（R022）：设置→多媒体配置（fal/MusicAPI/ElevenLabs）；工具 llm.generate_sound_effect、llm.generate_music 均使用 fal.ai；图片沿用 llm.generate_image。详见 AUDIO_GENERATION_OPTIONS.md、AUDIO_API_KEYS_PLAN.md
- [x] **万相参考生视频**：工具 **video.reference_to_video**（阿里云百炼）根据文本提示词与参考图像/视频 URL 生成视频，支持单角色或多角色、单镜头/多镜头。需配置环境变量 **DASHSCOPE_API_KEY**（与模型同地域）；轮询超时可通过 **DASHSCOPE_VIDEO_POLL_TIMEOUT_MS** 调整（默认 5 分钟）。
- [x] **万相文生视频**：工具 **video.text_to_video** 根据文本提示词生成视频（可选 audio_url 配音），默认模型 wan2.6-t2v，支持多镜头。需 DASHSCOPE_API_KEY。
- [x] **万相图生视频-首帧**：工具 **video.image_to_video** 根据首帧图像 URL 与文本提示词生成视频，默认模型 wan2.6-i2v-flash。需 DASHSCOPE_API_KEY。
- [x] **文生图（千问/万相）**：图片生成（llm.generate_image、POST /api/chat/generate-image）在选用阿里 DashScope 且图像模态为文生图异步模型时，走百炼 **text2image/image-synthesis** 异步 API（千问 qwen-image-plus/qwen-image 擅长复杂文字渲染，万相 wan2.2-t2i-flash、wan2.6-t2i 等用于写实与摄影风格）。创建任务后轮询至完成；轮询超时可通过 **DASHSCOPE_TEXT2IMAGE_POLL_TIMEOUT_MS** 调整（默认 2 分钟）。
- [x] WebSocket：前后端实时同步任务状态与模式
- [x] 双模式：自动 / 审批，任务步骤审批挂起与恢复
- [x] 系统设置「大模型配置」：提供商（OpenAI/Anthropic/通义/智谱/Ollama/自定义）、各模态默认模型（聊天/长文本/视频/图像/向量）、API Key 本地存储
- [x] **X 管理大模型（llm.* 工具）**：**llm.list_providers** / **llm.add_provider** / **llm.update_provider** / **llm.remove_provider** 管理提供商（name、baseUrl、apiKey）；**llm.import_models** 从 API 导入模型；**llm.list_models** / **llm.add_model** 查看与添加模型；**llm.set_default** 设置聊天默认模型。创建 agent 时可选 **llm_provider_id**、**llm_model_id** 指定该智能体使用的大模型；未指定则用用户默认配置
- [x] **默认配置文件 .x-config.json**（R030）：工作区或 ~/.x-computer/ 下配置，支持 {env:VAR} 占位符；首次登录自动填入 apiKey；GET /api/users/me/config 合并默认值
- [x] **账号注册与登录**（R029）：Mac 风格 LoginScreen、验证码、限流；退出登录清空 localStorage/Cookie/Cache；无匿名 userId，必须注册/登录
- [x] **总 AI 感知整机内容**：前端通过 WebSocket `set_computer_context` 上报当前桌面状态（窗口、任务摘要、执行模式、焦点、通知数等），后端存入并随任务规划注入 `task.metadata.computerContext`
- [x] **审批通过后继续执行**：审批通过后将步骤设为 `running` 再调度执行，且仅在步骤为 `pending` 时触发审批，避免重复拦截
- [x] **任务非阻塞多路执行**：通过 `scheduleRunSteps` 与队列限制最大并发数（默认 10），使用 `setImmediate` 调度，不阻塞请求与事件循环

---

## 11. 未实现与已知限制

- **持久化**：任务、审计、用户配置、聊天会话、定时任务、X 待办等已持久化（默认 SQLite，见 INFRASTRUCTURE_MULTIUSER_CLOUD.md）；重启后保留。**数据库可配置**：`DATABASE_TYPE=sqlite`（默认）或 `mysql`；MySQL 支持开发中（R050），`database-mysql.ts` 已实现，完整接入需将 routes/orchestrator 等改为 async。
- **真实 LLM**：ToolExecutor 中任务步骤工具仍多为模拟；**AI 助手与 X 主脑对话已接入真实 LLM**（POST /api/chat、run-now/定时，使用设置中的大模型配置或环境变量）。
- **身份与多租户**：多用户隔离已实现（X-User-Id / 路径式小程序从 URL 提取）；Mac 风格登录页（R029），默认须登录，X_COMPUTER_REQUIRE_LOGIN=false 可关闭。
- **浏览器应用**：内置浏览器使用 iframe 加载真实网页；X 可通过 **browser.navigate** 工具实时控制导航（打开/跳转），支持 openIfNeeded 自动打开窗口。受同源策略限制，无法对跨域页面进行点击/填表等 DOM 级操作。
- **邮件/日历/表格**：数据为前端 Mock，未对接后端存储或第三方 API。
- **审计导出**：无导出为文件或对接外部日志系统。
- **可访问性**：未系统做 a11y 与键盘焦点管理。
- **单元/集成测试**：未添加自动化测试。
- **Python 执行与桌面小程序**：已支持在沙箱内执行 Python（**python.run**）；已支持 X 制作有界面小程序（**x.create_app**、**x.list_apps**），存沙箱 apps/、桌面与搜索展示、iframe 打开。**小程序/小游戏创作增强**（R023）规划见 MINIAPP_GAME_PLAN.md，待实现。

**应用与 AI/任务执行详细梳理**：参见 [APPS_AND_AI_STATUS.md](./APPS_AND_AI_STATUS.md)（应用清单、可用性、AI 对话与任务执行现状、完善计划）。

**超级电脑 AI 与系统提示词进化**：参见 [SUPER_AI_PROMPT_AND_EVOLUTION_PLAN.md](./SUPER_AI_PROMPT_AND_EVOLUTION_PLAN.md)（主脑人设、OpenClaw 借鉴、记忆与 MCP/Skill 进化、分阶段开发计划）。

**迭代开发计划（对齐 OpenClaw/OpenCode）**：参见 [DEV_PLAN_OPENCLAW_OPENCODE.md](./DEV_PLAN_OPENCLAW_OPENCODE.md)（阶段任务、参考标准、实施顺序）。

**记忆与工作区**：记忆文件（memory/*.md）与向量索引（memory/.vector_index.json）均写在服务端「工作区」内。默认工作区为系统临时目录下的 `x-computer-workspace`。若希望使用项目内的 `memory` 目录（便于重建索引时扫到已有文件），可设置环境变量 `X_COMPUTER_WORKSPACE` 指向包含 `memory` 的目录后重启服务，例如：`X_COMPUTER_WORKSPACE=. npm run dev`（在项目根执行）。

**MCP（网络搜索等）**：通过 MCP 配置接入，你提供 `mcp-servers.json` 或环境变量 `X_COMPUTER_MCP_SERVERS` 后，主脑可在对话与任务中调用这些工具。详见 [MCP_CONFIG.md](./MCP_CONFIG.md)。

**网络搜索**：不内置固定搜索工具，由 **MCP** 或 **Skill** 动态提供。在设置 → MCP 扩展 中配置提供网络搜索的 MCP 服务器后，对应工具会出现在能力列表；或通过 skill.load 加载 `skills/zhipu-web-search/SKILL.md` 等 Skill 后按说明调用 MCP 工具。智谱等 API Key 可在设置 → Skills 中配置供 MCP 使用。

**任务工具 http.request**：任务步骤中的 `http.request` 会真实发 HTTP 请求。默认仅允许 host：localhost、127.0.0.1、::1。需访问其他域名时设置环境变量 `X_COMPUTER_HTTP_ALLOWED_HOSTS=api.example.com,other.com`（逗号分隔）后重启。

---

## 12. 运行、构建、测试

```bash
# 安装
npm install

# 开发（建议开两个终端）
npm run dev:server   # 后端 http://localhost:4000
npm run dev:frontend  # 前端 http://localhost:3000

# 或同时启动
npm run dev

# 工作流引擎微服务（R041，可选，需单独启动）
npm run dev:workflow   # 工作流引擎 http://localhost:4001
# 主服务通过 WORKFLOW_ENGINE_URL 调用工作流 API；工作流通过 WORKFLOW_CALLBACK_URL（默认 http://localhost:4000）回调主服务执行 script/ai 任务

# 构建（按依赖顺序）
npm run build

# 后端 API 测试（server 目录下）
# 测试需使用 Node 22，否则 better-sqlite3 等原生模块可能报 NODE_MODULE_VERSION 错误。使用 nvm 时在项目根目录执行：
nvm use
cd server && npm run test

# 工作流引擎测试
npm run test:workflow

# 部署
# 1. 复制 scripts/deploy.config.example.json 为 scripts/deploy.config.json，填入 host、password、path
# 2. 执行 npm run deploy
# 仅构建：npm run deploy -- --build-only
# 服务器上拉取并重启：npm run deploy -- --pull-only  （在服务器项目目录执行）
```

### 部署脚本说明（scripts/deploy.sh）

- **配置**：`scripts/deploy.config.json`（复制自 `deploy.config.example.json`），填入 `host`（如 `user@192.168.1.100`）、`password`（可选，需安装 sshpass）、`path`（默认 `/apps/x-computer`）
- `--build-only`：本地构建，不部署
- `--pull-only`：在**服务器项目目录**执行，拉取代码、安装依赖、构建、重启 pm2/systemd
- 默认模式：读取配置 → 本地构建（含 workflow-engine）→ rsync 到服务器 → 远程安装依赖 → 重启主服务与工作流引擎（pm2: x-computer、x-computer-workflow）

### 测试用例说明

- **REST API**（`server/src/api.test.ts`）：覆盖 `/api`、`/api/fs`、`/api/shell` 下所有接口，共 37 个用例。
  - 健康、模式、上下文、任务 CRUD、暂停/恢复、审批/拒绝、工具、策略、运行时、审计、文件系统 list/read/write/mkdir/stat/rename/delete、Shell exec。
- **WebSocket**（`server/src/ws.test.ts`）：覆盖连接 init、create_task、set_mode、set_computer_context、未知 type 报错；当前默认 `describe.skip` 跳过（部分环境会超时），需要时去掉 skip 并加大 `testTimeout` 后运行。

- **健康检查**：`curl http://localhost:4000/api/health`
- **手动验证**：在桌面打开 AI 助手创建任务、在任务时间线审批、在终端执行 `ls`、在文件管理器新建/删除文件。

---

## 13. 下一步开发建议（优先级供参考）

**当前推荐**（与 [REQUIREMENTS.md §3](./REQUIREMENTS.md) 对齐）：

1. **R023 小程序与小游戏创作增强**：强化 X 做小程序/小游戏的能力。实现要点：资源目录约定（apps/&lt;id&gt;/assets/）、主脑「做小游戏」指引注入。详见 [MINIAPP_GAME_PLAN.md](./MINIAPP_GAME_PLAN.md)。
2. **R007 Skill 注册与发现**：发现 SKILL.md、注册到能力列表、主脑可见；可选 skill 工具加载内容。
3. **R008 测试覆盖补全**：关键 API（聊天/图片/会话）、记忆召回与捕获、LEARNED_PROMPT 链路有测试；`cd server && npm run test` 稳定通过。
4. **R016 X 创建/更新系统任务**：主脑通过工具创建任务进任务时间线，与现有 createTask API 对接。

后续可选：R009 更多工具真实化、R017 对外触达（邮件/Slack/推送）、R019 资源与限流；真实运行时（Docker/Firecracker）、浏览器/邮件/日历真实化、审计导出与合规。

---

## 14. 文档维护

- 重大功能或架构变更后，请更新本文档对应章节。
- 新增 API、WS 消息或共享类型时，在「API 参考」「WebSocket 协议」「数据模型」中补充。
- 版本号与「当前版本与状态」保持一致（如发布时更新为 0.2.0）。
