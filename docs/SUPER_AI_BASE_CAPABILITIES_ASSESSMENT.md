# X-Computer 超级电脑 AI：基础能力完善度评估

本文档从「超级电脑主脑」视角评估当前系统基础能力是否完善。最后更新：2026-02-11。

---

## 1. 总体结论

| 维度           | 完善度 | 说明 |
|----------------|--------|------|
| **身份与提示** | ✅ 已完善 | 主系统提示、场景片段、能力占位、整机上下文/任务摘要/记忆注入 |
| **对话与上下文** | ✅ 已完善 | 多轮对话、截断、流式、意图分类、写入/修改编辑器、编辑器 Agent |
| **记忆系统**   | ✅ 已完善 | Daily + 向量、readFile、混合检索、batch 嵌入、多 workspace、consider-capture |
| **任务编排**   | ✅ 已完善 | 四域任务、可选 LLM 规划、审批/暂停/恢复、审计、事件广播 |
| **核心工具真实化** | ✅ 已完善 | file.write/read 沙箱、llm.generate 真实 LLM、http.request 任意 URL |
| **前端与沙箱** | ✅ 已完善 | 桌面/窗口/11 应用、设置、任务时间线；SandboxFS、SandboxShell（终端） |
| **扩展与持久化** | ⚠ 部分完善 | MCP 已对接（配置/测试/重载、HTTP+Stdio）；无事件钩子；任务/配置/审计无持久化，重启丢失 |
| **其余工具与运行时** | ⚠ 部分模拟 | 多数工具仍模拟；RuntimeGateway 无真实容器/VM；任务内无 shell 工具 |

**结论**：作为「超级电脑 AI」的**核心基础**（主脑人设、对话、记忆、任务编排、文件/LLM/网络三大核心工具）已经完善，可以完成：多轮对话、记忆召回与捕获、创建并执行任务（含 LLM 规划与审批）、读写沙箱、调用 LLM 生成并写文件、请求任意网站。**扩展能力（MCP、持久化）与更多工具/运行时真实化**仍待迭代，但不影响当前「主脑 + 记忆 + 任务 + 文件/LLM/HTTP」的主链路闭环。

---

## 2. 已完善的能力（可作为超级电脑主脑运行）

### 2.1 身份与提示词

- **主系统提示**（`server/src/prompts/systemCore.ts`）：身份（主脑、掌控整机）、使命、能力占位 `{{CAPABILITIES}}`、与用户关系、进化/记忆占位。
- **场景片段**：普通聊天、写内容、写入编辑器、编辑器 Agent、意图分类等，均「主提示 + 场景」组合。
- **上下文注入**：ComputerContext（窗口/焦点/模式）、任务摘要、记忆片段（recall 结果）、能力列表（ToolExecutor + 注册表）。

### 2.2 对话与上下文

- **多轮对话**：前端维护最近 N 轮（如 10 轮），请求 `/api/chat`、`/api/chat/agent`、`/api/chat/agent/stream` 时携带历史；后端二次截断（如最多 51 条），避免超长上下文。
- **普通对话 Agent 流式**：POST /chat/agent/stream，SSE 推送工具调用进度（tool_start / tool_complete），前端展示可展开/收起的工具块；助手消息 Markdown 渲染（react-markdown）；复制消息、删除消息、重试助手回复。
- **流式回复**：支持 stream；编辑器 Agent 流式写入到当前文档。
- **意图与工具**：意图分类、write_to_editor、修改当前文档、consider-capture 后台触发。

### 2.3 记忆系统（对齐 OpenClaw）

- **写入**：Daily（memory/YYYY-MM-DD.md）、MEMORY.md 精选；capture、consider-capture；向量索引（单条 + rebuild 批量）。
- **召回**：关键词召回、向量召回、**混合检索（FTS + 向量加权）**；**readFile(relPath, from?, lines?)** 按路径读全文或片段。
- **多 workspace**：索引按 workspaceId 分文件；recall/status/rebuild-index/capture/consider-capture 均支持 workspaceId。
- **API**：GET /memory/status、/memory/read；POST /memory/recall（useHybrid、vectorWeight、textWeight）、/memory/capture、/memory/rebuild-index、/memory/consider-capture、/memory/test-embedding。

### 2.4 任务编排

- **创建与运行**：POST /api/tasks → AgentOrchestrator.createAndRun；四域（chat/coding/agent/office）步骤模板。
- **规划**：TaskPlanner 支持 **planWithLLM**（传 useLlmPlan + llmConfig 时用 LLM 根据用户描述生成步骤）；否则模板。
- **执行**：ToolExecutor 按步骤调用工具；策略检查、审批挂起、审计、事件广播（前端任务时间线实时更新）。
- **模式**：自动 / 审批；暂停 / 恢复。

### 2.5 核心工具真实化

| 工具           | 状态 | 说明 |
|----------------|------|------|
| **file.write** | ✅ 真实 | 写入 SandboxFS；llm.generate 内 file_write 也可写沙箱 |
| **file.read**  | ✅ 真实 | 从 SandboxFS 读取 |
| **llm.generate** | ✅ 真实 | 有 llmConfig 时调用真实 LLM，可选 file_write 写沙箱 |
| **http.request** | ✅ 真实 | 真实 fetch，**不限制 host**，可请求任意网站；15s 超时 |

### 2.6 前端与沙箱

- **桌面**：窗口管理、任务栏、状态栏、锁屏、搜索启动器、通知。
- **应用**：文件管理器、终端、AI 助手、代码/文本编辑器、设置、任务时间线等**真实对接后端**；浏览器/表格/邮件/日历为演示或 Mock（已标注）。
- **沙箱**：SandboxFS 与任务编排打通；SandboxShell 供终端直接调用（任务步骤内暂无「执行 shell」工具）。

---

## 3. 未完善或部分模拟的部分

### 3.1 计划中的工具（已从 ToolExecutor 移除，列入计划）

以下工具**未实现**，已从代码中移除；待真实化后可按计划重新注册。详见 `docs/DEV_PLAN_OPENCLAW_OPENCODE.md` 阶段四「计划中的工具」。

- **llm.analyze / llm.plan**：可改为真实 LLM 调用。
- **search.web**：需对接搜索 API 或策略。
- **code.\***（code.search / code.edit / code.test / code.commit）：需对接仓库/IDE/测试/Git。
- **agent.execute / agent.verify**：需对接子 Agent 或外部服务。
- **data.collect / office.process / text.generate**：需对接数据源/办公 API。
- **email.scan / email.classify**：需邮件应用与后端真实化。

### 3.2 运行时与任务内 Shell

- **RuntimeGateway**：会话为内存 Map，无真实容器/VM；若需强隔离可后续接入容器或 VM。
- **任务步骤内无「执行 shell 命令」**：终端通过 SandboxShell 真实执行；任务编排中若需要，可新增 `shell.exec` 类工具并复用 SandboxShell。

### 3.3 扩展与持久化（阶段五、六）

- **MCP 协议对接**：未实现；主脑能力列表目前仅内置工具 + 注册表占位。
- **事件式钩子**：未实现（如 task_complete、memory_captured）。
- **持久化**：任务、审计、用户/大模型配置均内存存储，**重启后丢失**；待接入 SQLite 或文件持久化。

---

## 4. 作为「超级电脑 AI」的底线是否满足

| 能力           | 是否满足 |
|----------------|----------|
| 主脑身份与统一提示 | ✅ |
| 多轮对话与上下文 | ✅ |
| 记忆的写入/召回/按路径读 | ✅ |
| 任务创建、规划（含 LLM）、执行、审批 | ✅ |
| 沙箱文件读写     | ✅ |
| 任务内 LLM 生成并写文件 | ✅ |
| 任务内请求任意网站 | ✅ |
| 前端桌面与核心应用可用 | ✅ |
| 扩展（MCP）与持久化 | ❌ 未实现 |
| 全部工具真实化   | ❌ 仅核心 3 类真实，其余模拟 |

**底线结论**：当前系统**已经具备**超级电脑 AI 的**核心基础**——主脑可多轮对话、使用记忆、创建并执行任务、读写文件、调用 LLM、访问任意网络。在此基础上，可正常迭代「更多工具真实化」「MCP」「持久化」而不影响主链路。若需「生产级长期运行、重启不丢数据、可插拔能力」，则需补齐持久化与 MCP。
