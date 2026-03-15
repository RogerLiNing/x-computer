# X 办公能力与 Agent 团队设计

本文档描述 X 主脑在「帮助用户办公」方向上的能力升级：**Agent 集群/团队**、**角色扮演**、**文件与办公文档**、**连接外部**。与 REQUIREMENTS.md 中 R026 对应。

---

## 1. 目标

- **Agent 团队**：X 可创建由多个智能体组成的「团队」，按顺序或分工协作完成办公类任务（如周报：收集→撰写→审核）。
- **角色扮演**：每个智能体可有明确角色（如写手、审核、数据分析师），便于 X 组队与派活。
- **使用文件**：X 与智能体均可使用 file.\*、office.\*（Word/Excel/PPT）读写沙箱文件，完成文档、表格、汇报等办公产出。
- **连接外部**：通过 http.request、MCP 等连接外部 API 或服务；后续可扩展邮件/Slack（R017）等触达。

---

## 2. 已有能力（直接复用）

| 能力 | 说明 |
|------|------|
| **文件** | file.read / file.write / file.replace / file.list；office.create_docx、read_docx、create_xlsx、read_xlsx、create_pptx（R024） |
| **外部** | http.request 发 HTTP 请求；MCP 注入后可用搜索、自定义工具等 |
| **单智能体** | x.create_agent、x.list_agents、x.run_agent、x.update_agent、x.remove_agent；智能体有 systemPrompt、toolNames |

---

## 3. 新增/增强

### 3.1 智能体角色（role）

- 在 `AgentDefinition` 中增加可选字段 **`role`**（如「写手」「审核」「数据分析师」）。
- 创建/更新智能体时可指定 role；列表与运行逻辑不变，仅作为展示与组队时的语义标签，X 在组队或派活时可参考角色名。

### 3.2 Agent 团队（Team）

- **数据**：团队 = 名称 + 有序的 agent id 列表。存储于用户配置 `x_agent_teams`（与 `x_agents` 同级）。
- **工具**：
  - **x.create_team**：name、agent_ids（数组，顺序即执行顺序）。
  - **x.list_teams**：列出当前用户所有团队（id、name、agentIds）。
  - **x.run_team**：team_id + goal。按 agent_ids 顺序依次执行：第一个 agent 的 goal 为本次 goal；后续每个 agent 的 goal 为「上一环节输出：{prev}\n\n本次目标：{goal}」或由 X 在单次调用时传入 per_step_goals（可选扩展）。
  - **x.update_team** / **x.remove_team**：更新名称或成员、删除团队。
- **执行语义**：run_team 为**顺序执行**（流水线），前一智能体输出作为下一智能体的上下文，适合「收集→撰写→审核」类办公流程。并行执行可由 X 多次调用 x.run_agent 自行编排。

### 3.3 Agent 群组（Group，类似群聊）

- **与团队的区别**：团队是**流水线**（顺序执行、上一环节输出给下一环节）；群组是**群聊式**：主脑创建一个群组，把若干智能体拉进群，需要时向群组派发一个任务/话题，各成员分别干活，主脑**收集所有人的结果**，可再引导或汇总。
- **数据**：群组 = 名称 + 成员 agent id 列表。存储于用户配置 `x_agent_groups`。
- **工具**：
  - **x.create_group**：name、可选 agent_ids（可先建空群再往里加人）。
  - **x.list_groups**：列出当前用户所有群组。
  - **x.add_agents_to_group**：group_id、agent_ids，把已有智能体加入群组。
  - **x.remove_agents_from_group**：group_id、agent_ids，从群组移除成员。
  - **x.run_group**：group_id、goal。向群组派发任务：每个成员用同一 goal 执行一轮，主脑**收集各成员输出**（results 数组），可据此汇总或再引导。
  - **x.update_group** / **x.remove_group**：改群名、删群。
- **使用场景**：多角色对同一议题分别贡献（如「大家各自写一段对某需求的看法」）、头脑风暴、分工收集后由主脑汇总等。
- **用户可见、可打断、可补充**：群组执行时通过 WebSocket（app_channel 'x'）推送进度（group_run_progress），前端 X 主脑对话中展示「群组执行中：2/5 人，当前：写手」并提供「停止」按钮；用户可调用 POST /api/x/cancel-group-run 打断执行。执行完成后对话中展示「群组执行结果」卡片（各成员产出），用户可在同一对话中补充指令（如「把上面三个人的结果合并成一份总结」）。
- **群组对话与工作过程可查**：每次 x.run_group 执行（含被用户打断）会写入用户配置 `x_group_run_history`（最近 50 条）。GET /api/x/group-run-history?groupId=&limit=30 可按群组筛选、分页查看。智能体管理 → 群组 Tab 下提供「执行记录」列表，可展开单条查看目标与各成员产出，便于回顾对话与工作过程。

### 3.4 主脑提示词（办公与团队）

- 在系统提示中增加「办公与团队协作」段落，明确：
  - 可使用 **文件与办公文档**：file.\*、office.\* 读写沙箱内文档与表格，用于周报、汇报、数据整理等。
  - **智能体可设角色**：创建/更新智能体时可指定 role（如写手、审核），便于组成「写作团队」「分析团队」。
  - **团队**：用 x.create_team 将多个智能体组队，用 x.run_team 按顺序执行流水线任务；适合多步骤办公（如先收集数据再撰写再审核）。
  - **群组（类似群聊）**：用 x.create_group 建群（可先空群），用 x.add_agents_to_group 把智能体拉进群；用 x.run_group（group_id、goal）向群组派发任务，各成员按同一目标干活，你收集所有人的结果（results 列表），可再汇总或继续引导。
  - **连接外部**：通过 http.request、MCP 调用外部 API 或服务；需要触达用户时用 x.notify_user，后续可扩展邮件/Slack。

---

## 4. 实现要点

- **shared**：`AgentDefinition` 增加 `role?: string`；新增 `AgentTeam` 类型（id, name, agentIds, createdAt, updatedAt）。
- **server**：user_config 存 `x_agent_teams`、`x_agent_groups`（JSON 数组）；ToolExecutor 注册团队与群组工具；run_team 顺序执行并传上一轮输出；run_group 对每个成员执行同一 goal 并收集 results。
- **frontend**：智能体管理支持 role 的展示与编辑；可选「团队/群组管理」入口。
- **主脑提示**：systemCore 增加「办公与团队协作」块，含团队与群组说明，见上。

---

## 5. 与现有需求的关系

- **R024**：办公文档（docx/xlsx/pptx）已实现，本设计强调在提示词中明确「办公场景下使用文件与 office 工具」。
- **R017**：对外触达（邮件/Slack）仍为待开发；本阶段仅明确「连接外部」以 http.request、MCP 为主，触达用户以 x.notify_user 为主。
