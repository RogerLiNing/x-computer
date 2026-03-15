# 小程序/小游戏后端能力（R025）

当小程序或小游戏需要**后端存储、后台接口、队列**时，X 可使用一套标准能力自行创建数据与接口，无需用户额外配置数据库或 Redis。

---

## 1. 能力概览

| 能力 | X 侧工具 | 前端/小程序侧 API | 说明 |
|------|----------|-------------------|------|
| **键值存储** | backend.kv_set / kv_get / kv_delete / kv_list | GET/PUT/DELETE /api/x-apps/backend/kv/:appId | 按用户+应用隔离，可存排行榜、进度、配置等 |
| **队列** | backend.queue_push / queue_pop / queue_len | POST .../queue/:appId/:queueName/push、GET .../pop、.../len | FIFO 队列，可做消息、任务队列 |
| **WebSocket 推送** | backend.broadcast_to_app | 打开小程序时自动订阅；iframe 内收 `message` 事件 `e.data.type === 'x_app_channel'` | 服务端/X 向当前已打开该小程序的用户推送实时消息 |

数据存储在服务端 SQLite（`app_backend_kv`、`app_backend_queue` 表），与用户身份绑定，仅当前用户可读写自己的应用数据。

---

## 2. X 侧工具（ToolExecutor）

- **backend.kv_set**：`app_id`、`key`、`value`。写入一条键值；value 为字符串，存 JSON 时需先 `JSON.stringify`。
- **backend.kv_get**：`app_id`、`key`。读取一条；不存在返回 `{ found: false }`。
- **backend.kv_delete**：`app_id`、`key`。删除一条。
- **backend.kv_list**：`app_id`、`prefix?`。列出 key，可选前缀过滤。
- **backend.queue_push**：`app_id`、`queue_name`、`payload`。向队列推入一条（字符串）。
- **backend.queue_pop**：`app_id`、`queue_name`。弹出一条；空时返回 `{ empty: true }`。
- **backend.queue_len**：`app_id`、`queue_name`。返回队列长度。
- **backend.broadcast_to_app**：`app_id`、`message`。向当前已打开该小程序的用户推送一条实时消息（WebSocket）；仅会发给已订阅该 app 的客户端，小程序 iframe 内通过 `message` 事件接收（见下节）。

所有工具均需**已登录用户**（agent/chat 上下文中带 userId）；`app_id` 须与 `x.create_app` 注册的小程序 id 一致，以便前端与 X 操作同一份数据。

---

## 3. 前端/小程序侧 API

请求需带当前用户身份（与现有 /api 鉴权一致，如 Cookie 或 X-User-Id）。以下 `:appId`、`:queueName` 为路径参数。

### 3.1 KV

请求身份二选一：

- **站内/已登录**：与现有鉴权一致（Cookie 或 Header **X-User-Id**）。
- **外部分发站点（只读）**：若小程序部署到独立域名（如 x-blog.example.com），访客无法带 X-User-Id，可使用**公开只读 Token**：  
  - 在 X-Computer 内用已登录用户调用 **POST** `/api/x-apps/backend/kv/:appId/public-read-token`（需 X-User-Id），返回 `{ token }`。  
  - 外部分发站点的前端请求 **GET** `/api/x-apps/backend/kv/:appId?key=xxx` 时带上 Header **X-App-Read-Token: &lt;token&gt;**，即可只读访问该应用下该用户的 KV，无需 X-User-Id。  
  - Token 仅用于 GET（读单键、列 key），PUT/DELETE 仍须 X-User-Id。

- **GET** `/api/x-apps/backend/kv/:appId?key=xxx`  
  读单键；返回值为该 key 的 value 原文（常为 JSON 字符串）。无 key 时 400；key 不存在 404。身份：X-User-Id 或 X-App-Read-Token。
- **GET** `/api/x-apps/backend/kv/:appId?prefix=xxx`  
  不传 `key` 时：列出 key 列表，可选 `prefix` 过滤；返回 `{ keys: string[] }`。身份同上。
- **PUT** `/api/x-apps/backend/kv/:appId`  
  写入：`key` 可通过 query `?key=xxx` 或 body `{ key, value }` 提供；value 为 body.value 或整 body 的 JSON 字符串。返回 `{ ok: true }`。**仅支持 X-User-Id**。
- **DELETE** `/api/x-apps/backend/kv/:appId?key=xxx`  
  删除单键。返回 `{ ok: true }`。**仅支持 X-User-Id**。

### 3.2 队列

- **POST** `/api/x-apps/backend/queue/:appId/:queueName/push`  
  Body：`{ payload: string }` 或任意 JSON（会 JSON 化后存为字符串）。返回 `{ ok: true }`。
- **GET** `/api/x-apps/backend/queue/:appId/:queueName/pop`  
  弹出一条并删除；返回 `{ payload: string }`。队列空时 404。
- **GET** `/api/x-apps/backend/queue/:appId/:queueName/len`  
  返回 `{ length: number }`。

### 3.3 WebSocket 应用通道

- 前端打开小程序窗口时，会向 WS 发送 `{ type: 'subscribe_app', data: { appId } }`，关闭窗口时发送 `unsubscribe_app`。
- X 或服务端调用 **backend.broadcast_to_app(app_id, message)** 后，服务端向所有「已订阅该 appId 且 userId 匹配」的 WS 连接推送 `{ type: 'app_channel', data: { appId, message } }`。
- 桌面端收到后会将 `message` 通过 `postMessage` 发给对应小程序的 iframe，格式为 `{ type: 'x_app_channel', data: message }`。
- **小程序内接收**：在 iframe 内的页面中监听 `window.addEventListener('message', (e) => { if (e.data?.type === 'x_app_channel') { const payload = e.data.data; /* 使用 payload */ } })`。建议 `message` 使用 JSON 字符串，前端 `JSON.parse(payload)` 后使用。

---

## 4. 使用场景示例

- **排行榜**：X 用 `backend.kv_set(app_id, 'scores', JSON.stringify([...]))` 写入；前端 GET 同 key 展示，提交分数时 GET → 解析 → 更新数组 → PUT 写回（或 X 提供接口用 queue 推送新分数再由 X 合并）。
- **单机进度/存档**：`backend.kv_set(app_id, 'save_1', JSON.stringify(state))`，前端 GET/PUT 同 key。
- **简单消息/任务队列**：X 或其它后端逻辑用 `backend.queue_push` 入队；前端轮询 `pop` 或定时取 `len` 再 `pop` 处理。
- **实时推送**：X 或定时任务用 `backend.broadcast_to_app(app_id, JSON.stringify({ event: 'update', data: ... }))`；小程序内监听 `message` 且 `e.data.type === 'x_app_channel'`，解析 `e.data.data` 后更新界面（如游戏状态、通知）。

---

## 5. 与 plan.md / 开发流程

做需要后端的小程序时，在 **plan.md** 中写明：

- 需要哪些 key（如 `scores`、`config`、`save_1`）或队列名；
- 前端如何调用 `/api/x-apps/backend/...`（读榜、存档、拉取队列等）。

X 在实现时先用 `backend.kv_set` / `backend.queue_push` 等初始化或写入示例数据，再写前端代码用 fetch 访问上述 API；前端与 X 共用同一 `app_id`，数据自然一致。若需服务端主动推送到已打开的小程序，在 plan 中写明推送时机与 payload 结构，并让前端监听 `x_app_channel` 的 message 事件。
