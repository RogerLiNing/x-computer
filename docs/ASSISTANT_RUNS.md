# 助手交办与执行恢复

普通助手与 X 主脑共用服务端执行记录。实现借鉴 DeepSeek Harness 的持久检查点、取消收敛和显式交付机制，保留现有桌面、数据库及工具。

## 接单与保存

`POST /api/chat/agent/stream` 携带 `sessionId`、`requestId` 和用户原文/附件。相同用户、会话、请求编号对应同一执行，不能用旧编号提交不同内容。服务端保存交办后发送 `run_started`，随后负责保存工具调用、结果、助手消息和成果；浏览器不再重复补写这些消息。

执行记录使用现有 tasks 表的 `metadata.chatRun`；执行权表由 RunOwnershipStore 初始化，MySQL 相关表必须为 InnoDB。消息使用稳定 ID 更新，SQLite 和 MySQL 均拒绝把消息转移到另一会话或角色。模型密钥只在执行时解析，不写入执行记录。

## 停止与恢复

- `GET /api/chat/runs?sessionId=...` 列出当前用户会话的执行记录；`GET /api/chat/runs/:id` 读取状态。
- `POST /api/chat/runs/:id/stop` 请求取消。`stopping` 表示执行尚未收敛，不能宣布已经停止；结算后进入 `paused`。
- `POST /api/chat/runs/stop-request` 使用会话和请求编号取消尚未确认的交办，避免停止按钮与接单确认之间的竞态。
- `POST /api/chat/runs/:id/resume` 从安全检查点继续。同一会话不能同时执行或恢复两项任务。
- 页面关闭、SSE 断开不等于停止。重新打开会话后读取服务端记录并跟踪状态。
- 服务重启将未结束记录标为 `interrupted`，不自动重做副作用。已配对的工具结果保留；未知在途工具结果禁止盲目恢复，需要核实后重新交办。
- 模型已经结束但尚未完成文件交付或结果保存时，恢复只继续交付阶段。达到步数上限进入 `blocked`，不会作为成功完成。

终态在最终助手消息及执行记录保存后才对外发布。数据库故障会停止依赖它的后续执行，不把不可确认的结果显示为成功。

## 成果交付

文件、Office 和图像工具的成功输出会由服务端校验文件存在、文件类型和用户工作区范围。Shell/Python 等生成的文件使用 `file.present` 显式交付。外部符号链接、目录和不存在的文件不进入成果面板。

文本产物保留原有章节/来源完整性检查，补齐后仍不合格则阻塞交付。已有同名文本文件保留，新交付使用本次执行的版本后缀。界面展示校验后的成果记录，复用现有打开文件入口。

## 运行边界与验证

ChatRun 已使用 chat_run_ownership 数据库租约和数据库时钟协调所有权。同一会话只允许一个有效执行者，任务和结果消息按持有者令牌写入；过期进程不能覆盖新的结果，跨实例停止通过持久取消标记和续租检查收敛。SQLite 和 MySQL InnoDB 已测试；多个实例须共享数据库、文件工作区及对应浏览器运行时，不能仅共享会话表。持久化的会话和检查点可以跨重启恢复，外部终端、浏览器或第三方后台进程不能凭一条会话记录恢复。

本地 Shell/Python 进程组和支持取消的 HTTP/模型请求响应取消；没有独立取消句柄的 Docker 或第三方操作会等待实际结果结束后暂停，不宣称即时停止。Anthropic 已支持非流式工具协议，流式工具输出沿用兼容回退。

回归覆盖真实本地 HTTP、临时 SQLite、真实沙箱文件、停止/恢复、断线继续、重复交办、用户隔离、未知工具结果与交付完整性；模型响应受控模拟。MySQL 使用参数化 SQL/冲突测试，未连接生产数据库。

```sh
npm run test --workspace=server -- src/chat/ChatRunService.test.ts src/routes/chat.runs.test.ts src/db/runMessages.test.ts src/orchestrator/AgentOrchestrator.lifecycle.test.ts
./node_modules/.bin/vitest run --root frontend --config vite.config.ts
npm run build --workspace=server
npm run build --workspace=frontend
```


## 定时计划

调度器先将每个到期时间写入 scheduled_occurrences，再条件推进 scheduled_jobs；相同计划和到期时间只对应一条执行。单次计划完成后禁用定义并保留执行历史。已禁用计划不再加载，修改的 next_run 优先于旧 run_at。重启保留错过的到期时间；周期积压合并为一次执行，后续时间按服务器时区计算。五段 cron 支持列表、范围、步长、月度及星期日 0/7，拒绝非法值，不再用“明天”代替无效表达式。

每个模型计划创建普通对话并复用同一 ChatRunService。交办编号固定为到期执行 ID，接单和附着记录之间宕机不会产生另一个执行。密钥只在执行时解析，不写入计划执行记录。提醒写入稳定消息 ID，重启补记回执不会重复发出。

只自动恢复结果明确的 interrupted；用户停止的 paused、失败、阻塞及未知工具结果进入需要处理状态并停用后续周期。停止标记在接受交办前及执行权过期后都保留；自动恢复不会清除用户的停止决定。需要时在原对话手动继续，完成后更新历史回执。

普通账号可在系统设置的定时任务页查看执行记录、停止本次执行、打开原对话验收或退回修改。GET /api/x/scheduled-runs 仅返回自己的历史；POST /api/x/scheduled-runs/:id/stop 停止自己的执行。暂停或删除计划同步取消已排队及运行中的执行，保留到期历史。

证据：ScheduledOccurrenceService、XScheduler、scheduledJobs 路由及 ChatRun 所有权测试；outputs/x-computer-scheduler-20261031 的真实模型文件打开截图与验收记录。后台意图入口已统一；外部渠道直接聊天及旧 createTask 路径仍需审计，不以当前验收证明所有执行入口完成。


## 旧后台意图入口统一（2026-10-31）

runIntentAsPersistedTask 现在只委托共享的 ScheduledOccurrenceService.run；执行器未装配时拒绝回退到旧内存 Task。runAgentAsPersistedTask 沿用服务端模型解析并传入该智能体的提示词及工具范围。手动 /api/x/run-now 支持 requestId，返回同一 runId/sessionId；重复编号无法改换内容或权限。HTTP 连接不拥有执行。失败明确返回错误，不把错误正文当作成功，也不自动重放整轮模型。

后台交办复用 scheduled_occurrences 的稳定 ID、对话映射、数据库执行权及恢复。系统提示词和工具范围作为检查点保存；密钥、baseUrl 和任意元数据不会照单写入记录，执行时按 provider/model 重新查找服务端凭据。事件指纹去重保留现有七天语义；结果未知或失败的执行不会因再次触发而自动重做。完成回调在记录结算前保存幂等的 handled_events 回执，避免丢失后续去重。

工具允许范围现在同时约束普通及按需模式，空允许列表明确表示没有工具；禁止名单在每次工具刷新和真正派发时仍生效。受限后台任务使用固定范围，不能通过能力加载扩大。平台默认模型在未提供覆盖项时正常解析；显式指定未知提供商时不再静默切换到环境变量中的另一家模型。

手动完成后不再隐式进化记忆或创建每日自检计划；打开主脑和事件完成也不会新增默认计划。没有修改记忆管理模块或清理历史数据。普通账号可查看后台记录及成果，自动执行能力不等于无限免费算力或公开上线资格。

证据：outputs/x-computer-background-20261031/real-model-140fe29a.json、file-opened.png、accepted.png；后台服务、凭据解析、工具权限与手动 HTTP 回归测试。专用 MySQL 仍使用带测试标签的隔离容器，与原 MySQL 无关。
