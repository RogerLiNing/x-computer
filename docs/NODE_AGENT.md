# 节点子智能体 x-node（第一期）

更新：2026-11-09。让每台服务器上跑一个常驻的 X 子智能体：X 主脑派目标，节点自己想、自己做、实时汇报，模型推理由 X 代为调用。

## 组成

| 部分 | 位置 | 职责 |
|---|---|---|
| 协议 | `shared/src/nodeProtocol.ts` | 一条 WebSocket 上的多路消息：hello / heartbeat / model 借脑 / task 派发与汇报 / exec / fs |
| 注册表 | `server/src/nodes/NodeRegistry.ts` | 表 `x_nodes`、`x_node_enroll_tokens`；一次性注册令牌换长期节点密钥，只存哈希 |
| 网关 | `server/src/nodes/NodeGateway.ts` | 接受节点连接（`/api/nodes/ws`），鉴权，心跳与陈旧清理，模型代理，exec/fs 请求响应 |
| 任务 | `server/src/nodes/NodeTaskService.ts` | 表 `x_node_tasks`；派发、排队（节点离线时）、进度、提问、结果、通知 |
| 工具 | `server/src/orchestrator/tools/nodeTools.ts` | `node.list / node.run / node.task_status / node.task_answer / node.task_cancel / node.exec` |
| 接口 | `server/src/routes/nodes.ts` | `POST /api/nodes/enroll`（公开，令牌换密钥）；`/api/nodes/*`（本人：令牌、列表、任务、exec） |
| 节点程序 | `node-agent/` | 单文件二进制 `x-node`：连接、心跳、本地工具、智能体循环、exec/fs 旁路 |

X 的 WebSocket 升级由 `server/src/nodes/upgradeRouter.ts` 统一分发：`/ws` 给桌面客户端，`/api/nodes/ws` 给节点。

## 节点侧

- 工具：`shell_run`、`file_read`、`file_write`、`file_list`、`python_run`、`http_fetch`、`ask_user`、`finish`。所有路径限定在节点工作区（默认 `~/.x-node/workspace`，每个任务一个子目录）。
- 循环：系统提示带节点名与标签 → 模型请求经 X 代理（流式回传）→ 执行工具 → 进度上报 → `finish` 结束。无工具调用的纯文字回复视为结论；超过 `maxSteps`（默认 40）或被取消则失败。
- 借脑：节点不保存任何模型密钥。X 按节点所属用户解析凭证，支持 `auto` 自动路由，调用计入该用户的预算与用量。
- 断线：指数退避重连（1 秒到 60 秒）；X 返回 1008（身份无效）时停止重连并提示重新注册。

## 部署一台节点

1. 在 X 里（登录后）生成令牌：`POST /api/nodes/enroll-tokens {"name":"香港02","labels":["overseas"]}`，令牌 24 小时有效、只能用一次。
2. 把二进制拷到服务器：`scripts/build-node-agent.sh` 产出 `node-agent/dist/x-node-linux-x64`（以及 arm64）。
3. 在服务器上：

```bash
./x-node enroll https://x.itoolcloud.cn xn_xxx --labels overseas,browser
./x-node run
```

4. 常驻（systemd）：

```ini
[Unit]
Description=x-node
After=network-online.target
[Service]
ExecStart=/opt/x-node/x-node run
Restart=always
RestartSec=3
User=root
[Install]
WantedBy=multi-user.target
```

配置文件在 `~/.x-node/config.json`（可用 `X_NODE_HOME` 改目录）。

## 在 X 里使用

- 「看看我有哪些节点」→ `node.list`。
- 「让香港那台把这 50 个网页抓下来整理成表」→ `node.run(node:"overseas", goal:…)`，完成后通知到网页与渠道。
- 节点提问时任务进入 `waiting_user`，用 `node.task_answer` 或 `POST /api/nodes/tasks/:id/answer` 回答。
- `node.exec` 直接跑一条命令并回传输出，适合短小明确的操作。

## 第一期边界

- 任务进度存库并广播到网页客户端，但前端「节点」面板尚未做；QQ 侧目前只收完成/失败/提问通知。
- 节点任务的成果文件留在节点工作区，第二期再同步回用户沙箱。
- 还没有按标签自动调度与多节点并行团队；`x.run_agent` 暂未接入 node 提供方。
- 节点二进制每个任务串行执行多个 `task/assign` 会并发运行，上限由节点机器资源决定，尚无排队。
