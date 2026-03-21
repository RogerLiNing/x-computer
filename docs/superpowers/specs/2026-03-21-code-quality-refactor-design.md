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

**路由分类（识别自 api.ts）：**

| 路由前缀 | 数量 | 说明 |
|----------|------|------|
| `/agents`, `/teams`, `/groups` | ~15 | Agent 团队管理 |
| `/tasks` | ~12 | 任务 CRUD + 状态 |
| `/x/scheduler-*`, `/x/scheduled-*` | ~3 | 调度器状态 |
| `/x/proactive-*`, `/x/done-log`, `/x/greet`, `/x/run-now`, `/x/board`, `/x/pending-*` | ~15 | X 主脑杂项 |
| `/apps/*` | ~8 | 应用沙箱、KV、Queue |
| `/skills/*` | ~6 | Skill 发现/安装 |
| `/mcp/*` | ~5 | MCP 配置/状态/测试 |
| `/capabilities/*` | ~2 | 能力注册 |
| `/llm/import-models` | ~1 | LLM 模型导入 |
| `/editor-agent-stream` | ~1 | 流式编辑器 Agent |
| `/health` | ~1 | 健康检查 |
| `/prompt/*` | ~1 | 提示词 |
| `/signals/*` | ~1 | 信号触发 |
| `/workflow/*` | ~1 | 工作流执行 |
| `/tools`, `/apps`, `/context`, `/mode` | ~6 | 工具/模式 |

**Helper/业务函数：**
- `appendToDoneLog` — 写入已完成清单
- `runConsiderCapture` — 记忆捕获判断
- `runLearnPromptExtract` — 提示词学习提取
- `buildMiniAppLoggerScript` — 小程序日志脚本构建
- `loadAgentsForSignals` — 信号处理器加载 Agent 配置
- `notifyWorkflowOnSignal` — 信号触发工作流

---

## 重构方案

### Phase 1: api.ts 拆分（优先）

#### 目录结构

```
server/src/routes/
├── index.ts              # createApiRouter 聚合入口
├── api.ts                # 主路由（精简到 ~100 行，聚合子路由）
├── agents.ts             # /agents, /teams, /groups
├── tasks.ts              # /tasks CRUD + 状态
├── scheduler.ts          # /x/scheduler-status, /x/scheduled-jobs
├── xBrain.ts            # /x/* 杂项
├── apps.ts              # /apps/* (sandbox, kv, queue)
├── skills.ts            # /skills/*
├── mcp.ts               # /mcp/*
├── llm.ts               # /llm/*
├── capabilities.ts       # /capabilities/*
├── editorAgent.ts       # /editor-agent-stream
├── health.ts            # /health
└── workflow.ts          # /signals/*, /workflow/*
```

#### 新建模块模式

每个子路由文件遵循统一模式：

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

#### 主入口精简

`api.ts` 原有代码分类迁出后，保留：
- 所有 `import` 语句（整理归类到各子模块）
- `createApiRouter` 函数签名和依赖注入
- 子路由的聚合注册（每个一行）
- 移除所有路由处理器和 helper 函数

#### 后台初始化迁移

将以下初始化代码从 `api.ts` 移到 `app.ts` 或新建 `bootstrap.ts`：

- `startEmailCheckLoop` 调用
- `setDefaultScheduler` + 定时任务加载
- 消息平台信号处理器注入（WhatsApp/Telegram/Discord/Slack/QQ）
- `startEmailCheckLoop` 循环

#### 迁移顺序

| 顺序 | 模块 | 风险 |
|------|------|------|
| 1 | `agents.ts` | 低 |
| 2 | `tasks.ts` | 低 |
| 3 | `scheduler.ts` | 低 |
| 4 | `xBrain.ts` | 低 |
| 5 | `apps.ts` | 低 |
| 6 | `skills.ts` | 低 |
| 7 | `mcp.ts` | 低 |
| 8 | `capabilities.ts` | 低 |
| 9 | `llm.ts` | 低 |
| 10 | `editorAgent.ts` | 低 |
| 11 | `workflow.ts` | 低 |
| 12 | `health.ts` | 低 |
| 13 | 初始化迁移 | 中 |
| 14 | `api.ts` 最终精简 | 低 |

#### 验收标准

- [ ] 每个子路由模块独立可用（可单独 `import { createXxxRouter }`）
- [ ] `api.ts` 行数减少到 < 150 行
- [ ] 所有现有路由功能不变（端点路径、请求/响应格式不变）
- [ ] 后台初始化不在路由文件中执行
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

## 实施原则

1. **稳定优先** — 每步重构后验证测试通过，再进行下一步
2. **渐进式** — 不重写，只拆分和移动代码
3. **端点不变** — 对外 API 保持完全兼容
4. **可回滚** — 每步用 git commit 记录，失败可直接回退
5. **渐进迁移** — 前端两个阶段可与 api.ts 重构并行

---

## 后续

完成本设计后，进入实现计划阶段。
