# X 编程与制作 Skill/工具 规划

本文档规划「X 可以编程、制作 Skill 和工具」的能力，使 X 形成**自扩展能力链**：不仅使用现有工具，还能通过编程创建新 Skill、封装可复用工具。

**关联需求**：R035。

---

## 1. 目标

| 能力 | 说明 |
|------|------|
| **X 编程** | 已有 file.write + shell.run + python.run，强化：错误反馈、迭代调试、多语言（Node/ Python/Shell）支持与指引 |
| **制作 Skill** | X 可编写 SKILL.md 并写入可发现目录，系统发现后可供 skill.load 加载，形成「X 写的领域能力」 |
| **制作工具** | X 可创建「可复用工具」：封装脚本为工具、或通过 Skill 描述工作流式工具；高阶可支持动态注册到 ToolExecutor |

---

## 2. 当前能力基础

- **file.write / file.read / file.replace**：读写沙箱文件
- **shell.run**：在沙箱工作区执行命令，cwd 为宿主机工作区路径（R034 已完成）
- **python.run**：执行沙箱内 .py 脚本
- **skill.load**：加载已发现 Skill 的 SKILL.md 内容到上下文
- **skill.install / skill.uninstall / skill.list_remote**：从 SkillHub/URL 安装、删除、搜索 Skill
- **getDiscoveredSkills**：发现 skills 目录下 SKILL.md
- **MCP**：可注入外部工具，X 使用 MCP 工具

---

## 3. 分阶段方案

### 3.1 阶段一：X 制作 Skill（P1）

**目标**：X 能通过写 SKILL.md 创建新 Skill，系统自动发现并供 skill.load 使用。

**实现要点**：

1. **用户沙箱内 skills 目录**  
   - 约定：`workspace/skills/<skill-name>/SKILL.md` 为 X 可写的 Skill 目录  
   - `getDiscoveredSkills()` 扩展：除项目级 `skills/` 外，扫描 `userWorkspace/skills/**/SKILL.md`

2. **工具 `skill.create`**  
   - 参数：`name`、`description`、`content`（SKILL.md 正文，含 frontmatter）  
   - 行为：在 `workspace/skills/<name>/` 创建 SKILL.md，格式符合现有解析规则  
   - 可选：`skill.update`、`skill.remove`（删除自建 Skill）

3. **发现与加载**  
   - 安装的 Skill（skill.install）与 X 自建 Skill 统一出现在「已发现 Skill」列表  
   - skill.load 可按 name 加载自建 Skill

**依赖**：`getDiscoveredSkills` 需支持多路径（项目 skills + 用户 workspace/skills）。

---

### 3.2 阶段二：编程增强与脚本封装（P2）

**目标**：改善 X 编程体验，并支持将脚本「封装」为可复用单元。

**实现要点**：

1. **编程指引**  
   - 在 systemCore / x_direct 提示中注入：如何用 file.write + shell.run/python.run 迭代开发、常见错误与排查

2. **脚本封装为「工具」**  
   - 约定：`workspace/tools/<tool-name>/` 下放 `run.js` 或 `run.py` + `tool.json`（name、description、parameters）  
   - 工具 `tool.register_script`：X 注册一个脚本工具，参数为 path、tool.json 定义  
   - ToolExecutor 动态工具：根据 tool.json 生成 LLM 工具定义，执行时 `shell.run` 或 `python.run` 对应脚本  
   - 或更简化：`tool.run_script`：传入 path、args，执行 `workspace/tools/<name>/run.{js|py}`，返回 stdout/stderr

3. **与 Skill 结合**  
   - Skill 内可描述「本 Skill 依赖哪些脚本工具」，或直接内嵌执行步骤（调用 tool.run_script）

---

### 3.3 阶段三：动态工具注册（P3）

**目标**：X 创建的工具可像内置工具一样出现在主脑工具列表，供 LLM 直接调用。

**实现要点**：

1. **ToolExecutor 动态工具**  
   - 已有 `registerDynamicTool`，支持按 scope（如 mcp:userId）注册  
   - 新增 scope：`user_tools:userId`，用于 X 创建的工具

2. **工具 `tool.create`**  
   - 参数：name、description、parameters（JSON Schema）、handler 类型（`script`）和 path  
   - 行为：生成 ToolDefinition + Handler，注册到 `user_tools:userId`  
   - 持久化：存 `x_user_tools` 配置或 DB，重启后恢复

3. **安全与限制**  
   - 仅允许调用沙箱内脚本，禁止任意系统命令  
   - 参数校验、超时、输出截断  
   - 可选：用户审批「X 要创建新工具」后再注册

---

## 4. 与现有能力的衔接

| 现有能力 | 衔接方式 |
|----------|----------|
| skill.install | 安装的 Skill 与 X 自建 Skill 一起发现、load |
| skill.load | 自建 Skill 与安装 Skill 无差别，按 name 加载 |
| MCP | MCP 注入的工具与 X 自建工具并存，主脑可见全部 |
| x.create_app | 小程序侧重「有界面的应用」，脚本工具侧重「无界面可调用能力」，可互相引用（如小程序调脚本工具） |

---

## 5. 建议实现顺序

| 顺序 | 内容 | 优先级 | 预估 |
|------|------|--------|------|
| 1 | 用户 workspace/skills 扫描 + skill.create 工具 | P1 | 1–2 天 |
| 2 | 编程指引注入 systemCore | P2 | 0.5 天 |
| 3 | 脚本工具约定 + tool.run_script 或 tool.register_script | P2 | 1–2 天 |
| 4 | 动态工具注册 + tool.create + 持久化 | P3 | 2–3 天 |

---

## 6. 验收标准

- **阶段一**：X 可通过 `skill.create` 创建 SKILL.md，`getDiscoveredSkills` 能发现，`skill.load` 能加载并在对话中按 Skill 内容行动。
- **阶段二**：X 可在 workspace/tools 下放置脚本，通过 `tool.run_script` 或等价方式执行并复用。
- **阶段三**：X 创建的工具出现在主脑工具列表，LLM 可直接按名称调用，行为与内置工具一致。
