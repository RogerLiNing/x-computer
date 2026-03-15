# 工作流引擎微服务规划

本文档描述 X-Computer 新增的「工作流引擎」微服务，提供 BPMN 风格的流程编排能力，由 X 主脑调用与操控。

**状态**：开发中 | **需求 ID**：R041

---

## 1. 能力概览

| 能力 | 说明 | BPMN 对应 |
|------|------|-----------|
| **定时触发** | 按 cron 或相对时间（in_minutes/in_hours）触发流程 | Timer Start Event |
| **事件监听** | 监听指定事件（如 user_message_sent、task_completed、自定义 signal）触发流程 | Message/ Signal Start Event |
| **任务编排** | 顺序/并行任务、人工任务、AI 任务、脚本任务 | Task (Service/User/Script) |
| **判断网关** | 条件分支、互斥网关、并行网关 | Exclusive/Parallel Gateway |
| **跳转与分支** | 条件路由、多分支并行、汇合 | Sequence Flow、Gateway |

**X 完全控制**：流程定义、任务数据读取/设置、变量、执行状态等均可由 X 通过工具调用读写。

---

## 2. 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    X-Computer 主服务 (server)                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ X 主脑 / Agent                                                ││
│  │   workflow.deploy / workflow.start / workflow.get_variable   ││
│  │   workflow.set_variable / workflow.get_instance / ...        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │ HTTP / gRPC
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              工作流引擎微服务 (workflow-engine)                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────────┐│
│  │ 流程定义存储  │ │ 实例运行时   │ │ 触发器调度器                  ││
│  │ (JSON/DB)   │ │ (状态机)     │ │ 定时 + 事件监听               ││
│  └─────────────┘ └─────────────┘ └─────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ REST / gRPC API：deploy / start / signal / variables / ...   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (回调 / 回调 URL)
┌─────────────────────────────────────────────────────────────────┐
│  X-Computer 主服务：执行 AI 任务、调用 agent、执行脚本等            │
└─────────────────────────────────────────────────────────────────┘
```

- **部署形态**：独立进程，可选同机或容器部署；通过 `WORKFLOW_ENGINE_URL` 配置主服务调用地址。
- **多用户**：流程定义、实例、变量均按 `userId` 隔离。

---

## 3. 流程模型（简化 BPMN）

### 3.1 节点类型

| 类型 | id | 说明 |
|------|----|------|
| **Start** | `start` | 开始节点；可挂接 Timer / Event 触发器 |
| **Task** | `task` | 任务节点；`taskType`: `ai`(调用 X/agent)、`script`(执行脚本)、`http`(调用 API)、`manual`(人工) |
| **ExclusiveGateway** | `exclusive` | 互斥网关，条件选择一条出边 |
| **ParallelGateway** | `parallel` | 并行网关，fork/join |
| **End** | `end` | 结束节点 |

### 3.2 边 (Sequence Flow)

- `from`, `to`：节点 id
- `condition`（可选）：`exclusive` 出边上的表达式，如 `price >= 100`

### 3.3 流程定义 JSON 示例

```json
{
  "id": "wf-001",
  "name": "价格监控流程",
  "version": 1,
  "nodes": [
    { "id": "start", "type": "start" },
    { "id": "fetch", "type": "task", "taskType": "script", "config": { "script": "fetch_price.py" } },
    { "id": "gate", "type": "exclusive" },
    { "id": "notify", "type": "task", "taskType": "ai", "config": { "intent": "通知用户价格" } },
    { "id": "end", "type": "end" }
  ],
  "edges": [
    { "from": "start", "to": "fetch" },
    { "from": "fetch", "to": "gate" },
    { "from": "gate", "to": "notify", "condition": "price >= 1900" },
    { "from": "gate", "to": "end", "condition": "true" },
    { "from": "notify", "to": "end" }
  ],
  "triggers": [
    { "type": "timer", "cron": "0 * * * *" }
  ]
}
```

---

## 4. 触发器

| 类型 | 说明 | 配置 |
|------|------|------|
| **timer** | 定时触发 | `cron` 或 `in_minutes` / `in_hours` |
| **event** | 事件触发 | `eventName`（如 `user_message_sent`、`task_completed`、`signal:xxx`） |

事件来源：X-Computer 主服务 `signalService` 或任务完成钩子，通过 HTTP 回调 `POST /workflow-engine/api/signal` 推送。

---

## 5. X 工具（ToolExecutor 扩展）

主服务通过 HTTP 调用工作流引擎，并暴露以下工具供 X 使用：

| 工具 | 说明 |
|------|------|
| `workflow.deploy` | 部署/更新流程定义（JSON） |
| `workflow.list` | 列出当前用户流程 |
| `workflow.start` | 手动启动流程实例 |
| `workflow.get_instance` | 查询实例状态 |
| `workflow.set_variable` | 设置实例变量 |
| `workflow.get_variable` | 读取实例变量 |
| `workflow.signal` | 向实例发送信号（用于事件驱动节点） |
| `workflow.delete` | 删除流程定义 |
| `workflow.list_instances` | 列出流程实例 |

X 可编写流程 JSON、部署、启动、读写变量，实现对引擎的完整控制。

---

## 6. 实施阶段

| 阶段 | 内容 | 估算 |
|------|------|------|
| **1** | 新建 `workflow-engine` 包/服务：Node.js + Express，流程定义存储（JSON 文件或 SQLite），基础 REST API | 2–3d |
| **2** | 实现执行引擎：Start → Task → Gateway → End 状态机；变量、条件求值 | 2–3d |
| **3** | 触发器：timer（cron），event（HTTP 回调） | 1–2d |
| **4** | 主服务 ToolExecutor 增加 workflow.* 工具，对接工作流引擎 API | 1d |
| **5** | Task 类型扩展：ai（回调主服务执行 X）、script、http | 2d |
| **6** | 多用户隔离、测试、文档 | 1d |

---

## 7. 技术选型建议

- **语言/框架**：Node.js + TypeScript + Express（与主服务一致）
- **存储**：SQLite（流程定义、实例、变量）或 JSON 文件（MVP 简化）
- **部署**：npm workspace 新增 `workflow-engine`，或独立仓库；通过 `WORKFLOW_ENGINE_URL` 配置

---

## 8. 与现有能力的关系

| 现有能力 | 工作流引擎关系 |
|----------|----------------|
| **R037 signal** | 工作流可监听 signal 事件作为 Start 触发器 |
| **x.schedule_run** | 工作流 timer 可替代/补充定时意图执行 |
| **R016 创建系统任务** | 工作流中的 manual 任务可对接任务时间线 |
| **Agent/Team** | 工作流 ai 任务可回调主服务执行 agent |

工作流引擎是**编排层**，主服务负责执行具体动作（LLM、文件、脚本、agent 等）。
