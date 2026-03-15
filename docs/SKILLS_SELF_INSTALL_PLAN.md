# X Skills 自安装与工具配置方案

借鉴 OpenClaw 的 tools + skills 模式，让 X 能**自行安装 Skills 和工具**，在需要 API Key 等凭证时**主动询问用户**。本文档为设计与实现规划。

---

## 1. 目标

1. **X 自主安装 Skill**：从 SkillHub、GitHub、或预定义 registry 拉取并安装 Skill（SKILL.md + 相关文件）。
2. **需要密钥时询问用户**：Skill 或工具需要 API Key、env 时，通过 `x.notify_user` 说明所需内容，用户到「设置 → Skills」填写后，X 继续执行。
3. **工具按需/分档暴露**：可选减少单次请求工具数量（profiles / 按场景筛选），避免 60+ 工具一次性全暴露；核心工具 + skills 列表 + 按需 `skill.load` 仍为主模式。

---

## 2. 与 OpenClaw 的对应关系

| OpenClaw | X-Computer 对应 |
|----------|-----------------|
| skills.status | 已有 `getDiscoveredSkills()`，可扩展返回 `requiresApiKey`、`configOk` 等状态 |
| skills.update | 新增 `skill.update_config`：保存 apiKey、env 到 user_config（skill_config） |
| skills.install | 新增 `skill.install`：从 URL 下载并解压到 skills 目录 |
| skills.uninstall | 新增 `skill.uninstall`：从本地删除 Skill（传入 name_or_dir） |
| SkillHub install | `skill.install` 支持 source 为 `skillhub:<slug>` 或直接 GitHub/URL |
| 需要 Key 时 UI 输入 | X 用 `x.notify_user` 提示 → 用户到设置 → 保存后 X 重试 |

---

## 3. 新增工具

### 3.1 `skill.install`

**用途**：X 自主安装 Skill 到本地 skills 目录。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| source | string | 是 | 来源：`skillhub:<slug>`、`github:<owner>/<repo>`、或直接 URL（zip/tar.gz） |
| name | string | 否 | 安装后目录名，默认从 source 推导 |

**实现要点**：

- **skillhub**：调用 SkillHub API 或 index.json 获取下载 URL，再走 download 流程。
- **github**：使用 `https://github.com/<owner>/<repo>/archive/refs/heads/main.zip` 等，解压到 `skills/<dirName>/`。
- **直接 URL**：fetch 后解压到 skills 目录。
- 安装目录：`getSkillsRoot()/<dirName>/`，必须含 `SKILL.md`，否则视为失败。
- 安装后调用 `getDiscoveredSkills()` 会包含新 Skill，下一轮对话即可 `skill.load`。

**安全**：

- 仅允许写入 `skills/` 下，禁止路径穿越。
- 可选：安装前扫描 SKILL.md + 同目录文件，发现危险模式时拒绝（参考 OpenClaw `skill-scanner`）。

---

### 3.1b `skill.uninstall`

**用途**：从本地删除已安装的 Skill，供 X 按用户要求移除不再需要的 Skill。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name_or_dir | string | 是 | Skill 名称（与列表显示一致）或目录名（如 summarize、serpapi-search） |

**实现**：优先按目录名匹配，若无则按 `name`/`id` 查找 `dirName`，调用 `deleteSkill(dirName)` 删除 `skills/<dirName>/` 目录。

---

### 3.2 `skill.update_config`

**用途**：将用户提供的 API Key 或 env 写入当前用户的 `skill_config`，供 Skill 工具（如 zhipu_web_search）使用。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skill_name | string | 是 | Skill 名称（与 SKILL.md frontmatter name 一致） |
| api_key | string | 否 | API Key，若为空则清除 |
| env | object | 否 | 额外环境变量，如 `{ "ZHIPU_WEB_SEARCH_API_KEY": "..." }` |

**注意**：

- 本工具**不应由 LLM 直接传入用户真实 Key**。正确流程是：
  1. X 发现 Skill 需要 Key → 调用 `x.notify_user` 说明「请到设置 → Skills 中为 xxx 填写 API Key」；
  2. 用户手动在设置页填写并保存；
  3. 或：用户通过某种安全方式（如 paste 到对话）提供后，由**用户主动触发**的「写入配置」操作调用本工具（需谨慎，避免 Key 进日志）。
- 建议：`skill.update_config` 主要用于**程序化写入**（如 OAuth 回调、安装脚本），日常缺 Key 时仍以 `x.notify_user` + 用户手动配置为主。若需支持「用户粘贴 Key 后由 X 写入」，需在审计日志中脱敏，且仅在用户显式确认时调用。

**简化方案**：首版不暴露 `skill.update_config` 给 LLM，仅通过 `x.notify_user` 引导用户到设置页。后续若需「用户粘贴后自动保存」，再开放并加权限控制。

---

### 3.3 `skill.list_remote`（已实现）

**用途**：在 SkillHub 技能注册表（skillhub.ai）中搜索技能，便于 X 发现并安装新 Skill。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 搜索关键词，如 crypto、calendar、serpapi |
| limit | number | 否 | 最大返回条数，默认 10 |

**返回**：`{ text, skills: [{ slug, version?, description, score? }] }`。安装时用 `skill.install(source: "skillhub:<slug>")`。

---

## 4. 配置扩展

### 4.1 skills.paths

在 user_config 或工作区配置中增加 `skills.paths`：额外目录列表，在每目录下扫描 `**/SKILL.md`，合并到 `getDiscoveredSkills()`。

### 4.2 skills.urls

`skills.urls`：拉取 index.json 的 URL 列表。首次或定期拉取，下载到本地缓存目录（如 `~/.x-computer/skills-cache/<host>/`），再扫描 `**/SKILL.md`，与 OpenCode `Discovery.pull` 一致。

---

## 5. 缺 Key 时的流程（主流程）

1. X 调用 `skill.load(name)` 加载某 Skill；
2. Skill 说明需 API Key（如 zhipu-web-search 需智谱 Key）；
3. X 调用该 Skill 对应工具（如 `zhipu_web_search`）→ 返回「未配置 API Key」；
4. X 调用 `x.notify_user`：
   - 内容：「要使用 [Skill 名] 需要配置 API Key。请到 **设置 → Skills** 中为「xxx」填写 API Key 并保存。获取地址：https://...」；
5. 用户到设置页填写并保存；
6. 用户再次发起请求或 X 定时/事件触发时，工具读取到 `skill_config` 中的 Key，调用成功。

**不要求** X 在本轮拿到 Key，只要求 X 明确告知用户「去哪填、填什么」。

---

## 6. 工具分档（可选，减少 token）

当前单次请求携带 60+ 工具，可考虑：

1. **Profile**：`minimal`（仅 file/shell/http/skill.load）、`coding`（+ grep/python/office）、`full`（全部）。
2. **按场景**：`x_direct` 场景给完整工具；`normal_chat` 给精简集。
3. **MCP 按需**：MCP 工具按「当前任务相关性」过滤（复杂，可后续迭代）。

首版可不做分档，优先完成 `skill.install` 与流程打通。

---

## 7. 实现步骤

| 步骤 | 内容 | 优先级 |
|------|------|--------|
| 1 | 实现 `skill.install`（支持 URL、GitHub、可选 SkillHub） | P1 |
| 2 | 扩展 discovery：`skills.paths`、`skills.urls` 从配置读取 | P2 |
| 3 | 完善缺 Key 流程：工具返回明确提示 + 主脑 prompt 强调「先 x.notify_user 再等用户配置」 | P1 |
| 4 | 可选：`skill.list_remote` | P3 |
| 5 | 可选：`skill.update_config`（仅在有明确安全方案时开放） | P3 |
| 6 | 可选：工具分档 / profiles | P3 |

---

## 8. 与现有需求的关系

- **R007（Skill 注册与发现）**：本方案在 R007 的「发现 + skill.load」基础上，增加**安装**与**缺 Key 时的用户触达**。
- **R012（X 主脑）**：已支持 `x.notify_user`、自主配置 MCP/Skills；本方案补充「自安装 Skill」与「缺 Key 时规范流程」。

---

## 9. 参考

- OpenClaw: `projects-for-reference/openclaw/src/gateway/server-methods/skills.ts`、`skills-install.ts`、`skills-install-download.ts`
- OpenClaw docs: `projects-for-reference/openclaw/docs/tools/skills.md`
- X-Computer: `docs/REFERENCE_OPENCLAW_OPENCODE_SKILLS.md`
