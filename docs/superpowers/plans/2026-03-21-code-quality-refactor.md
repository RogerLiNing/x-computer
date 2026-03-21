# 代码质量优化：模块边界重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 4600+ 行的 `server/src/routes/api.ts` 拆分为独立路由模块，同时重构前端 store 和 ChatApp

**Architecture:** 采用渐进式拆分策略：先提取共享 Service（Phase 0），再按依赖顺序拆分路由（Phase 1），最后重构前端（Phase 2/3）。每步独立可用。

**Tech Stack:** TypeScript, Express Router, Zustand, React Hooks

---

## 文件结构总览

### Phase 0 — 共享 Service 层

```
server/src/
└── services/                          # 新建
    ├── DoneLogService.ts             # appendToDoneLog
    ├── MemoryServiceWrapper.ts       # getMemoryServiceForUser + runConsiderCapture + runLearnPromptExtract
    └── ChannelMessageHandler.ts      # handleChannelMessageAsChat
```

### Phase 1 — 路由拆分

```
server/src/routes/
├── index.ts                          # createApiRouter 聚合入口（精简）
├── api.ts                            # 主路由（~80行，仅聚合子路由）
├── agents.ts                         # /agents, /teams, /groups
├── tasks.ts                          # /tasks CRUD
├── scheduler.ts                      # /x/scheduler-*, /x/scheduled-*
├── xProactive.ts                     # /x/proactive-*, /x/done-log, /x/greet
├── xBoard.ts                         # /x/board/*
├── xGroupRun.ts                      # /x/run-now, /x/cancel-group-run, /x/group-run-*
├── xPending.ts                       # /x/pending-*
├── apps.ts                           # /apps/sandbox, /apps/sandbox-logs
├── xApps.ts                          # /x-apps/backend/kv/*, /x-apps/backend/queue/*
├── skills.ts                         # /skills/*
├── mcp.ts                            # /mcp/*
├── capabilities.ts                   # /capabilities/*
├── llm.ts                            # /llm/import-models
├── editorAgent.ts                    # /editor-agent-stream
├── health.ts                         # /health
├── workflow.ts                       # /signals/*, /workflow/*
├── chat.ts                           # /chat/*
├── memory.ts                         # /memory/*
├── email.ts                          # /email/*
├── messaging/                        # 消息平台
│   ├── whatsapp.ts
│   ├── telegram.ts
│   ├── discord.ts
│   ├── slack.ts
│   └── qq.ts
└── prompt.ts                         # /prompt/*
```

### Phase 2 — 前端 Store 重构

```
frontend/src/store/
├── desktopStore.ts                  # 保留窗口管理，瘦身
├── appStore.ts                      # 新建：应用生命周期
├── fileStore.ts                     # 新建：文件浏览器状态
├── taskStore.ts                     # 新建：任务状态
├── connectionStore.ts               # 新建：WebSocket 连接
└── configStore.ts                   # 新建：主题/语言/通知
```

### Phase 3 — ChatApp 瘦身

```
frontend/src/components/apps/ChatApp/
├── index.tsx                        # 主组件（UI框架）
├── useChatMessages.ts               # 新建：消息状态 hook
├── useImageHandling.ts              # 新建：图片处理 hook
├── useDomainDetection.ts            # 新建：领域检测 hook
└── components/                      # 子组件目录
```

---

## Phase 0：共享 Service 层提取

### Task 0a: DoneLogService

**Files:**
- Create: `server/src/services/DoneLogService.ts`
- Modify: `server/src/routes/api.ts`（移除 appendToDoneLog 相关代码）

**Route table for reference:**

```typescript
// DoneLogService.ts
import type { AppDatabase } from '../db/database.js';

const X_DONE_LOG_KEY = 'x_done_log';
const X_DONE_LOG_MAX = 50;

export type DoneLogEntry = {
  at: number;
  summary: string;
  scheduled?: boolean;
  schedule?: string;
  title?: string;
  action?: string;
};

export class DoneLogService {
  constructor(private db: AppDatabase) {}

  async append(
    userId: string,
    summary: string,
    detail?: { scheduled?: boolean; schedule?: string; title?: string; action?: string },
  ): Promise<void> {
    const raw = await Promise.resolve(this.db.getConfig(userId, X_DONE_LOG_KEY));
    let arr: DoneLogEntry[] = [];
    try {
      if (raw) arr = JSON.parse(raw) as DoneLogEntry[];
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    const entry: DoneLogEntry = { at: Date.now(), summary, ...(detail?.scheduled && { scheduled: true }), ...(detail?.schedule && { schedule: detail.schedule }), ...(detail?.title && { title: detail.title }), ...(detail?.action && { action: detail.action }) };
    arr.push(entry);
    arr = arr.slice(-X_DONE_LOG_MAX);
    await Promise.resolve(this.db.setConfig(userId, X_DONE_LOG_KEY, JSON.stringify(arr)));
  }
}
```

- [ ] **Step 1: 创建 services 目录**

```bash
mkdir -p server/src/services
```

- [ ] **Step 2: 创建 DoneLogService.ts**

```bash
cat > server/src/services/DoneLogService.ts << 'EOF'
import type { AppDatabase } from '../db/database.js';

const X_DONE_LOG_KEY = 'x_done_log';
const X_DONE_LOG_MAX = 50;

export type DoneLogEntry = {
  at: number;
  summary: string;
  scheduled?: boolean;
  schedule?: string;
  title?: string;
  action?: string;
};

export class DoneLogService {
  constructor(private db: AppDatabase) {}

  async append(
    userId: string,
    summary: string,
    detail?: { scheduled?: boolean; schedule?: string; title?: string; action?: string },
  ): Promise<void> {
    const raw = await Promise.resolve(this.db.getConfig(userId, X_DONE_LOG_KEY));
    let arr: DoneLogEntry[] = [];
    try {
      if (raw) arr = JSON.parse(raw) as DoneLogEntry[];
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    const entry: DoneLogEntry = {
      at: Date.now(),
      summary,
      ...(detail?.scheduled && { scheduled: true }),
      ...(detail?.schedule && { schedule: detail.schedule }),
      ...(detail?.title && { title: detail.title }),
      ...(detail?.action && { action: detail.action }),
    };
    arr.push(entry);
    arr = arr.slice(-X_DONE_LOG_MAX);
    await Promise.resolve(this.db.setConfig(userId, X_DONE_LOG_KEY, JSON.stringify(arr)));
  }
}
EOF
```

- [ ] **Step 3: 在 api.ts 中导入 DoneLogService（暂不删除旧代码）**

在 api.ts 顶部添加：
```typescript
import { DoneLogService } from '../services/DoneLogService.js';
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd server && npx tsc --noEmit 2>&1 | head -30
```

Expected: 无新增错误

- [ ] **Step 5: Commit**

```bash
git add server/src/services/DoneLogService.ts server/src/routes/api.ts
git commit -m "feat: extract DoneLogService from api.ts
```

---

### Task 0b: MemoryServiceWrapper + runConsiderCapture + runLearnPromptExtract

**Files:**
- Create: `server/src/services/MemoryServiceWrapper.ts`
- Modify: `server/src/routes/api.ts`

**Dependencies:** 无外部依赖（独立于 Task 0a，可并行进行）

**Key insight:** `getMemoryServiceForUser` 是闭包内函数，需要重构为可注入的 Service。它依赖 `userSandboxManager`、`vectorStore`。`runConsiderCapture` 和 `runLearnPromptExtract` 都依赖 `memoryService`，可以整合进这个 Service。

```typescript
// MemoryServiceWrapper.ts
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import { MemoryService } from '../memory/MemoryService.js';
import { VectorStore } from '../memory/vectorStore.js';
import { callLLM } from '../chat/chatService.js';
import { MEMORY_CONSIDER_SYSTEM_PROMPT, LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT } from '../prompts/systemCore.js';

export class MemoryServiceWrapper {
  private vectorStore;
  private defaultMemoryService: MemoryService;

  constructor(
    sandboxFS: SandboxFS,
    private userSandboxManager?: UserSandboxManager,
  ) {
    this.vectorStore = new VectorStore(sandboxFS);
    this.defaultMemoryService = new MemoryService(sandboxFS, this.vectorStore);
  }

  async getForUser(userId: string | undefined): Promise<MemoryService | null> {
    if (!userId || userId === 'anonymous' || !this.userSandboxManager) return null;
    const { sandboxFS } = await this.userSandboxManager.getForUser(userId);
    return new MemoryService(sandboxFS, this.vectorStore);
  }

  async runConsiderCapture(params: {
    userMessage: string;
    assistantReply: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    vectorProviderId?: string;
    vectorModelId?: string;
    vectorBaseUrl?: string;
    vectorApiKey?: string;
    workspaceId?: string;
  }): Promise<void> {
    const ms = await this.getForUser(params.workspaceId) ?? this.defaultMemoryService;
    const raw = await callLLM({
      messages: [
        { role: 'system', content: MEMORY_CONSIDER_SYSTEM_PROMPT },
        { role: 'user', content: `用户：${params.userMessage}\n\n助手：${params.assistantReply}` },
      ],
      providerId: params.providerId,
      modelId: params.modelId,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
    });
    const trimmed = (raw ?? '').trim();
    if (!trimmed || trimmed.toUpperCase() === 'NONE') return;
    const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean);
    const typeLine = (lines[0] ?? '').toUpperCase();
    const typeMap = { PREFERENCE: 'preference' as const, DECISION: 'decision' as const, FACT: 'fact' as const };
    const type = typeMap[typeLine as keyof typeof typeMap] ?? 'fact';
    const content = (lines.slice(1).join(' ').trim() || lines[0] || trimmed).trim();
    if (!content) return;
    await ms.capture(content, type);
  }

  async runLearnPromptExtract(params: {
    userMessage: string;
    assistantReply: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<void> {
    const ms = this.defaultMemoryService;
    const raw = await callLLM({
      messages: [
        { role: 'system', content: LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: `用户：${params.userMessage}\n\n助手：${params.assistantReply}` },
      ],
      providerId: params.providerId,
      modelId: params.modelId,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
    });
    const trimmed = (raw ?? '').trim();
    if (!trimmed || trimmed.toUpperCase() === 'NONE') return;
    const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3);
    for (const line of lines) {
      if (line.length > 200) continue;
      await ms.appendLearnedPrompt(line);
    }
  }
}
```

- [ ] **Step 1: 创建 MemoryServiceWrapper.ts**

```bash
cat > server/src/services/MemoryServiceWrapper.ts << 'EOF'
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import { MemoryService } from '../memory/MemoryService.js';
import { VectorStore } from '../memory/vectorStore.js';
import { callEmbedding } from '../memory/embeddingService.js';
import { callLLM } from '../chat/chatService.js';
import { MEMORY_CONSIDER_SYSTEM_PROMPT, LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT } from '../prompts/systemCore.js';

export class MemoryServiceWrapper {
  private vectorStore: VectorStore;
  private defaultMemoryService: MemoryService;

  constructor(
    sandboxFS: SandboxFS,
    private userSandboxManager?: UserSandboxManager,
  ) {
    this.vectorStore = new VectorStore(sandboxFS);
    this.defaultMemoryService = new MemoryService(sandboxFS, this.vectorStore);
  }

  async getForUser(userId: string | undefined): Promise<MemoryService | null> {
    if (!userId || userId === 'anonymous' || !this.userSandboxManager) return null;
    const { sandboxFS } = await this.userSandboxManager.getForUser(userId);
    return new MemoryService(sandboxFS, this.vectorStore);
  }

  async runConsiderCapture(params: {
    userMessage: string;
    assistantReply: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    vectorProviderId?: string;
    vectorModelId?: string;
    vectorBaseUrl?: string;
    vectorApiKey?: string;
    workspaceId?: string;
  }): Promise<void> {
    const ms = (await this.getForUser(params.workspaceId)) ?? this.defaultMemoryService;
    const raw = await callLLM({
      messages: [
        { role: 'system', content: MEMORY_CONSIDER_SYSTEM_PROMPT },
        { role: 'user', content: `用户：${params.userMessage}\n\n助手：${params.assistantReply}` },
      ],
      providerId: params.providerId,
      modelId: params.modelId,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
    });
    const trimmed = (raw ?? '').trim();
    if (!trimmed || trimmed.toUpperCase() === 'NONE') return;
    const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean);
    const typeLine = (lines[0] ?? '').toUpperCase();
    const typeMap = { PREFERENCE: 'preference' as const, DECISION: 'decision' as const, FACT: 'fact' as const };
    const type = typeMap[typeLine as keyof typeof typeMap] ?? 'fact';
    const content = (lines.slice(1).join(' ').trim() || lines[0] || trimmed).trim();
    if (!content) return;
    await ms.capture(content, type);
  }

  async runLearnPromptExtract(params: {
    userMessage: string;
    assistantReply: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<void> {
    const ms = this.defaultMemoryService;
    const raw = await callLLM({
      messages: [
        { role: 'system', content: LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: `用户：${params.userMessage}\n\n助手：${params.assistantReply}` },
      ],
      providerId: params.providerId,
      modelId: params.modelId,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
    });
    const trimmed = (raw ?? '').trim();
    if (!trimmed || trimmed.toUpperCase() === 'NONE') return;
    const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3);
    for (const line of lines) {
      if (line.length > 200) continue;
      await ms.appendLearnedPrompt(line);
    }
  }
}
EOF
```

- [ ] **Step 2: 在 api.ts 中导入 MemoryServiceWrapper（暂不删除旧代码）**

```bash
cd /Users/rogerlee/code/x-computer
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd server && npx tsc --noEmit 2>&1 | head -30
```

Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add server/src/services/MemoryServiceWrapper.ts server/src/routes/api.ts
git commit -m "feat: add MemoryServiceWrapper with runConsiderCapture and runLearnPromptExtract
```

---

### Task 0c: ChannelMessageHandler

**Files:**
- Create: `server/src/services/ChannelMessageHandler.ts`
- Modify: `server/src/routes/api.ts`（移除 handleChannelMessageAsChat 及相关代码）

**Dependencies:** Task 0a, Task 0b

**Note:** 这是最复杂的提取。`handleChannelMessageAsChat`（lines 1419-1545）在路由闭包内使用了大量依赖。需要将以下内容全部作为构造函数注入：
- `orchestrator`, `db`, `userSandboxManager`, `sandboxFS`
- `getLLMConfigForScheduler`（lines 469-527，全函数）
- `getLearnedPromptForUser`, `getEvolvedCorePromptForUser`, `getBasePromptForUser`, `getAssistantPromptForUser`（lines 329-357）
- `ensureUserMcpForScheduler`（lines 531-538）
- 各渠道消息发送函数（sendQQMessage, sendWhatsAppMessage 等）

**建议：** 如果 Task 0c 过于复杂，可以将其推迟到 Phase 1 的消息平台路由拆分阶段（Task 21-25）再处理，因为消息平台路由本身就是 handleChannelMessageAsChat 的消费者。

- [ ] **Step 1: 扫描 handleChannelMessageAsChat 完整行范围**

```bash
grep -n "^  const handleChannelMessageAsChat\|^  async function handleChannelMessageAsChat" server/src/routes/api.ts
```

Expected: 1419

```bash
sed -n '1419,1545p' server/src/routes/api.ts | wc -l
```
Expected: ~127 lines

- [ ] **Step 2: 创建 ChannelMessageHandler.ts（完整实现）**

完整的 `handleChannelMessageAsChat` 函数体在 api.ts lines 1419-1545。该任务需要：
1. 将所有闭包变量提取为 `ChannelMessageHandler` 构造函数的注入依赖
2. 将 `getLLMConfigForScheduler`（lines 469-527）完整复制到 Service 中（使用依赖注入而非闭包）
3. 将提示词获取函数（getLearnedPromptForUser 等）也作为依赖注入

如果时间有限，可以将此任务标记为 `DEFERRED` 并在 Task 21-25（消息平台路由）时再实现，因为：
- 消息平台路由（WhatsApp/Telegram 等）需要直接调用 `handleChannelMessageAsChat`
- 这些路由拆分后，handleChannelMessageAsChat 的闭包依赖自然清晰

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd server && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add server/src/services/ChannelMessageHandler.ts
git commit -m "feat: extract ChannelMessageHandler with handleChannelMessageAsChat
```

---

## Phase 1：路由拆分（按顺序执行）

**注意：** routes/index.ts 的聚合入口在 Task 28（最后一步）创建，避免引用不存在的子路由文件。

### Task 1: 拆分 agents.ts

**Files:**
- Create: `server/src/routes/agents.ts`
- Modify: `server/src/routes/api.ts`

**Routes to extract:** `/agents`, `/teams`, `/groups`（约 lines 793-1120）

**Dependencies:** `orchestrator: AgentOrchestrator`

- [ ] **Step 1: 创建 agents.ts**

从 api.ts 中提取 `/agents`、`/teams`、`/groups` 相关路由代码，封装为：

```typescript
import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { AppDatabase } from '../db/database.js';

export function createAgentsRouter(orchestrator: AgentOrchestrator, db?: AppDatabase): Router {
  const router = Router();
  // ... extracted routes
  return router;
}
```

- [ ] **Step 2: 在 api.ts 中导入并注册 agents.ts**

在 api.ts 中：
```typescript
import { createAgentsRouter } from './agents.js';
```

在 `createApiRouter` 函数中添加：
```typescript
router.use(createAgentsRouter(orchestrator, db));
```

- [ ] **Step 3: 从 api.ts 删除已迁移的 agents 路由代码**

删除 `router.get('/agents'...)` 到 `router.delete('/groups/:id')` 的代码块。

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd server && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/agents.ts server/src/routes/api.ts
git commit -m "refactor: extract agents/teams/groups routes to agents.ts
```

---

### Task 3: 拆分 tasks.ts

**Files:**
- Create: `server/src/routes/tasks.ts`
- Modify: `server/src/routes/api.ts`

**Routes to extract:** `/tasks`（约 lines 1879-1960）

**Dependencies:** `orchestrator: AgentOrchestrator`, `policy: PolicyEngine`, `audit: AuditLogger`, `aiQuota`, `taskQuota` middlewares

- [ ] **Step 1: 创建 tasks.ts**

```typescript
import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { PolicyEngine } from '../policy/PolicyEngine.js';
import type { AuditLogger } from '../observability/AuditLogger.js';
import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { aiCallsQuota, tasksQuota } from '../subscription/quotaMiddleware.js';

export function createTasksRouter(
  orchestrator: AgentOrchestrator,
  policy: PolicyEngine,
  audit: AuditLogger,
  db?: AppDatabase,
  subscriptionService?: SubscriptionService,
): Router {
  const router = Router();
  const aiQuota = subscriptionService ? aiCallsQuota(subscriptionService) : (_req: any, _res: any, next: any) => next();
  const taskQuota = subscriptionService ? tasksQuota(subscriptionService) : (_req: any, _res: any, next: any) => next();
  // ... extracted routes
  return router;
}
```

- [ ] **Step 2: 类似 Task 2，导入、注册、删除已迁移代码**

- [ ] **Step 3: 验证 TypeScript 编译**

- [ ] **Step 4: Commit**

---

### Task 4: 拆分 scheduler.ts

**Routes to extract:** `/x/scheduler-status`, `/x/scheduled-jobs`

- [ ] **Step 1-4: 参考 Task 2 的模式，创建并验证**

---

### Task 5-25: 其他路由文件

按以下顺序继续（每步模式相同）：

| 顺序 | 文件 | 路由 |
|------|------|------|
| 5 | `xProactive.ts` | `/x/proactive-*`, `/x/done-log`, `/x/greet` |
| 6 | `xBoard.ts` | `/x/board/*` |
| 7 | `xGroupRun.ts` | `/x/run-now`, `/x/cancel-group-run`, `/x/group-run-*` |
| 8 | `xPending.ts` | `/x/pending-*` |
| 9 | `apps.ts` | `/apps/sandbox`, `/apps/sandbox-logs` |
| 10 | `xApps.ts` | `/x-apps/backend/kv/*`, `/x-apps/backend/queue/*` |
| 11 | `skills.ts` | `/skills/*` |
| 12 | `mcp.ts` | `/mcp/*` |
| 13 | `capabilities.ts` | `/capabilities/*` |
| 14 | `llm.ts` | `/llm/import-models` |
| 15 | `editorAgent.ts` | `/editor-agent-stream` |
| 16 | `health.ts` | `/health` |
| 17 | `workflow.ts` | `/signals/*`, `/workflow/*` |
| 18 | `chat.ts` | `/chat/*` |
| 19 | `memory.ts` | `/memory/*` |
| 20 | `email.ts` | `/email/*` |
| 21 | `messaging/whatsapp.ts` | `/whatsapp/*` |
| 22 | `messaging/telegram.ts` | `/telegram/*` |
| 23 | `messaging/discord.ts` | `/discord/*` |
| 24 | `messaging/slack.ts` | `/slack/*` |
| 25 | `messaging/qq.ts` | `/qq/*` |
| 26 | `prompt.ts` | `/prompt/*` |

**每步模式：**
1. 从 api.ts 提取对应路由代码到新文件
2. 新文件遵循 `createXxxRouter(...deps): Router` 模式
3. 在 api.ts 中导入并 `router.use(createXxxRouter(...))`
4. 从 api.ts 删除已迁移代码
5. TypeScript 编译验证
6. Git commit

---

### Task 27: 后台初始化迁移

**Files:**
- Create: `server/src/bootstrap.ts`（新建）
- Modify: `server/src/app.ts`
- Modify: `server/src/routes/api.ts`

将以下从 api.ts 移出：
- `startEmailCheckLoop` 调用
- `setDefaultScheduler` + 定时任务加载
- 消息平台信号处理器注入

- [ ] **Step 1: 创建 bootstrap.ts**

将 api.ts 中不属于路由定义的后台初始化代码提取到 `server/src/bootstrap.ts`：
```typescript
// bootstrap.ts
import { startEmailCheckLoop } from './email/emailCheckLoop.js';
// ... 其他导入

export async function bootstrapServer(options: BootstrapOptions) {
  // startEmailCheckLoop 调用
  // setDefaultScheduler + 定时任务加载
  // 消息平台信号处理器注入
}
```

- [ ] **Step 2: 在 app.ts 中调用 bootstrapServer**

- [ ] **Step 3: 从 api.ts 删除已迁移的后台初始化代码**

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd server && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add server/src/bootstrap.ts server/src/app.ts server/src/routes/api.ts
git commit -m "refactor: extract backend initialization to bootstrap.ts
```

---

### Task 28: api.ts 最终精简 + routes/index.ts 聚合入口

**Files:**
- Create: `server/src/routes/index.ts`
- Modify: `server/src/routes/api.ts`

最终状态应该只有：
- `import` 语句（整理归类）
- `createApiRouter` 函数签名
- 所有子路由的 `router.use(...)` 聚合
- 约 150 行以内（包含所有子路由的 import 和聚合）

- [ ] **Step 1: 创建 routes/index.ts**

```typescript
import { createAgentsRouter } from './agents.js';
import { createTasksRouter } from './tasks.js';
// ... 其他子路由导入
export { createApiRouter } from './api.js';
export { createAgentsRouter, createTasksRouter /* ... */ };
```

- [ ] **Step 2: 精简 api.ts 主文件**

删除所有已迁移的路由代码和 Helper 函数，保留：
1. 必要的 import（共享类型、工具函数）
2. `createApiRouter` 函数签名
3. 所有子路由的 `router.use(...)` 聚合（每个一行）
4. 约 80-150 行

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd server && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: 验证路由功能**

```bash
cd server && npm run dev &
sleep 5
curl -s http://localhost:4000/api/health | head -20
```

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/index.ts server/src/routes/api.ts
git commit -m "refactor: finalize api.ts split - create routes/index.ts and minimize api.ts
```

---

## Phase 2：前端 Store 重构

### Task 29: 拆分 appStore.ts

**Files:**
- Create: `frontend/src/store/appStore.ts`
- Modify: `frontend/src/store/desktopStore.ts`

**desktopStore.ts 结构（497行）：**
- lines 1-100: imports, types, constants
- lines ~100-200: window state & actions（z-index, positions, sizes）
- lines ~200-300: app state（currentApp, appRegistry, openApp/closeApp）
- lines ~300-400: file browser state
- lines ~400-497: task state, connection state, theme/language

- [ ] **Step 1: 扫描 app 相关代码行范围**

```bash
grep -n "currentApp\|openApp\|closeApp\|appRegistry" frontend/src/store/desktopStore.ts
```

- [ ] **Step 2: 创建 appStore.ts**

从 desktopStore.ts 提取 app 相关状态和方法到独立 store

- [ ] **Step 3: 在 desktopStore.ts 中导入 appStore（桥接）**

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

---

### Task 30: 拆分 fileStore.ts, taskStore.ts, connectionStore.ts, configStore.ts

**Files:** 新建各 store 文件，修改 desktopStore.ts

按同样模式继续：提取、桥接、验证、提交。

---

## Phase 3：ChatApp 瘦身

**ChatApp.tsx 结构（1993行）：**
- lines 1-50: imports
- lines 51-100: types, interfaces
- lines ~100-200: helper functions（detectDomain, imageUrlToBlob, etc.）
- lines ~200-400: main component + state hooks
- lines ~400-1993: render methods and sub-components

### Task 31: 提取 useDomainDetection.ts

**Files:**
- Create: `frontend/src/components/apps/ChatApp/useDomainDetection.ts`
- Modify: `frontend/src/components/apps/ChatApp.tsx`

- [ ] **Step 1: 扫描 detectDomain 函数**

```bash
grep -n "detectDomain" frontend/src/components/apps/ChatApp.tsx
```

- [ ] **Step 2: 创建 useDomainDetection.ts**

```typescript
import type { TaskDomain } from '@shared/index';

export function useDomainDetection() {
  function detectDomain(text: string): TaskDomain {
    const t = text.toLowerCase();
    if (t.includes('代码') || t.includes('编程') || t.includes('修复') || t.includes('bug') || t.includes('编写') || t.includes('函数'))
      return 'coding';
    if (t.includes('邮件') || t.includes('文档') || t.includes('表格') || t.includes('报告') || t.includes('整理') || t.includes('周报') || t.includes('工作周报'))
      return 'office';
    if (t.includes('帮我') || t.includes('执行') || t.includes('自动') || t.includes('任务') || t.includes('搜索') || t.includes('下载'))
      return 'agent';
    return 'chat';
  }
  return { detectDomain };
}
```

- [ ] **Step 3: 在 ChatApp.tsx 中导入使用**

- [ ] **Step 4: 验证编译**

- [ ] **Step 5: Commit**

---

### Task 32: 提取 useImageHandling.ts

**Files:**
- Create: `frontend/src/components/apps/ChatApp/useImageHandling.ts`
- Modify: `frontend/src/components/apps/ChatApp.tsx`

提取 `imageUrlToBlob`, `getImageExtension`, `blobToBase64`, `saveImageToSandbox` 到独立 hook。

---

### Task 33: 提取子组件

**Files:**
- Create: `frontend/src/components/apps/ChatApp/components/`（目录）
- Move: MessageBubble, InputArea 等组件从 ChatApp.tsx 移出

---

## 验证清单

每步完成后验证：
- [ ] TypeScript 编译无错误
- [ ] `npm test` 通过
- [ ] 手动冒烟测试（相关功能可用）
- [ ] Git commit 已创建

---

## 回滚检查点

如遇问题，检查以下 commit 是否存在：
- `feat: extract DoneLogService from api.ts`
- `feat: add MemoryServiceWrapper...`
- `refactor: extract agents/teams/groups routes to agents.ts`
- （以此类推，每步路由拆分独立 commit）

如需回滚：`git revert <commit-hash>`

**注意：** Task 0c（ChannelMessageHandler）如果标记为 DEFERRED，则不会创建对应 commit，跳过即可。
