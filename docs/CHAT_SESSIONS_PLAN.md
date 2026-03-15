# 会话记录管理 — 现状与开发规划

本文档说明「会话记录」在系统中的位置、当前能力与缺失的 UI/流程，并给出开发规划。

**最后更新**：2026-02-11。阶段 1、2、3（会话列表/切换/新对话、恢复/标题/删除会话、单条消息删除）已实现。

---

## 1. 会话记录当前在哪里

### 1.1 后端（已具备）

| 位置 | 说明 |
|------|------|
| **`server/src/routes/chatSessions.ts`** | 聊天会话路由，挂载在 `/api/chat/sessions`（需 `db` 时由 `api.ts` 挂载）。 |
| **`server/src/db/database.ts`** | `chat_sessions`、`chat_messages` 表及 CRUD：`listSessions`、`createSession`、`getSession`、`updateSessionTitle`、`deleteSession`、`getMessages`、`addMessage`、`deleteMessage`、`touchSession`。按 `user_id` 隔离。 |

**已有 API**（见 `frontend/src/utils/api.ts`）：

- `GET  /api/chat/sessions` → `api.listChatSessions(limit)` — 会话列表
- `POST /api/chat/sessions` → `api.createChatSession(title?)` — 创建会话
- `GET  /api/chat/sessions/:id` → `api.getChatSession(sessionId)` — 会话详情
- `PUT  /api/chat/sessions/:id` → `api.updateChatSessionTitle(sessionId, title)` — 更新标题
- `DELETE /api/chat/sessions/:id` → `api.deleteChatSession(sessionId)` — 删除会话
- `GET  /api/chat/sessions/:id/messages` → `api.getChatMessages(sessionId, limit)` — 获取消息
- `POST /api/chat/sessions/:id/messages` → `api.addChatMessage(sessionId, role, content, toolCalls?)` — 追加消息
- `DELETE /api/chat/sessions/:id/messages/:msgId` → `api.deleteChatMessage(sessionId, messageId)` — 删除单条消息

### 1.2 前端（当前用法）

| 位置 | 说明 |
|------|------|
| **`frontend/src/components/apps/ChatApp.tsx`** | 唯一使用会话的界面。通过 `useChatSessionId()` 维护当前会话 ID（`sessionIdRef`），仅在**发送消息时**调用 `ensureSessionId()`：若无则 `createChatSession()` 并写入 ref，然后 `addChatMessage` 持久化。**未使用**：`listChatSessions`、`getChatMessages`（加载历史）、`updateChatSessionTitle`、`deleteChatSession`。 |
| **`useChatSessionId()`** | 提供 `ensureSessionId()`、`clearSessionId()`；未暴露「当前 sessionId」给 UI，也未与「会话列表」联动。 |

结论：**后端与前端 API 已支持完整会话 CRUD；Chat 界面已具备会话列表、切换、新对话、加载历史、恢复上次会话、首条消息自动标题、删除会话、单条消息删除（阶段 1、2、3 已完成）。**

---

## 2. 缺失能力（待开发）

| 能力 | 说明 | 优先级 |
|------|------|--------|
| **会话列表** | 打开 Chat 时展示当前用户的会话列表（侧边栏或下拉），按 `updated_at` 降序，展示标题与时间。 | P0 |
| **切换会话** | 点击某条会话 → 将 `sessionIdRef` 设为该会话 ID，并调用 `getChatMessages(sessionId)` 拉取消息，替换当前 `messages` 状态。 | P0 |
| **新会话** | 提供「新对话」按钮：`clearSessionId()` + 重置 `messages` 为欢迎语；下次发送时自动 `createChatSession()`。 | P0 |
| **打开时恢复当前会话** | 可选：从 localStorage 读取「上次使用的 sessionId」，若存在则加载该会话消息并设为当前会话；否则仅显示欢迎语。 | P1 |
| **会话标题** | 列表展示 title；首条用户消息自动设标题；侧边栏每项提供「重命名」按钮（铅笔图标），弹窗输入新标题后调用 `updateChatSessionTitle`。 | P1 ✅ |
| **删除会话** | 列表中每项提供删除按钮，确认后 `deleteChatSession(sessionId)`；若删除的是当前会话则执行 `clearSessionId()` 并切回「新会话」状态。 | P1 |
| **删除单条消息** | 已有 API；若需在 UI 支持「删除这条消息」，可调用 `deleteChatMessage(sessionId, messageId)` 并从本地 state 移除该条。 | P2 |

---

## 3. 开发规划（建议顺序）

### 阶段 1：会话列表 + 切换 + 新会话（P0）✅ 已完成

1. **状态与数据结构**
   - 在 ChatApp 或独立 store 中维护：`sessions: Array<{ id, title, createdAt, updatedAt }>`、`currentSessionId: string | null`。
   - 保留现有 `useChatSessionId()` 的 ref，或改为 state，使「当前会话 ID」与「会话列表选中项」一致；发送消息时若 `currentSessionId` 为空则先 `createChatSession()` 再写入并刷新列表。

2. **UI**
   - 在 Chat 左侧（或可折叠侧边栏）增加**会话列表**：`listChatSessions()` 拉取，按 `updatedAt` 降序；展示标题（无标题时用「新对话」或首句摘要）、时间。
   - 列表项点击 → 调用 `getChatMessages(id)`，设 `currentSessionId = id`，用返回结果渲染 `messages`（需转换为本地 `Message` 格式，含 `id/role/content/timestamp`）。
   - 顶部或列表上方提供**「新对话」**按钮：`clearSessionId()`、`currentSessionId = null`、`messages = [welcome]`。

3. **与现有发送逻辑衔接**
   - 发送首条消息时：若 `currentSessionId == null`，先 `createChatSession()`，将返回的 id 设为当前会话并加入列表，再 `addChatMessage`。
   - 后续消息：继续向 `currentSessionId` 追加 `addChatMessage`；可选在追加后 `touchSession`（后端已有 `updated_at` 更新）以保持列表排序。

### 阶段 2：恢复当前会话 + 标题 + 删除（P1）✅ 已完成

4. **恢复当前会话**
   - Chat 挂载时：从 localStorage 读 `x-computer-last-chat-session-id`；若存在则 `selectSession(last)` 加载该会话消息并设为当前会话；切换/新会话时更新 localStorage。

5. **会话标题**
   - 创建会话时 title 为空；`ensureSessionId()` 返回 `{ id, isNew }`，在首次 `addChatMessage(sid, 'user', content)` 后若 `isNew` 则调用 `updateChatSessionTitle(sid, content.slice(0, 30))`；列表刷新后展示新标题。侧边栏每项提供重命名按钮（铅笔图标），点击弹出 prompt 输入新标题，调用 `updateSessionTitle(sessionId, title)` 并刷新列表。

6. **删除会话**
   - 列表项右侧删除图标（悬停显示），确认「确定删除该会话？」后 `deleteChatSession(sessionId)`；若为当前会话则清空当前会话并显示欢迎语，并从列表中移除该项。

### 阶段 3：单条消息删除（P2）✅ 已完成

7. **删除单条消息**
   - 消息操作菜单中已有「删除」按钮；点击后若有 `currentSessionId` 则调用 `deleteChatMessage(sessionId, messageId)` 同步删除云端，并从本地 `messages` 中移除；不改变当前会话。

---

## 4. 技术要点

- **消息格式**：API 返回 `{ id, role, content, toolCalls?, createdAt }`，需映射为 ChatApp 的 `Message`（`id, role, content, timestamp, toolCalls?`）；若历史消息无 `toolCalls`，可省略或置空数组。
- **欢迎条**：切换会话或新会话时，`messages` 首条为 system 欢迎语；从云端加载时可不带欢迎语或仅在第一页插入一条本地欢迎语（按产品偏好）。
- **多窗口**：若同一用户多开 Chat 窗口，各窗口可共享「当前会话」语义（通过 localStorage 的 last-session-id），或各窗口独立 ref/state（简单实现）；后续若要「多窗口同会话」可再考虑共享 store 或广播。
- **离线**：列表与加载历史依赖 API；离线时可不展示列表或展示上次缓存的列表；发送逻辑已有 D.3 未同步提示。

---

## 5. 验收标准

- 用户打开 Chat 能看到会话列表（至少「新对话」+ 已有会话）。
- 点击某会话可查看该会话历史消息并继续在该会话中发送。
- 点击「新对话」后发送的消息进入新会话，并出现在列表中。
- 可选：删除会话后当前视图切回新会话；会话标题随首条消息或用户编辑更新。
- 刷新页面后可选恢复「上次会话」并加载其消息。

---

## 6. 文档与规范

- 实现后可在 `DEVELOPMENT.md` 的「API 参考」中注明会话相关接口为 Chat 会话管理所用；前端行为在本文档维护。
- 若新增 store（如 `chatSessionStore`），建议放在 `frontend/src/store/`，与现有 `llmConfigStore`、`desktopStore` 风格一致。
