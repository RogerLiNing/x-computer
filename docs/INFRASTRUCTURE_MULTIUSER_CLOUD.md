# X-Computer 基础设施：多用户与云端存储

本文档定义 X-Computer 在多用户隔离与云端数据存储方面的开发计划。目标：① 支持多用户，每个用户的数据、文件、沙箱完全隔离；② 所有数据以云端（后端）为主存储，本地仅作缓存。

**最后更新**：2026-02-11。

---

## 1. 现状概览

### 1.1 当前数据存储

| 数据类型 | 存储位置 | 说明 |
|----------|----------|------|
| 沙箱文件 | 后端 `UserSandboxManager` | 按用户隔离 `users/{userId}/workspace` |
| 记忆（memory/*.md） | 用户沙箱内 `memory/` | 按用户隔离 |
| 向量索引 | 用户沙箱内 `memory/.vector_index*.json` | 按用户隔离 |
| 任务 / 审计 | 后端 DB + 内存 | 持久化到 SQLite，按 userId 隔离 |
| LLM 配置 | 云端 `user_config.llm_config` + 本地缓存 | 启动拉取、修改推送；API Key 等仍存本地 |
| 桌面图标布局 | 云端 `user_config.desktop_layout` + 本地缓存 | 启动拉取、拖拽后推送 |
| 已安装应用 | 云端 `user_config.installed_apps` + 本地缓存 | 启动拉取、安装/卸载时推送 |
| 系统日志 | 云端 `user_config.system_logs` + 本地缓存 | 启动拉取、addLog/clearLogs 时推送 |
| 上次聊天会话 | 云端 `user_config.last_chat_session_id` + 本地缓存 | 启动拉取、切换/新建/删除会话时推送 |
| 聊天会话与消息 | 后端 DB `chat_sessions` / `chat_messages` | 按 userId 隔离，API 已实现 |
| MCP 配置 | 用户沙箱或 `user_config.mcp_config` | 按用户加载 |

### 1.2 当前用户/身份

- **无**：系统无登录、无用户标识，所有访问共享同一后端实例与沙箱。

---

## 2. 目标架构

### 2.1 多用户隔离

| 资源 | 隔离粒度 | 实现方式 |
|------|----------|----------|
| 沙箱文件系统 | 每用户独立根目录 | `workspaceRoot = basePath/users/{userId}/workspace` |
| 记忆文件 | 每用户独立 | 在用户沙箱内 `memory/` |
| 向量索引 | 每用户独立 | `workspaceId = userId` 或写入用户沙箱 |
| 任务 / 审计 | 每用户独立 | 持久化时按 `userId` 过滤 |
|  LLM 配置 | 每用户独立 | 云端存储 + 本地缓存（API Key 需加密或按策略存储） |
| 桌面布局 / 已安装应用 | 每用户独立 | 云端存储 + 本地缓存 |
| 聊天历史 | 每用户独立 | 云端存储 + 本地缓存 |
| MCP 配置 | 每用户独立 | 存用户沙箱或云端配置表 |

### 2.2 云端为主，本地为缓存

| 数据 | 云端存储 | 本地缓存 | 同步策略 |
|------|----------|----------|----------|
| 用户配置（LLM/桌面/应用） | 后端 DB 或存储 | localStorage/sessionStorage | 启动时拉取；修改时先写云端再写本地 |
| 聊天历史 | 后端 DB | 组件状态 / 内存 | 启动时拉取最近 N 条；新消息先写云端再更新 UI |
| 任务 / 审计 | 后端 DB | 通过 WebSocket 推送 | 实时写入云端；前端接收事件更新 |
| 沙箱文件 | 后端文件系统/对象存储 | 无（或按需预加载） | 所有读写经 API，后端即权威 |
| 记忆 | 在用户沙箱内 | 无 | 沙箱即云端存储的一部分 |

---

## 3. 实施阶段

### 阶段 A：身份与请求上下文

**目标**：引入用户身份，所有 API 与 WebSocket 请求携带 `userId`。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| A.1 | **轻量认证** | 支持：① 匿名临时 ID（localStorage 生成，首次访问即创建）；② 可选：邮箱/密码登录，返回 JWT 或 session；③ 所有请求 Header `X-User-Id` 或 Cookie/session。 | ✅ 已完成 |
| A.2 | **请求中间件** | 后端 Express 中间件解析 `req.userId`，未登录时分配或要求匿名 ID；403 时拒绝。 | ✅ 已完成 |
| A.3 | **WebSocket 关联** | 连接建立时传递 `userId`（如 init 消息），后续广播、任务事件按用户过滤。 | ✅ 已完成 |

**认证方案建议**（最小可行）：

- **Phase 1**：仅匿名模式。前端首次加载生成 `userId = crypto.randomUUID()`，存 localStorage `x-computer-user-id`，后续请求 Header 携带。后端不校验，仅用于隔离。
- **Phase 2**：增加邮箱/密码或 OAuth。用户表、session 表；登录后覆盖 `userId` 为真实用户 ID。

---

### 阶段 B：后端数据隔离

**目标**：沙箱、记忆、任务、MCP 等按 `userId` 隔离。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| B.1 | **SandboxFS 多租户** | `UserSandboxManager` 按 `userId` 创建隔离的 `SandboxFS`/`SandboxShell`；`workspaceRoot = path.join(basePath, 'users', userId, 'workspace')`。 | ✅ 已完成 |
| B.2 | **FS/Shell 路由** | `/api/fs`、`/api/shell` 从 `req.userId` 获取用户，使用对应用户的 SandboxFS/SandboxShell。 | ✅ 已完成 |
| B.3 | **记忆与向量** | 已通过 `UserSandboxManager` 隔离沙箱，记忆路径在用户沙箱内。 | ✅ 已完成 |
| B.4 | **Orchestrator** | `AgentOrchestrator`、`ToolExecutor` 执行任务时使用对应用户的沙箱与记忆。 | ✅ 已完成 |
| B.5 | **MCP 配置** | 每用户独立：用户工作区 `mcp-servers.json` 或 `user_config.mcp_config`；chat/agent 前按用户加载 MCP 工具。 | ✅ 已完成 |

---

### 阶段 C：持久化与云端存储

**目标**：任务、审计、配置等持久化到后端（DB 或文件），支持按用户查询。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| C.1 | **持久化层** | 引入 SQLite（better-sqlite3）；表：`users`、`user_config`、`chat_sessions`、`chat_messages` 等。`DATABASE_TYPE=sqlite`（默认）；MySQL 支持开发中（R050），`createDatabase` 工厂 + `database-mysql.ts`。 | ✅ 已完成 |
| C.2 | **任务持久化** | 任务创建/更新/完成时写入 DB；启动时按 `userId` 恢复任务列表。 | ✅ 已完成（写入 DB；恢复可选） |
| C.3 | **审计持久化** | 审计条目写入 DB；支持按 `userId`、时间范围查询。 | ✅ 已完成 |
| C.4 | **用户配置 API** | `GET/PUT /api/users/me/config`：LLM 配置、桌面布局、已安装应用等 JSON；存储到 `user_config` 表。 | ✅ 已完成 |
| C.5 | **聊天会话 API** | `GET /api/chat/sessions`、`GET /api/chat/sessions/:id/messages`、`POST /api/chat/sessions/:id/messages`；会话与消息按 `userId` 隔离。 | ✅ 已完成 |

---

### 阶段 D：前端云端优先

**目标**：前端从后端拉取配置与聊天历史，本地仅作缓存。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| D.1 | **配置同步** | 启动时 `GET /api/users/me/config` 初始化 store；修改时 `PUT` 更新云端，成功后再更新本地。 | ✅ 已完成（LLM 配置拉取与推送） |
| D.2 | **聊天历史同步** | 打开 Chat 时拉取当前会话消息；发送消息时先 `POST` 到云端，再追加到 UI。 | ✅ 已完成（发送时创建会话并持久化消息） |
| D.3 | **离线/降级** | 无网络时使用本地缓存；恢复时可选冲突策略（如云端优先）。 | ✅ 已完成 |

**D.3 实现说明**：① **配置**：启动时 `getUserConfig()` 失败则 `configSyncStatus = 'offline'`，不覆盖本地（store 初始值来自 localStorage）；修改配置时 `setUserConfigKey` 失败则设为 `pending`，监听 `window.online` 后自动调用 `retryConfigSync()` 将当前配置推送到云端（云端优先：下次拉取以服务器为准）。设置页「大模型配置」展示 offline/pending 提示。② **聊天**：`createChatSession` 或 `addChatMessage` 失败时标记 `chatSyncFailed`，在聊天区域顶部展示「部分消息未同步到云端，请检查网络」；恢复后新消息正常同步。

---

### 阶段 E：沙箱云端存储与 OneDrive 式同步（待开发）

**目标**：① 沙箱文件以云端为主存储（对象存储 S3/Azure Blob 等）；② 从其他浏览器/设备登录时，文件可下载，类似 OneDrive 的跨设备同步体验。

| 序号 | 任务 | 说明 | 状态 |
|------|------|------|------|
| E.1 | **沙箱云端存储** | 将 SandboxFS 或底层存储改为对接对象存储（S3 兼容 API）；文件读写时先写/读云端，本地可做缓存加速。 | 待开发 |
| E.2 | **多实例共享** | 多后端实例部署时，沙箱数据在对象存储中共享，任意实例可服务任意用户。 | 待开发 |
| E.3 | **跨设备按需拉取** | 用户从新浏览器登录时，文件列表从云端获取；打开/下载文件时按需拉取，可选「首次登录全量同步」或「始终按需」。 | 待开发 |
| E.4 | **前端同步状态** | 文件管理器展示同步状态（已同步/同步中/待下载），类似 OneDrive 的云朵/勾选图标。 | 待开发 |

**依赖**：需配置对象存储（如 AWS S3、MinIO、Azure Blob）及访问凭证；环境变量或配置项指定 bucket、region 等。

---

## 4. 数据模型（草案）

### 4.1 用户

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  -- Phase 2: email, password_hash, etc.
);
```

### 4.2 用户配置

```sql
CREATE TABLE user_config (
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);
```

- `key` 示例：`llm_config`、`desktop_layout`、`installed_apps`、`mcp_config`。

### 4.3 任务

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  steps_json TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

### 4.4 审计

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT,
  type TEXT,
  payload JSON,
  created_at TEXT
);
```

### 4.5 聊天会话与消息

```sql
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id),
  role TEXT NOT NULL,
  content TEXT,
  tool_calls_json TEXT,
  created_at TEXT
);
```

---

## 5. API 契约变更

### 5.1 新增请求头

| Header | 说明 |
|--------|------|
| `X-User-Id` | 用户 ID（匿名或登录后）。后端必选；未提供时返回 401 或分配临时 ID（由策略决定）。 |

### 5.2 新增/修改接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users/me` | 当前用户信息 |
| GET | `/api/users/me/config` | 用户配置（JSON） |
| PUT | `/api/users/me/config` | 更新用户配置 |
| GET | `/api/chat/sessions` | 会话列表 |
| GET | `/api/chat/sessions/:id/messages` | 会话消息 |
| POST | `/api/chat/sessions` | 创建会话 |
| POST | `/api/chat/sessions/:id/messages` | 追加消息 |
| GET | `/api/tasks` | 需按 `userId` 过滤（已有则加过滤） |
| GET | `/api/audit` | 需按 `userId` 过滤 |

### 5.3 现有接口变更

- `/api/fs/*`、`/api/shell/*`：隐式使用 `req.userId` 选择沙箱，无需改 URL。
- `/api/chat/agent`、`/api/chat/agent/stream`：body 可增加 `sessionId`，用于关联会话并持久化消息。
- `/api/memory/*`：`workspaceId` 改为默认 `userId`，或由后端从 `req.userId` 推导。

---

## 6. 实施顺序建议

| 优先级 | 阶段 | 理由 |
|--------|------|------|
| P0 | A（身份与请求上下文） | 一切隔离的前提 |
| P1 | B（后端数据隔离） | 沙箱、记忆、MCP 等必须按用户隔离 |
| P2 | C（持久化） | 任务、审计、配置等持久化，为云端存储打基础 |
| P3 | D（前端云端优先） | 配置与聊天历史同步，用户体验增强 |

---

## 7. 参考

- 与 `DEV_PLAN_OPENCLAW_OPENCODE.md` 阶段六（持久化与运维）协同。
- OpenCode 的 workspace/user 模型：`packages/console/core/src/workspace.ts`、`user.ts`。
- 本计划与 `DEVELOPMENT.md`、`APPS_AND_AI_STATUS.md` 互补。
