# X-Computer 开发计划（对齐 OpenClaw / OpenCode 标准）

本文档以 **OpenClaw** 与 **OpenCode** 为参考标准，定义 X-Computer 的迭代开发计划与实现规范。参考项目位于 `projects-for-reference/openclaw`、`projects-for-reference/opencode`。

**最后更新**：2026-02-25（新增 §6 与 OpenClaw/OpenCode 差距与补齐规划）。

---

## 1. 参考标准摘要

### 1.1 OpenClaw 对齐要点

| 维度 | 参考实现 | X-Computer 对齐要求 |
|------|----------|----------------------|
| **配置** | `config/types.openclaw.ts`、Zod schema、分模块类型（agents, channels, memory, hooks…） | 大模型/记忆/工作区等配置结构化、类型安全、可扩展；新增能力时补类型与校验。 |
| **记忆** | `memory/manager.ts`、`memory/types.ts`（MemorySearchManager、Daily + 向量、hybrid 检索）、`memory-flush` 后台、session-memory hook | 记忆已实现 Daily + 向量 + consider-capture 后台；后续可增强：状态接口统一（status/probe）、分 agent/workspace、可选 compaction 前 flush。 |
| **Hooks/扩展** | `hooks/types.ts`（events、HookEntry、handler）、bundled hooks（如 session-memory） | 能力注册表已有；可引入「事件 + handler」式钩子（如任务完成、记忆写入后），便于扩展而不改核心。 |
| **日志与可观测** | `logging/subsystem.ts`、createSubsystemLogger、结构化日志 | 保持 serverLogger 与前端系统日志；关键路径打点（记忆召回/捕获、任务步骤、LLM 调用）便于排查。 |
| **测试** | Vitest、`*.test.ts` 与实现同目录或集中、覆盖路由与核心逻辑 | 新增功能配套单测或 API 测试；关键路径（记忆、聊天、任务）有测试。 |

### 1.2 OpenCode 对齐要点

| 维度 | 参考实现 | X-Computer 对齐要求 |
|------|----------|----------------------|
| **代码风格** | AGENTS.md：单词命名、early return、少 else、const 优先、类型推断 | 新代码遵循：早期返回、避免不必要 try/catch、显式类型仅在对齐或导出处使用。 |
| **Session/上下文** | `session/prompt.ts`、会话与压缩、系统提示组装 | Chat 维护「最近 N 轮」会话上下文，请求 LLM 时携带历史；提示组装保持模块化（主提示 + 场景 + 上下文）。 |
| **工具与能力** | 工具注册、MCP、统一调用入口 | 能力列表与主脑提示注入已做；后续 MCP/真实工具调用时保持「注册 → 发现 → 注入」链路一致。 |

---

## 2. 开发阶段与任务

### 阶段一：体验与标注（当前）

目标：明确区分「可用 / 不可用」应用，避免用户误解；无后端破坏性改动。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| 1.1 | **UI 弱化不可用应用** | 在设置页或应用列表中标注浏览器、表格、邮件、日历为「演示」或「即将推出」；可选在桌面图标或入口处做视觉弱化（如角标、灰色）。 | ✅ 已完成 |
| 1.2 | **文档同步** | 在 DEVELOPMENT.md、APPS_AND_AI_STATUS.md 中注明「按 OpenClaw/OpenCode 标准迭代」及本计划链接。 | ✅ 已完成 |

---

### 阶段二：对话与上下文

目标：Chat 多轮体验对齐「有上下文的会话」；提示与调用方式与 OpenCode session 思路一致。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| 2.1 | **对话上下文（最近 N 轮）** | 前端维护当前窗口或全局「最近 N 轮」消息（如 N=10）；请求 `/api/chat` 时携带完整历史而非仅当轮；可配置 N 或由后端限制 token。 | ✅ 已完成 |
| 2.2 | **上下文长度与截断** | 若消息列表过长，优先保留最近 + 首条 system；可选：按 token 估算截断或后端返回「建议截断」提示。 | ✅ 已完成 |

**实现说明**：前端 `ChatApp` 使用 `getMessagesForChat(messages, userMsg, DEFAULT_MAX_CHAT_ROUNDS)`（N=10）在请求 `/api/chat`、`/api/chat/with-tools`、`/api/chat/agent`、`/api/chat/agent/stream` 时只发送最近 10 轮（user+assistant）；后端做二次截断，最多保留 51 条。普通对话走 **Agent 流式**（POST /chat/agent/stream），SSE 推送工具调用事件（tool_start / tool_complete），前端展示可展开的工具块；助手消息使用 react-markdown 渲染；支持复制消息、删除消息、对助手消息重试（删当前 AI 回复后用上一条用户消息重新请求）。

**OpenClaw 记忆对齐说明**（阶段三）：X-Computer 记忆流程与 OpenClaw 一致：① 记忆写入 Daily（memory/YYYY-MM-DD.md）并按块建向量索引；② 召回时先以 query 做向量检索得到 snippet 列表，直接使用索引中的 snippet 文本（OpenClaw 可选 readFile(relPath) 取全文，我们索引即存 snippet，等价）；③ `GET /api/memory/status` 返回 indexCount、filesInMemory、workspaceRoot、lastEmbedError，对应 OpenClaw 的 `MemorySearchManager.status()`；④ `POST /memory/test-embedding` 对应 `probeEmbeddingAvailability()`。差异：无 FTS/混合检索、无 batch 嵌入、无多 agent/workspace，满足单机主脑场景。

---

### 阶段三：记忆增强（对齐 OpenClaw memory）

目标：记忆接口与行为更接近 OpenClaw 的 MemorySearchManager、status/probe、多源。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| 3.1 | **记忆状态接口** | 提供 `GET /api/memory/status`（或等价）：返回是否启用向量、索引条数、最近错误等，供设置页或调试展示。 | ✅ 已完成 |
| 3.2 | **embedding 可用性探测** | 已有 test-embedding；可与 status 合并或保留独立探测，确保与 OpenClaw probeEmbeddingAvailability 用途一致。 | 已部分实现 |
| 3.3 | **记忆路径与工作区** | 明确文档：memory 目录、向量索引路径、X_COMPUTER_WORKSPACE；与 OpenClaw workspace/memory 概念对齐。 | 已文档化 |

---

### 阶段四：任务与工具真实化

目标：任务编排与工具执行逐步真实化，不追求一步到位。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| 4.1 | **http.request 真实化** | 任务步骤中 `http.request` 发真实 HTTP 请求（需策略/允许列表）；输入输出与现有 step 结构兼容。 | ✅ 已完成 |
| 4.2 | **TaskPlanner 可选 LLM** | 用 LLM 根据用户描述生成或补全步骤（可先「模板 + LLM 微调」）；输入含 computerContext、输出为 steps 列表。 | ✅ 已完成 |
| 4.3 | **更多工具真实化** | 将下方「计划中的工具」按需接入真实后端或沙箱，每项单独评审与测试。 | 待办 |

**当前已实现工具**（对齐 OpenClaw/OpenCode，ToolExecutor 中注册）：`llm.generate`、`llm.analyze`（真实 LLM 分析：总结/分类/意图/关键词）、`search.web`（委托已注入的 MCP 网络搜索）、`file.write`、`file.read`、`file.list`（列出目录）、`grep`（沙箱内正则搜索）、`shell.run`（沙箱内执行 shell 命令）、`http.request`。任务模板与 LLM 规划使用上述工具；未实现工具已从代码中移除，列入计划。

**计划中的工具**（待真实化后重新注册）：

| 工具名 | 描述 | 备注 |
|--------|------|------|
| llm.analyze | 使用 LLM 分析文本/意图 | 可改为真实 LLM 调用 |
| llm.plan | 使用 LLM 制定计划 | 可改为真实 LLM 调用 |
| search.web | 网络搜索 | 需对接搜索 API 或策略 |
| code.search / code.edit / code.test / code.commit | 代码库搜索、编辑、测试、提交 | 需对接仓库/IDE/测试/Git |
| agent.execute / agent.verify | 智能体子任务、结果验证 | 需对接子 Agent 或外部服务 |
| data.collect | 收集聚合数据 | 需对接数据源 |
| office.process | 处理办公文档 | 需对接办公 API |
| text.generate | 生成文本/报告 | 可与 llm.generate 合并或独立 |
| email.scan / email.classify | 扫描/分类邮件 | 需邮件应用与后端 |

**阶段四 4.1–4.2 实现说明**：① `http.request` 真实发请求，不限制 host；15s 超时。② **有 llmConfig 时走 Agent 循环**（对齐 OpenClaw/OpenCode）：不预规划步骤，由 `runAgentLoop` 多轮调用 LLM + 工具直至模型不再返回 tool_calls，实现「收到用户需求后不间断执行直至完成」；无 llmConfig 时仍用 `plan()` 单步兜底。详见 `docs/REFERENCE_OPENCLAW_OPENCODE_AGENT_LOOP.md`。

---

### 阶段五：扩展与 MCP（对齐 OpenClaw 插件/能力）

目标：主脑能「发现并调用」动态能力，与 OpenClaw 的 hooks/plugins、OpenCode 的工具注册一致。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| 5.1 | **MCP 协议对接** | 发现 MCP 服务、拉取工具列表、在对话或任务中可调用；主脑提示中 `{{CAPABILITIES}}` 包含 MCP 工具。网络搜索等由用户通过 MCP 配置提供。 | ✅ 已完成 |
| 5.2 | **事件式钩子（可选）** | 定义少量事件（如 task_complete、memory_captured）；允许注册 handler，不阻塞主流程，便于扩展。 | ✅ 已完成 |

**5.1 实现说明**：启动时从 `mcp-servers.json` 或环境变量 `X_COMPUTER_MCP_SERVERS` 加载 MCP 配置，对每个服务器调用 `tools/list`，将工具注册为 `mcp.{serverId}.{toolName}`，并在对话 Agent 循环与任务中可调用。配置与 API 见 [MCP_CONFIG.md](./MCP_CONFIG.md)、GET /api/mcp/status。**按用户隔离**：GET/POST /api/mcp/config、POST /api/mcp/reload 使用当前用户工作区或 `user_config.mcp_config`；chat/agent 请求前按用户加载 MCP 并注册到该用户 scope，工具执行时使用对应用户沙箱。

**5.2 实现说明**：`server/src/hooks/` 提供事件式钩子（对齐 OpenClaw hooks）：类型见 `types.ts`（`task_complete`、`memory_captured`）；`HookRegistry` 提供 `registerHook(event, handler)`、`fire(event, payload)`。任务完成时（AgentOrchestrator 所有 task_complete 分支）与记忆写入后（runConsiderCapture 中 capture 之后）触发对应事件；handler 异步执行、不阻塞主流程，单 handler 抛错不影响其他。单测见 `HookRegistry.test.ts`。

---

### 阶段六：持久化与运维

目标：重启不丢关键数据；可观测性达标。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| 6.1 | **持久化** | 任务、审计、用户/大模型配置持久化（如 SQLite 或 JSON 文件）；启动时恢复。 | ✅ 已完成 |
| 6.2 | **测试覆盖** | 关键 API（记忆、聊天、任务创建与审批）有自动化测试；新功能配套单测或集成测试。 | 部分（api.test.ts、multiuser.test.ts） |

**6.1 实现说明**：采用 SQLite（better-sqlite3）持久化：`users`、`user_config`、`chat_sessions`、`chat_messages`、`tasks`、`audit_log`。任务创建/更新/完成时写入 DB；审计通过 AuditLogger 回调写入；GET /api/tasks、GET /api/audit 按 userId 过滤。前端：启动时 GET /api/users/me/config 拉取 LLM 配置并合并到 store；修改时同步到云端；聊天发送时创建会话并将消息 POST 到云端。

**基础设施扩展**：多用户与云端存储的详细计划与实施状态见 [INFRASTRUCTURE_MULTIUSER_CLOUD.md](./INFRASTRUCTURE_MULTIUSER_CLOUD.md)，包括：① 多用户隔离（沙箱/记忆/任务/配置/MCP 按 userId）；② 云端为主、本地为缓存；③ 身份与请求上下文（X-User-Id、WebSocket auth）；④ 持久化与 API 契约。当前阶段 A/B/C/D 核心项已完成（B.4/B.5 Orchestrator 与 MCP 按用户隔离，C.4 任务与审计持久化，D.1/D.2 配置与聊天同步，D.3 离线/降级：无网络用本地缓存、恢复后自动重试配置同步，聊天未同步时展示提示）。

---

## 3. 实施顺序建议

| 优先级 | 阶段/项 | 理由 |
|--------|----------|------|
| P0 | 阶段一（UI 弱化不可用应用） | 快速收尾标注，避免误用；无风险。 |
| P1 | 阶段二（对话上下文） | 显著提升 Chat 体验，与 OpenCode session 思路一致。 |
| P2 | 阶段三（记忆 status） | 便于运维与调试，与 OpenClaw memory 对齐。 |
| P3 | 阶段四（http.request / TaskPlanner） | 任务执行真实化，按需推进。 |
| P4 | 阶段五、六 | MCP 与持久化，架构级，可拆分多迭代。 |
| P5 | 阶段七、八（见 §6） | 与 OpenClaw/OpenCode 差距补齐、多端形态；按 §6.6 优先级推进。 |

---

## 4. 文档与维护

- 本计划与 `SUPER_AI_PROMPT_AND_EVOLUTION_PLAN.md`、`APPS_AND_AI_STATUS.md`、`DEVELOPMENT.md` 互补；大方向以本计划为准，细节可引用上述文档。
- **Skills 专项**：OpenClaw/OpenCode 的 Skills 设计与 X-Computer 对齐方案见 [REFERENCE_OPENCLAW_OPENCODE_SKILLS.md](./REFERENCE_OPENCLAW_OPENCODE_SKILLS.md)。
- **差距与补齐规划**：与 OpenClaw/OpenCode 的详细差距及阶段七、八任务见 [§6 与 OpenClaw / OpenCode 的差距与补齐规划](#6-与-openclaw--opencode-的差距与补齐规划)。
- 每完成一项任务，在本文档更新状态，并在对应代码或文档中注明「对齐 OpenClaw/OpenCode」或引用本计划。

---

## 5. 下一迭代功能规划（建议）

在阶段一～六主体已完成、图片生成与对话历史已落地的前提下，建议下一迭代从下面选一或按序推进：

### 选项 A：测试覆盖补全（阶段六 6.2）— 推荐优先

| 目标 | 关键 API 与路径有自动化测试，防止回归。 |
|------|----------------------------------------|
| 任务 | ① 为 `/api/chat/generate-image`、`/api/chat/classify-writing-intent`、聊天会话 messages（含 images）补充集成测试或单测；② 为记忆召回/捕获、LEARNED_PROMPT 读写补一条链路测试；③ 确保 `cd server && npm run test` 在 Node 22 下稳定通过。 |
| 产出 | `api.test.ts` 或专项 `chatSessions.test.ts` 等中新增用例；CI 可依赖。 |

### 选项 B：更多工具真实化（阶段四 4.3）— 按需

| 目标 | 主脑在任务/对话中能调用 1～2 个新真实工具。 |
|------|--------------------------------------------|
| 任务 | 从「计划中的工具」中选一项先做，例如：**search.web**（对接搜索 API 或 MCP）、**llm.analyze**（真实 LLM 分析文本/意图）。每项单独评审、在 ToolExecutor 注册、在 TaskPlanner/LLM 规划中可用。 |
| 产出 | 新工具名注册、输入输出与 step 结构兼容、文档与简单测试。 |

### 选项 C：Skill 注册与发现（进化闭环）

| 目标 | 支持「Skill」为可发现的能力描述（SKILL.md 或配置），注册后进入能力列表并可被主脑建议/触发；可选提供「加载 Skill 内容到上下文」的调用路径（对齐 OpenCode skill 工具）。 |
|------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 任务 | ① 定义 Skill 描述结构（名称、描述、来源、可执行入口/内容），对齐 OpenCode Skill.Info 与 Claude SKILL.md frontmatter；② 从配置或目录发现 Skill（如 `skills.paths`、`**/SKILL.md`）并调用 `registerCapability(..., source: 'skill')`；③ 主脑提示中已含「当前可用能力」，确保 Skill 出现在列表中；④ 可选：提供「skill 工具」按 name 加载 SKILL.md 内容并返回给会话/任务上下文（子进程或 MCP 式执行可后续扩展）。 |
| 产出 | Skill 发现与注册链路、文档（如 SKILL_REGISTRY.md 或见 REFERENCE_OPENCLAW_OPENCODE_SKILLS.md）、与现有 CapabilityRegistry 集成。 |
| 参考 | **[REFERENCE_OPENCLAW_OPENCODE_SKILLS.md](./REFERENCE_OPENCLAW_OPENCODE_SKILLS.md)**：OpenClaw/OpenCode/Claude Skills 设计汇总与 X-Computer 对齐方案。 |

### 建议顺序

1. **先做 A（测试覆盖）**：保证当前能力（图片生成、会话历史、提示词丰富）有测试兜底，再加新工具或 Skill 更稳。
2. 若更看重「主脑能多做事」，可先做 **B 中 search.web 或 llm.analyze**，再做 A。
3. **C（Skill）** 可作为再下一迭代，与 MCP 形成「内置 + MCP + Skill」三源能力。

---

## 6. 与 OpenClaw / OpenCode 的差距与补齐规划

本节汇总 X-Computer 与 OpenClaw、OpenCode 的功能差距，并将补齐任务纳入开发计划。需求 ID 与 [REQUIREMENTS.md](./REQUIREMENTS.md) 对应。

### 6.1 三者定位简要对比

| 维度 | **X-Computer** | **OpenClaw** | **OpenCode** |
|------|----------------|--------------|--------------|
| **定位** | AI 驱动整机：Web 桌面 + 办公应用 + 四域任务 + X 主脑 | 本地「数字员工」：多平台消息 + 浏览器自动化 + 心跳式主动执行 | 开源 AI 编程 Agent：终端/VS Code/桌面，专注代码 |
| **形态** | Web 单页桌面应用 | 本地进程，可无头/服务端 | CLI + VS Code 扩展 + Desktop App |
| **数据** | 多用户、云端配置、沙箱按用户隔离 | 本地为主，不依赖外服 | 本地优先，可选分享链接 |

### 6.2 对齐 OpenClaw 的差距与补齐任务

| 差距 | OpenClaw 能力 | X-Computer 现状 | 补齐任务 |
|------|---------------|-----------------|----------|
| **浏览器自动化** | 独立 Chrome/Chromium 实例，网页自动化、抓取、填表 | 仅有内置「浏览器」应用（URL+书签），无自动化 | 阶段七：新增 `browser.*` 工具（browser.navigate、browser.snapshot、browser.click 等），可选对接 Playwright/Puppeteer 或无头实例 |
| **多平台消息** | 13+ 渠道：WhatsApp、Telegram、Slack、Discord、WeChat、Signal、iMessage 等 | 仅有邮件 + 应用内 x.notify_user | R017 对外触达：邮件已完成，Slack/推送等待扩展；纳入阶段七或独立迭代 |
| **Heartbeat 心跳** | 周期性检查条件并自动执行（简报、监控、阈值告警） | 有定时 + 事件驱动 + 信号触发，无统一「条件检查→执行」心跳引擎 | 阶段七：可选引入「条件监控 + 满足即跑」的 Heartbeat 式调度，复用现有 signal.emit + X 定时 |
| **Skill 状态与 UI** | 100+ SkillHub Skills，按来源分组、启用/依赖/安装/API Key 管理 UI | 有 Skill 自安装，R007 Skill 注册与发现待开发 | R007、选项 C：Skill 发现 + 注册到 CapabilityRegistry + 主脑可见；后续增强：Skill 状态 API、依赖检查、安装 UI（对齐 OpenClaw skills.status/update/install） |
| **语音与移动端** | 语音交互、iOS/Android、相机/录屏 | 无 | P3：长期规划，暂不纳入近期迭代 |

### 6.3 对齐 OpenCode 的差距与补齐任务

| 差距 | OpenCode 能力 | X-Computer 现状 | 补齐任务 |
|------|---------------|-----------------|----------|
| **多端形态** | Terminal UI + VS Code 扩展 + Desktop App，上下文可延续 | 仅 Web 桌面 | 阶段八：可选提供 CLI、VS Code 扩展或独立桌面客户端，与现有 Web API 共用后端 |
| **Agent 角色分工** | Build/Plan/General/Explore 等专用 agent，并行 Session | 有 agent/team/group，无角色化分工、无并行 Session | 阶段七或八：可选引入 Plan/Explore 等只读/规划型 agent，支持多 Session 并行 |
| **LSP 集成** | 深度 LSP，类型/定义感知，减少幻觉 | 代码编辑在 Web 内，无 IDE/LSP 集成 | P3：长期规划，或通过 MCP 接入 LSP 服务 |
| **细粒度权限** | Allow/Ask/Deny 控制命令与文件修改 | 有审批模式与策略引擎，非逐操作 Ask | 阶段七：可选增强 PolicyEngine，支持「每类操作 Allow/Ask/Deny」 |
| **一键安装** | curl/npm/Homebrew 一条命令 | 需 clone/配置、`npm run dev` | 阶段七：提供 `npx create-x-computer` 或官方安装脚本 |

### 6.4 X-Computer 自主闭环的优先补齐项

以下为促成 X「完全自主」与「可扩展」的核心需求，与 REQUIREMENTS.md 对应：

| 需求 ID | 描述 | 状态 | 阶段归属 |
|---------|------|------|----------|
| **R007** | Skill 注册与发现：发现 SKILL.md、注册到能力列表、主脑可见，可选 skill 工具加载内容 | 待开发 | 选项 C / 阶段七 |
| **R016** | X 创建/更新系统任务：主脑通过工具创建任务进任务时间线，用户可见、可审批或自动执行 | 待开发 | 阶段七 |
| **R017** | X 对外触达：邮件已完成；Slack/推送等待扩展 | 开发中 | 阶段七 |
| **R019** | X 资源与限流：单次 max_steps、每日/每周预算或次数上限，防止失控 | 待开发 | 阶段七 |
| **R023** | 小程序/小游戏创作增强：资源约定、主脑指引，使 X 能产出可玩小游戏 | 待开发 | 阶段七 |
| **R028** | 沙箱文件云端存储与跨设备同步：沙箱文件上云（S3/Blob）、多设备按需/批量同步 | 待开发 | 阶段七 |
| **R035** | X 编程与制作 Skill/工具：X 可通过编程创建新 Skill、自定义工具，形成自扩展能力链 | 待开发 | 阶段七 |

### 6.5 新增阶段七、八概要

| 阶段 | 目标 | 主要任务 |
|------|------|----------|
| **阶段七：OpenClaw/OpenCode 差距补齐** | 缩小与两个参考标准的差距，并完成 X 自主闭环 | ① R007 Skill 注册与发现；② R016 X 创建系统任务；③ R017 Slack/推送；④ R019 资源与限流；⑤ R023 小程序/小游戏增强；⑥ R028 沙箱云端同步；⑦ R035 X 制作 Skill/工具；⑧ 可选：browser.* 工具、Heartbeat 式条件监控、Skill 状态 UI |
| **阶段八：多端与形态扩展（可选）** | 支持 CLI、VS Code 扩展或桌面 App | ① CLI 或 npx 安装脚本；② VS Code 扩展（与 Web 共用 API）；③ 独立桌面客户端（可选） |

### 6.6 实施优先级建议（更新）

| 优先级 | 内容 | 理由 |
|--------|------|------|
| P1 | R007 Skill 注册与发现、R016 X 创建系统任务 | 主脑能力扩展与「派活到时间线」闭环 |
| P1 | R019 资源与限流 | 防止失控与成本爆掉 |
| P2 | R023 小程序/小游戏增强、R028 沙箱云端同步 | 提升创作体验与跨设备体验 |
| P2 | R017 Slack/推送、R035 X 制作 Skill/工具 | 对外触达与自扩展 |
| P3 | browser.* 工具、Heartbeat、多端形态、LSP | 对齐参考标准，可分批推进 |
