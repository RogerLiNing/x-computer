# 代码质量优化：模块边界重构设计

## 目标

优化 X-Computer 系统的模块边界，解决：
1. **api.ts** — 206KB / 4600+ 行巨型路由文件
2. **前端 store** — desktopStore 过于庞大，UI 状态与业务状态混杂
3. **ChatApp** — 业务逻辑与 UI 渲染混在一起

## 当前问题分析

### api.ts（最高优先级）

**症状：**
- 单文件 4600+ 行，集合了所有 HTTP 路由
- 15+ 类路由混在同一文件
- Helper 函数（appendToDoneLog、runConsiderCapture）侵入路由层
- 后台初始化（emailCheckLoop、scheduler、信号处理器）在路由设置中执行
- Service 直接在路由处理器内实例化（MemoryService 等）
- `handleChannelMessageAsChat`（约120行）及其依赖链全部定义在路由文件内部

**完整路由分类（识别自 api.ts）：**

| 路由前缀 | 数量 | 说明 |
|----------|------|------|
| `/chat` | ~8 | 对话、agent、图像生成 |
| `/memory` | ~7 | 记忆状态/读取/召回/捕获 |
| `/email/inbox`, `/email/sync` | ~2 | 邮件 |
| `/whatsapp/*` | ~7 | WhatsApp 集成 |
| `/telegram/*` | ~5 | Telegram 集成 |
| `/discord/*` | ~4 | Discord 集成 |
| `/slack/*` | ~4 | Slack 集成 |
| `/qq/*` | ~5 | QQ 集成 |
| `/agents`, `/teams`, `/groups` | ~15 | Agent 团队管理 |
| `/tasks` | ~12 | 任务 CRUD + 状态 |
| `/x/scheduler-*`, `/x/scheduled-*` | ~3 | 调度器状态 |
| `/x/proactive-*` | ~2 | 主动消息 |
| `/x/done-log`, `/x/greet`, `/x/run-now`, `/x/pending-*` | ~8 | X 主脑操作 |
| `/x/board/*` | ~4 | 任务看板 |
| `/x/group-run-*` | ~2 | 组合运行 |
| `/apps/sandbox`, `/apps/sandbox-logs` | ~6 | 沙箱应用 |
| `/x-apps/backend/kv/*` | ~5 | 应用 KV 存储 |
| `/x-apps/backend/queue/*` | ~3 | 应用队列 |
| `/skills/*` | ~6 | Skill 发现/安装 |
| `/mcp/*` | ~5 | MCP 配置/状态/测试 |
| `/capabilities/*` | ~2 | 能力注册 |
| `/llm/import-models` | ~1 | LLM 模型导入 |
| `/editor-agent-stream` | ~1 | 流式编辑器 Agent |
| `/health` | ~1 | 健康检查 |
| `/prompt/*` | ~2 | 提示词 |
| `/signals/*` | ~1 | 信号触发 |
| `/workflow/*` | ~1 | 工作流执行 |
| `/tools`, `/context`, `/mode` | ~3 | 工具/模式 |

**Helper/业务函数：**

| 函数 | 作用域依赖 | 可提取为 |
|------|-----------|---------|
| `appendToDoneLog` | `db` | 纯工具函数 |
| `runConsiderCapture` | orchestrator, vectorStore, memoryService, getMemoryServiceForUser | 共享 Service（需先提取 getMemoryServiceForUser） |
| `runLearnPromptExtract` | memoryService, getMemoryServiceForUser | 共享 Service |
| `buildMiniAppLoggerScript` | 无闭包依赖 | 纯工具函数 |
| `loadAgentsForSignals` | 无闭包依赖（仅类型依赖） | 纯工具函数 |
| `notifyWorkflowOnSignal` | 无闭包依赖 | 纯工具函数 |
| `handleChannelMessageAsChat` | orchestrator, getConfig, db, scheduler, vectorStore, memoryService 等 | **核心依赖链，需先构建 Service 层** |

---

## 重构方案

### Phase 0: 共享 Service 层提取（关键前置）

**在拆分路由之前，必须先提取以下依赖链，否则无法迁移消息平台路由。**

```
server/src/
├── services/                    # 新建目录
│   ├── MemoryServiceWrapper.ts  # getMemoryServiceForUser 闭包逻辑提取为可注入服务
│   ├── ChannelMessageHandler.ts  # handleChannelMessageAsChat 及其依赖链
│   └── DoneLogService.ts        # appendToDoneLog
├── routes/
│   └── ...（路由拆分，同下）
```

**提取顺序：**

1. `DoneLogService.ts` — `appendToDoneLog`（无复杂依赖，最简单）
2. `MemoryServiceWrapper.ts` — `getMemoryServiceForUser` + 相关的 `runConsiderCapture`、`runLearnPromptExtract` 逻辑
3. `ChannelMessageHandler.ts` — `handleChannelMessageAsChat`（依赖 MemoryServiceWrapper 和 scheduler）

### Phase 1: api.ts 拆分

#### 目录结构

```
server/src/routes/
├── index.ts              # createApiRouter 聚合入口
├── api.ts                # 主路由（精简到 ~80 行，聚合子路由）
├── agents.ts             # /agents, /teams, /groups
├── tasks.ts              # /tasks CRUD + 状态
├── scheduler.ts          # /x/scheduler-*, /x/scheduled-*
├── xProactive.ts       # /x/proactive-*, /x/done-log, /x/greet, /x/run-now
├── xBoard.ts           # /x/board/*
├── xGroupRun.ts        # /x/run-now, /x/cancel-group-run, /x/group-run-*
├── xPending.ts         # /x/pending-*
├── apps.ts             # /apps/sandbox, /apps/sandbox-logs
├── xApps.ts            # /x-apps/backend/kv/*, /x-apps/backend/queue/*
├── skills.ts           # /skills/*
├── mcp.ts              # /mcp/*
├── capabilities.ts     # /capabilities/*
├── llm.ts              # /llm/import-models
├── editorAgent.ts      # /editor-agent-stream
├── health.ts           # /health
├── workflow.ts         # /signals/*, /workflow/*
├── chat.ts            # /chat/*
├── memory.ts           # /memory/*
├── email.ts            # /email/*
├── messaging/          # 消息平台路由
│   ├── whatsapp.ts    # /whatsapp/*
│   ├── telegram.ts    # /telegram/*
│   ├── discord.ts     # /discord/*
│   ├── slack.ts       # /slack/*
│   └── qq.ts          # /qq/*
└── prompt.ts          # /prompt/*
```

#### 新建模块模式

```typescript
// routes/agents.ts
import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';

export function createAgentsRouter(orchestrator: AgentOrchestrator): Router {
  const router = Router();
  // routes...
  return router;
}
```

#### 后台初始化迁移

将以下初始化代码从 `api.ts` 移到 `app.ts` 或新建 `bootstrap.ts`：

- `startEmailCheckLoop` 调用
- `setDefaultScheduler` + 定时任务加载
- 消息平台信号处理器注入（WhatsApp/Telegram/Discord/Slack/QQ）

#### 迁移顺序（按依赖层次）

| 顺序 | 模块 | 依赖前提 | 风险 |
|------|------|---------|------|
| 0a | `services/DoneLogService.ts` | 无 | 低 |
| 0b | `services/MemoryServiceWrapper.ts` | 0a 可选 | 低 |
| 0c | `services/ChannelMessageHandler.ts` | 0b | 中 |
| 1 | `agents.ts` | 无 | 低 |
| 2 | `tasks.ts` | 无 | 低 |
| 3 | `scheduler.ts` | 无 | 低 |
| 4 | `xProactive.ts` | 无 | 低 |
| 5 | `xBoard.ts` | 无 | 低 |
| 6 | `xGroupRun.ts` | 无 | 低 |
| 7 | `xPending.ts` | 无 | 低 |
| 8 | `apps.ts` | 无 | 低 |
| 9 | `xApps.ts` | 无 | 低 |
| 10 | `skills.ts` | 无 | 低 |
| 11 | `mcp.ts` | 无 | 低 |
| 12 | `capabilities.ts` | 无 | 低 |
| 13 | `llm.ts` | 无 | 低 |
| 14 | `editorAgent.ts` | 无 | 低 |
| 15 | `workflow.ts` | 无 | 低 |
| 16 | `health.ts` | 无 | 低 |
| 17 | `chat.ts` | Phase 0c（部分） | 低 |
| 18 | `memory.ts` | Phase 0c（部分） | 低 |
| 19 | `email.ts` | 无 | 低 |
| 20 | `messaging/whatsapp.ts` | Phase 0c | 中 |
| 21 | `messaging/telegram.ts` | Phase 0c | 中 |
| 22 | `messaging/discord.ts` | Phase 0c | 中 |
| 23 | `messaging/slack.ts` | Phase 0c | 中 |
| 24 | `messaging/qq.ts` | Phase 0c | 中 |
| 25 | `prompt.ts` | 无 | 低 |
| 26 | 初始化迁移 | Phase 0 + 所有路由就位 | 中 |
| 27 | `api.ts` 最终精简 | Phase 0 + 所有路由就位 | 低 |

#### 验收标准

- [ ] 每个子路由模块独立可用
- [ ] `api.ts` 行数减少到 < 100 行
- [ ] 所有现有路由端点路径不变
- [ ] 后台初始化不在路由文件中执行
- [ ] Phase 0 Service 层可独立测试
- [ ] 可运行测试全部通过

---

### Phase 2: 前端 store 重构

#### 目标

`desktopStore.ts` 目前约 600+ 行，混杂：
- Window 管理（z-index、位置、尺寸）
- 应用注册
- 文件浏览器状态
- 任务状态
- WebSocket 连接状态
- 主题/语言设置
- 通知系统

#### 拆分方案

```
frontend/src/store/
├── desktopStore.ts        # 窗口管理（保留，仅窗口状态）
├── appStore.ts           # 应用生命周期、当前应用
├── fileStore.ts          # 文件浏览器状态（当前路径、选中项）
├── taskStore.ts          # 任务状态
├── connectionStore.ts    # WebSocket、连接状态
└── configStore.ts        # 主题、语言、通知偏好
```

#### 验收标准

- [ ] `desktopStore.ts` 行数减少到 < 300 行
- [ ] 各 store 职责单一，可独立测试
- [ ] 现有功能不变

---

### Phase 3: ChatApp 瘦身

#### 目标

`ChatApp.tsx` 约 2000 行，业务逻辑混杂：
- `detectDomain` — 领域检测
- 图片处理（`imageUrlToBlob`、`saveImageToSandbox`）
- 对话管理逻辑
- UI 渲染

#### 拆分方案

```
frontend/src/components/apps/ChatApp/
├── index.tsx             # 主组件（精简到 UI 框架）
├── useChatMessages.ts    # 消息状态管理
├── useImageHandling.ts   # 图片处理逻辑
├── useDomainDetection.ts # 领域检测
└── components/          # MessageBubble、InputArea 等子组件
```

#### 验收标准

- [ ] `ChatApp.tsx` 主文件行数减少到 < 500 行
- [ ] 业务逻辑提取为可测试的 hooks
- [ ] UI 组件可独立预览

---

## 测试策略

### 路由层

1. **端点不变性测试** — 每步迁移后，验证所有路由端点响应格式与迁移前一致
2. **集成测试** — 使用测试数据库，验证各路由模块与数据库交互正确
3. **依赖注入测试** — 每个子路由模块接受 mock 依赖，验证路由逻辑

### 前端

1. **组件测试** — ChatApp 拆分后，验证 UI 组件渲染正确
2. **Store 测试** — 各新 store 独立测试，验证状态管理正确

## 回滚策略

1. **每步独立 Git Commit** — 每个 Phase 的子步骤独立提交，失败时可 `git revert`
2. **Feature Flag** — 关键路由（如 messaging）可通过环境变量切换新旧实现
3. **Smoke Test** — 每步迁移后运行 `npm test` 和手动冒烟测试
4. **金丝雀发布** — 生产环境采用新路由子集验证后再全量

---

## 实施原则

1. **Phase 0 先行** — 共享 Service 层不提取，路由拆分无法进行
2. **稳定优先** — 每步重构后验证测试通过，再进行下一步
3. **渐进式** — 不重写，只拆分和移动代码
4. **端点不变** — 对外 API 保持完全兼容
5. **可回滚** — 每步用 git commit 记录，失败可直接回退
6. **渐进迁移** — 前端两个阶段可与 api.ts 重构并行

---

## 后续

完成本设计后，进入实现计划阶段。
