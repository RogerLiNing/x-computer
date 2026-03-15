# OpenClaw / OpenCode Skills 参考与 X-Computer 对齐方案

本文档汇总 **OpenClaw** 与 **OpenCode** 中与 **Skills** 相关的设计与实现，并给出在 X-Computer 中接入 Skills 的实施方案（对齐 [DEV_PLAN_OPENCLAW_OPENCODE.md](./DEV_PLAN_OPENCLAW_OPENCODE.md) 选项 C）。

**参考代码位置**：
- OpenClaw：`projects-for-reference/openclaw/src/agents/skills*.ts`、`gateway/server-methods/skills.ts`、`ui/views/skills.ts`
- OpenCode：`projects-for-reference/opencode/packages/opencode/src/skill/`、`tool/skill.ts`
- Claude Skills 格式：`projects-for-reference/claude-skills/skills/**/SKILL.md`

---

## 1. 概念对齐

| 维度 | OpenClaw | OpenCode | Claude Skills（格式参考） |
|------|----------|----------|---------------------------|
| **Skill 是什么** | 可启用/禁用的「能力单元」，带依赖检查、安装选项、API Key 配置 | 以 **SKILL.md** 为入口的「领域说明 + 工作流」，通过工具 **加载到对话上下文** | 每个 Skill 一个目录，内含 SKILL.md（frontmatter + 正文） |
| **发现方式** | 工作区 + 内置 + 托管目录 + 插件目录，统一 `loadWorkspaceSkillEntries` | `.claude/skills/`、`.agents/skills/`、`.opencode/skill/`、config.paths、config.urls（index.json 拉取） | 仓库内 `skills/**/SKILL.md`，frontmatter 含 name/description |
| **对主脑的暴露** | 状态接口（skills.status）、启用/禁用、安装、API Key；可参与 prompt 组装 | **工具** `skill`：列出可用 Skill，`execute(name)` 返回 `<skill_content>` 注入上下文 | 供 Claude Code / 生态使用；name、description、triggers、related-skills 等 |
| **执行/调用** | 配置级（启用/禁用）、安装命令、API Key；不直接「执行 Skill 脚本」 | **执行 = 加载内容**：把 SKILL.md 正文 + 同目录文件列表注入到当前会话，由模型按说明行动 | 无统一执行层，由客户端/MCP 按 SKILL 内容解释 |

结论：**OpenCode 的「Skill = 可发现的 SKILL.md + 通过工具加载到上下文」** 与 X-Computer 的「能力注册 + 主脑提示注入」最容易对齐；**OpenClaw 的「状态 + 启用/安装/API Key」** 可作为后续增强（状态 API、配置化启用、可选安装流程）。

---

## 2. OpenCode Skill 实现要点

### 2.1 Skill 描述结构

- **Skill.Info**（`skill/skill.ts`）：`name`、`description`、`location`（SKILL.md 路径）、`content`（解析后的 markdown 正文）。
- 通过 **ConfigMarkdown.parse(match)** 解析 SKILL.md，frontmatter 中至少需要 `name`、`description`；校验失败或重复 name 会跳过/告警。

### 2.2 发现路径（优先级从低到高）

1. **外部目录（Claude Code 兼容）**：`~/.claude/skills/`、`~/.agents/skills/`，以及从当前目录向 worktree 上溯的 `.claude`、`.agents` 下的 `skills/**/SKILL.md`。
2. **OpenCode 自有目录**：各 config directory 下的 `skill/**/SKILL.md`、`skills/**/SKILL.md`。
3. **配置中的 paths**：`config.skills.paths` 数组，支持 `~/`、相对路径（相对项目根）、绝对路径；在对应目录下递归 `**/SKILL.md`。
4. **配置中的 urls**：`config.skills.urls`，通过 **Discovery.pull(url)** 拉取 `{url}/index.json`（格式：`{ skills: [ { name, description, files: string[] } ] }`），按 `files` 下载到缓存目录，再在本地目录内扫描 `**/SKILL.md`。

### 2.3 工具「skill」的行为

- **描述**：说明「当任务匹配下列可用 Skill 时，可调用本工具加载完整说明与工作流」；在描述中内嵌 `<available_skills>` 列表（name、description、location）。
- **参数**：`name`（从 available_skills 中选）。
- **execute(name)**：
  - 解析 Skill 所在目录，列出同目录下部分文件（如最多 10 个，排除 SKILL.md）作为 `<skill_files>`。
  - 返回一段 **XML 风格输出**：`<skill_content name="...">` 内含 Skill 名称、`content` 全文、base directory、文件列表说明；供模型将 Skill 当作「当前上下文中加载的领域指南」使用。

因此：**OpenCode 的「执行」= 把 Skill 内容注入会话，而不是跑脚本**；是否按 Skill 做事完全由模型根据内容决定。

### 2.4 配置 schema（OpenCode）

```ts
skills?: {
  paths?: string[];  // 额外 Skill 目录，支持 ~/、相对、绝对
  urls?: string[];   // 拉取 index.json 的 URL，下载后扫描 SKILL.md
}
```

---

## 3. OpenClaw Skill 实现要点

### 3.1 类型与状态

- **SkillEntry**：`skill`（name、description 等）、`frontmatter`、`metadata`（OpenClaw 扩展：install、requires、always、skillKey、primaryEnv、emoji、homepage 等）。
- **SkillStatusEntry**：在 SkillEntry 基础上增加运行时状态：`source`、`bundled`、`filePath`、`baseDir`、`skillKey`、`enabled`、`disabled`、`blockedByAllowlist`、`eligible`、`requirements`/`missing`（bins、env、config、os）、`configChecks`、`install`（安装选项列表）。
- **SkillStatusReport**：`workspaceDir`、`managedSkillsDir`、`skills: SkillStatusEntry[]`。

### 3.2 发现来源

- 通过 **loadWorkspaceSkillEntries(workspaceDir, opts)** 汇总：
  - 工作区目录内扫描（含 `loadSkillsFromDir`，来自 `@mariozechner/pi-coding-agent`）；
  - 内置（bundled）目录；
  - 托管目录（managed）；
  - 插件提供的目录（plugin-skills）。
- 每条 Skill 有 **source** 标识：如 `openclaw-workspace`、`openclaw-bundled`、`openclaw-managed`、`openclaw-extra`。

### 3.3 网关接口

- **skills.status**：可选 `agentId`，返回该 agent 工作区的 SkillStatusReport。
- **skills.update**：`skillKey` + 可选 `enabled`、`apiKey`、`env`；写回配置（如 `config.skills.entries[skillKey]`）。
- **skills.install**：`name`、`installId`、`timeoutMs`；执行安装（如运行 brew/node/go/uv 等），安装后技能进入 managed 目录。
- **skills.bins**：返回所有 Skill 依赖的 bins 并集，供环境检查。

### 3.4 UI

- Skills 视图：按 source 分组（Workspace / Built-in / Installed / Extra），展示启用状态、缺失依赖、安装按钮、API Key 输入等；支持筛选、刷新、启用/禁用、保存 API Key、安装。

---

## 4. Claude Skills 的 SKILL.md 格式（参考）

- **Frontmatter**（YAML）：`name`、`description` 必选；`metadata` 下可含 `triggers`、`related-skills`、`version`、`author`、`domain` 等。
- **正文**：Role Definition、When to Use This Skill、Core Workflow、Reference Guide（表格：Topic / Reference / Load When）、Constraints（MUST DO / MUST NOT DO）、Output Templates 等。
- 目录内常有 `references/`、脚本等；OpenCode 的 skill 工具会列出同目录文件并注明 base path，便于模型按「引用路径」加载。

---

## 5. X-Computer 对齐方案（选项 C 细化）

与 [DEV_PLAN_OPENCLAW_OPENCODE.md](./DEV_PLAN_OPENCLAW_OPENCODE.md) 中「选项 C：Skill 注册与发现」一致，建议分步实现：

### 5.1 目标

- **Skill** = 可发现的「能力描述」（名称、描述、可执行入口/内容）；注册后进入 **能力列表**，主脑提示中的「当前可用能力」包含 Skill；可选地提供「执行某 Skill」的调用路径（先做「加载到上下文」，再做子进程/MCP 式执行）。

### 5.2 建议实现步骤

| 步骤 | 内容 | 对齐参考 |
|------|------|----------|
| 1 | **定义 Skill 描述结构** | OpenCode Skill.Info + Claude frontmatter |
| 2 | **从配置或目录发现 Skill** | OpenCode 的 paths/urls + `.claude/skills/` 风格目录 |
| 3 | **发现后调用 registerCapability** | 与现有 CapabilityRegistry、MCP 一致 |
| 4 | **主脑提示中包含 Skill** | 已存在「当前可用能力」注入，确保 Skill 出现在 listAllCapabilities 中 |
| 5 | **可选：提供「执行」入口** | OpenCode 的 skill 工具：按 name 加载 SKILL.md 内容并返回给调用方（会话/任务上下文） |

### 5.3 数据结构建议（X-Computer）

- **Skill 描述**（与 OpenCode/Claude 兼容）：
  - `id`：唯一标识（可与 name 一致或从目录名推导）。
  - `name`：显示名。
  - `description`：简短描述，用于能力列表与主脑提示。
  - `location`：SKILL.md 或等效入口路径（沙箱内或配置路径）。
  - `content`：可选，解析后的 markdown 正文（用于「加载到上下文」时返回）。
- **发现配置**（可放用户配置或工作区）：
  - `skills.paths`：目录列表，在每目录下扫描 `**/SKILL.md`。
  - `skills.urls`：可选，拉取 index.json 再下载并扫描（与 OpenCode Discovery.pull 一致）。

### 5.4 与现有组件的关系

- **CapabilityRegistry**：Skill 发现后调用 `registerCapability({ name, description, source: 'skill' })`，与 MCP 的 `source: 'mcp'` 并列；`listAllCapabilities(builtin)` 已含 extra，Skill 自然出现在主脑提示中。
- **主脑提示**：无需改 systemCore 的占位逻辑，只要 Skill 被 registerCapability 即可。
- **执行**：第一阶段可只做「发现 + 注册」；第二阶段增加「skill 工具」：接收 name，读取对应 SKILL.md 内容，返回给 chat/agent 作为上下文块（或写入任务步骤的 output），与 OpenCode 的 `SkillTool` 行为对齐。若需「运行脚本」，再考虑子进程或 MCP 调用（类似 OpenClaw install 的扩展）。

### 5.5 文档与配置

- 新增 **SKILL_REGISTRY.md**（或在本文档中增节）：说明如何放置 SKILL.md、配置 paths/urls、与 MCP/内置能力的关系。
- 配置：若采用用户级/工作区级配置，可复用现有 `user_config` 或工作区根目录配置文件，增加 `skills.paths`、`skills.urls` 字段。

---

## 6. 小结

- **OpenCode**：Skill = SKILL.md（name + description + content），多路径/URL 发现，通过 **skill 工具** 按 name 加载内容注入会话；无独立「执行脚本」接口。
- **OpenClaw**：Skill = 同构描述 + 丰富状态（enabled、依赖、安装、API Key），通过 **skills.status/update/install** 做配置与安装；UI 按 source 分组管理。
- **X-Computer**：先实现「发现 + 注册到 CapabilityRegistry + 主脑可见」；再实现「skill 工具：按 name 加载 SKILL.md 内容返回」，形成「内置 + MCP + Skill」三源能力，与开发计划选项 C 一致。

上述方案可直接作为「Skill 注册与发现」迭代的任务拆分与实现参考；若后续需要 OpenClaw 式的状态接口与安装流程，可在本方案基础上增加状态 API 与配置化启用/安装。

---

## 7. 扩展：Skills 自安装与缺 Key 流程

X 可自主安装 Skill、在需要 API Key 时引导用户配置的完整方案，见 [SKILLS_SELF_INSTALL_PLAN.md](./SKILLS_SELF_INSTALL_PLAN.md)，对应需求 R031。
