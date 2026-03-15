# X-Computer 应用清单与 AI/任务执行现状

本文档梳理当前系统所有应用、AI 总对话能力、任务执行链路的真实/模拟状态，并给出完善计划。最后更新：2026-02-11。

---

## 1. 系统应用清单

### 1.1 内置应用（11 个）

| 应用 ID | 名称 | 说明 | 后端/数据 | 可用性 |
|--------|------|------|------------|--------|
| **file-manager** | 文件管理器 | 浏览、导航、新建/重命名/删除、双击打开编辑器 | 调用 `/api/fs`（SandboxFS 沙箱） | ✅ **可用**：真实读写沙箱目录 |
| **terminal** | 终端 | 命令历史、help/clear/ai；真实命令走 `/api/shell/exec` | SandboxShell 子进程执行、工作目录限制 | ✅ **可用**：真实执行命令 |
| **browser** | 浏览器 | URL 栏、书签（模拟） | 无后端，无真实浏览 | ❌ **不可用**：纯 UI 占位，无 iframe/代理 |
| **chat** | AI 助手 | 对话、创建任务、跳转任务时间线 | 任务走 `/api/tasks`；对话走 `/api/chat` 真实 LLM；任务内 llm.generate 可带 llmConfig 真实调用 | ✅ **可用**：对话与任务创建可用，任务步骤中 file/llm 可真实化 |
| **code-editor** | 代码编辑器 | 多标签、从 FS 打开/保存 | 调用 `/api/fs` read/write | ✅ **可用**：真实读写沙箱文件 |
| **text-editor** | 文本编辑器 | 从 FS 打开/保存；AI 文档模式下由**编辑器 Agent** 实时流式输出 | 调用 `/api/fs` read/write；AI 文档走 aiDocumentStore + WebSocket `editor_stream` | ✅ **可用**：真实读写沙箱；主 AI 可驱动编辑器 Agent 流式写入 |
| **spreadsheet** | 表格 | 单元格编辑 | 无后端，前端 Mock 数据 | ❌ **不可用**：数据不持久、无真实计算 |
| **email** | 邮件 | 收件箱、阅读、AI 草拟（模拟） | 无后端，前端 Mock | ❌ **不可用**：无真实邮件协议/API |
| **calendar** | 日历 | 月视图、日程 | 无后端，前端 Mock | ❌ **不可用**：无真实日历数据源 |
| **settings** | 系统设置 | 通用/AI/大模型配置/安全/运行时/应用管理/关于 | 大模型配置存前端 llmConfigStore；应用管理 localStorage | ✅ **可用**：配置与应用管理可用 |
| **task-timeline** | 任务时间线 | 任务列表/详情、审批/拒绝/暂停/恢复、审计 | 调用 `/api/tasks`、`/api/audit`、审批等 | ✅ **可用**：任务与审批为真实后端 |

### 1.2 安装应用（用户安装）

- 来源：设置 → 应用管理 → 粘贴 manifest 或「添加示例：快捷终端」。
- 当前仅支持 **alias** 形式：`aliasBuiltin` 指向某内置应用，打开时复用该内置界面与能力。
- 可用性 = 所指向的内置应用的可用性（如「快捷终端」= 终端，可用）。

### 1.3 可用性小结

| 类型 | 可用（真实后端/真实能力） | 不可用（纯 UI 或 Mock） |
|------|---------------------------|-------------------------|
| 内置 | 文件管理器、终端、代码编辑器、文本编辑器、设置、任务时间线、**AI 助手（仅任务创建与跳转）** | 浏览器、表格、邮件、日历 |
| 安装 | 依赖所 alias 的内置应用 | — |

---

## 2. AI 总对话（ChatApp）现状

### 2.1 已实现

- **入口**：桌面/任务栏「AI 助手」或搜索「AI 助手」。
- **界面**：消息列表、用户输入、快捷操作建议、当前执行模式与任务数、跳转「任务时间线」。
- **任务创建**：用户输入若包含关键词（如「帮我」「执行」「创建」「整理」等），会调用 `api.createTask({ domain, title, description })`，后端真实创建任务并进入编排（TaskPlanner + ToolExecutor）；前端展示「任务已创建」及域/模式/步骤数/状态，并可跳转任务时间线查看与审批。
- **域检测**：根据用户文本简单规则检测 `chat` / `coding` / `agent` / `office`。
- **普通对话**：已接入**真实 LLM**（使用设置中的大模型配置）；普通对话走 **Agent 流式**（`POST /api/chat/agent/stream`），后端执行 file.list / grep / shell.run / MCP 等工具并循环至无 tool_calls，前端 SSE 展示工具调用进度（可展开/收起）、最终回复渲染 **Markdown**；支持「写文章并更新到编辑器」→ 打开文本编辑器并由**编辑器 Agent** 流式生成（`POST /api/chat/editor-agent-stream` + WebSocket `editor_stream`）。
- **对话上下文**：前端维护最近 N 轮（如 10 轮），请求时携带历史；会话历史当前仅存于组件状态，刷新即丢失，无持久化。
- **消息操作**：支持复制消息、删除消息、对助手消息重试（删除该条 AI 回复后用上一条用户消息重新请求）。
- **写入/修改编辑器**：意图为「保存到编辑器」时走 `chatWithTools` + `write_to_editor`；意图为「生成并写入编辑器」时走编辑器 Agent 流式写入；「修改当前文档」时在已有 AI 文档窗口内流式改写。

### 2.2 仍不可用 / 缺口

- **会话持久化**：当前会话历史仅在前端组件状态中，无 localStorage 或后端会话存储，刷新/关闭窗口即丢失。
- **任务执行**：TaskPlanner 支持 LLM 动态规划（传 llmConfig 时）；ToolExecutor 已真实化 file.write/read/list、grep、shell.run、http.request、MCP 工具等，未实现工具已从代码移除、列入计划（见 DEV_PLAN_OPENCLAW_OPENCODE.md）。

---

## 3. 任务执行链路现状

### 3.1 流程概览

1. 前端 Chat 或终端「ai」→ `POST /api/tasks` → **AgentOrchestrator.createAndRun**
2. **TaskPlanner**：有 **llmConfig** 时走 **Agent 循环**（runAgentLoop），由 LLM 多轮调用工具直至完成，无预规划步骤；无 llmConfig 时按域模板生成 steps（可选 planWithLLM 用 LLM 生成步骤）。
3. **ToolExecutor.execute**：按 step 的 toolName 调用已注册的 handler；**已真实化**：file.write / file.read / file.list、grep、shell.run、http.request、llm.generate（有 llmConfig 时）、MCP 动态工具（mcp.{serverId}.{toolName}）。未实现工具已从代码移除，列入 `docs/DEV_PLAN_OPENCLAW_OPENCODE.md` 阶段四「计划中的工具」。
4. 策略/审批/审计/事件广播：已实现；**RuntimeGateway** 仍为内存会话，无真实容器/VM。

### 3.2 已真实化工具（ToolExecutor）

| 工具 | 说明 |
|------|------|
| file.write / file.read / file.list | SandboxFS 沙箱读写与列目录 |
| grep | 沙箱内正则搜索 |
| shell.run | 沙箱内执行 shell（SandboxShell） |
| http.request | 真实 fetch，不限制 host，15s 超时 |
| llm.generate | 有 llmConfig 时真实 LLM，可选 file_write 写沙箱 |
| mcp.{id}.{toolName} | MCP 服务器动态注册工具 |

### 3.3 其他

- **SandboxFS / SandboxShell**：已与任务编排打通；终端直接调用 shell，任务步骤内也可通过 shell.run 执行命令。
- **会话持久化**：任务、审计、大模型配置等仍为内存，重启丢失；详见 DEV_PLAN 阶段六。

---

## 4. 完善计划

### 4.1 目标

- 明确标注并区分：**哪些应用/能力已可用、哪些为占位或假数据**。
- 优先让 **AI 总对话** 具备真实对话能力（可选）与 **任务执行** 具备最少可行真实能力（如真实写文件、可选真实 LLM 规划/执行）。
- 分阶段、可落地，避免大而全。

### 4.2 阶段一：标注与文档（当前）

- [x] 梳理所有应用及可用性（本文档 §1）。
- [x] 梳理 AI 总对话现状与缺口（本文档 §2）。
- [x] 梳理任务执行假数据与工具列表（本文档 §3）。
- [ ] 在 UI 上对「不可用」应用做弱化或提示（可选：设置页或关于页列出「当前不可用功能」）。

### 4.2.2 AI 编辑器与编辑器 Agent（已完成）

- [x] 主 AI 对话驱动「编辑器 Agent」：用户说「写文章并更新到编辑器」时，意图识别为 `generate_and_save_to_editor`，打开文本编辑器并调用 `POST /api/chat/editor-agent-stream`，后端按 instruction 流式生成，通过 WebSocket `editor_stream` / `editor_stream_end` 实时推送到该编辑器窗口。
- [x] 前端：useWebSocket 处理 editor_stream/editor_stream_end/editor_stream_error，更新 aiDocumentStore；TextEditorApp 在 AI 文档模式下展示「编辑器助手」标识与实时输出。

### 4.2.1 阶段三先行：P1 file 工具真实化（已完成）

- [x] **file.write**：ToolExecutor 注入 SandboxFS，写入沙箱；路径默认 `文档/ai-output-{timestamp}.txt`，内容支持 `toolInput.path` / `toolInput.content` 或 `description`。
- [x] **file.read**：新增工具，从沙箱读取文件，返回 `{ path, content, size }`。
- [x] 集成测试：office 任务在自动模式下执行后，通过 `/api/fs` 校验沙箱内生成文件内容。

### 4.3 阶段二：AI 总对话增强（P2 已完成）

- [x] **普通对话接入真实 LLM**  
  - 使用设置中「大模型配置」的 chat 模态（提供商 + 默认模型）。  
  - 前端：ChatApp 在非任务分支调用 `POST /api/chat`，传入当前消息列表及 providerId/modelId/baseUrl/apiKey（来自 llmConfigStore）。  
  - 后端：`server/src/chat/chatService.ts` 支持 OpenAI 兼容（openai/alibaba/zhipu/ollama/custom）与 Anthropic，返回 `{ content }`。

- [ ] **任务创建前的意图确认（可选）**  
  - 用户说「帮我整理收件箱」时，可先发一条 LLM 生成的摘要（将执行什么、哪些步骤），用户确认后再 `createTask`。  
  - 或保持当前「直接创建任务」为主，仅优化提示文案说明「当前执行为模拟」。

- [x] **对话上下文**  
  - 前端维护最近 N 轮（getMessagesForChat，N=10），请求 `/api/chat`、`/api/chat/agent`、`/api/chat/agent/stream` 时携带历史；后端二次截断。
- [x] **Chat 体验增强**  
  - 普通对话走 Agent 流式（/chat/agent/stream），工具调用在对话中可展开展示；助手消息 Markdown 渲染；复制消息、删除消息、重试助手回复。

### 4.4 阶段三：任务执行真实化（最小可行）

- [ ] **ToolExecutor 与沙箱打通**  
  - **file.write**：调用 SandboxFS.write，路径使用任务 workspace（或当前沙箱根），step.toolInput 需包含 path + content（或从 description 解析）。  
  - **file.read**（若新增）：调用 SandboxFS.read，供后续步骤或 LLM 使用。  
  - 保证路径校验与沙箱一致，禁止穿越。

- [x] **llm.generate 真实化（P3）**  
  - 创建任务时前端可传入 `llmConfig`（来自设置中的 chat 模态：providerId、modelId、baseUrl、apiKey）。  
  - 后端将 `llmConfig` 存入 task.metadata，执行到 `llm.generate` 步骤时若存在配置则调用 `chatService.callLLM` 生成真实文本，否则退回模拟。  
  - 支持可选参数 `systemPrompt`。  
- [ ] **http.request**：在沙箱/服务器侧发真实 HTTP 请求（需策略允许），结果写回 step output。

- [ ] **TaskPlanner 可选接入 LLM**  
  - 输入：request + 当前 computerContext。  
  - 输出：结构化步骤列表（toolName + toolInput），替代或补充现有域模板。  
  - 可先做「模板 + LLM 微调」：例如先用模板生成候选步骤，再用 LLM 过滤/排序/补全。

### 4.5 阶段四：应用与体验（后续）

- [ ] **浏览器**：选定方案（iframe 安全浏览 / 服务端代理 / 第三方 API），实现最小可用。
- [ ] **表格/邮件/日历**：至少其一对接真实数据源或后端存储，其余保持标注为「即将推出」或「演示」。
- [ ] **持久化**：任务、审计、用户设置持久化，重启不丢。

### 4.6 优先级建议

| 优先级 | 项 | 说明 |
|--------|----|------|
| P0 | 文档与标注 | 本文档 + 可选 UI 提示「部分功能为演示」 |
| P1 | 任务中 file 工具真实化 | ✅ 已完成：file.write/file.read 对接 SandboxFS |
| P2 | AI 对话接入真实 LLM | ✅ 已完成：普通聊天 + 编辑器 Agent 流式写入 |
| P3 | TaskPlanner 或 1～2 个工具接 LLM | 动态规划或真实生成/请求 |
| P4 | 浏览器/表格/邮件/日历 至少一个真实化 | 按产品需求选一个先做 |

### 4.7 建议下一步（择一实施）

| 选项 | 内容 | 理由 |
|------|------|------|
| **A** | **UI 弱化不可用应用** | 阶段一最后一格，工作量小：在设置/关于或应用列表中标注浏览器、表格、邮件、日历为「演示/即将推出」，避免用户误以为可用。 |
| **B** | **对话上下文** | 为 Chat 维护最近 N 轮会话，请求 LLM 时带上历史，多轮追问体验明显提升。 |
| **C** | **http.request 真实化** | 任务步骤中可发真实 HTTP 请求（需策略/权限），便于「搜索」「调用 API」类任务。 |
| **D** | **TaskPlanner 接入 LLM** | 用 LLM 根据用户描述生成步骤（或模板+LLM 补全），任务更贴合用户意图。 |

**当前推荐**：优先 **A（UI 弱化不可用应用）**，快速收尾阶段一；若更看重对话体验则选 **B**。

---

## 5. 小结

- **应用**：当前 11 个内置应用中，**7 个为真实可用**（文件管理、终端、代码/文本编辑、设置、任务时间线、**AI 助手**；文本编辑器支持 AI 文档 + 编辑器 Agent 流式输出），**4 个为不可用占位**（浏览器、表格、邮件、日历）。
- **AI 总对话**：任务创建与任务时间线联动可用；普通对话已接入真实 LLM（P2）；「写文章并更新到编辑器」由编辑器 Agent 流式写入（P2 延伸）；任务执行中 **file.write/file.read** 真实写读沙箱（P1），**llm.generate** 在传入 llmConfig 时调用真实 LLM（P3），其余工具仍为模拟。
- **完善计划**：已按阶段列出；P1/P2 已完成，编辑器 Agent 已落地；**建议下一步**见 §4.7（A：UI 弱化不可用应用 / B：对话上下文 / C：http.request / D：TaskPlanner+LLM）。

**迭代开发计划（对齐 OpenClaw/OpenCode）**：参见 [DEV_PLAN_OPENCLAW_OPENCODE.md](./DEV_PLAN_OPENCLAW_OPENCODE.md)。

维护：功能或实现发生明显变化时，请更新本文档对应章节。
