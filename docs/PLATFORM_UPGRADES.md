# 平台能力升级（2026-11 调研落地）

来源：对 DeepSeek Harness、OpenBot、Open Duet、Pi 的调研清单（共享笔记 `survey-openbot-openduet-pi-dsh.md`）。本页按清单编号记录每项已落地的内容、配置开关与验收方法。详细设计另见 `PACKAGE_MODEL.md`（1、2）与 `MODEL_LAYER.md`（3、6）。

| # | 主题 | 代码位置 | 验收要点 |
|---|------|----------|----------|
| 1 | 工具执行流水线 + 审计 | `server/src/orchestrator/pipeline/` | 任一工具调用后 `audit_log` 里先有 `action` 行再有 `result`/`error` 行，`metadata.initiator` 标明来源；被 blockedToolNames 拒绝的工具返回错误而不执行 |
| 2 | X 包模型（一、二期） | `server/src/packages/`、`routes/packages.ts`、`orchestrator/tools/packages.ts`、前端插件中心 | 让助手「做一个计数器应用」→ `apps/<id>/x-package.json` 生成、插件中心出现、可停用/移除；`x.package_share` 到空间后另一成员 `x.package_install(source:"space:家庭/<id>", confirm:true)`；tools 类包的工具以 `pkg.` 前缀出现 |
| 3 | 模型适配层 / 能力目录 / 自动路由 | `server/src/llm/adapters/`、`modelCatalog.ts`、`virtualModel.ts` | 模型选 `auto` 且 `.x-config.json` 配好 `llm_config.autoRoute` 后，短问走 cheap、写作/带图走 strong，运行记录 `routedModel` 固定本次选择；未配置时运行进入 blocked 并提示 |
| 4 | 上下文压缩 | `server/src/chat/compaction/` | 超长对话时日志出现「上下文压缩」；历史里出现以「【前文摘要】」开头的消息且保留文件路径 |
| 5 | 调度可靠性 + webhook 幂等 | `scheduler/XScheduler.ts`、`routes/webhookTrigger.ts` | 第 21 个定时任务被拒（可用 `X_SCHEDULER_MAX_JOBS_PER_USER` 调整）；`GET /api/runtime/plugins` 的 `scheduler.lastTickAt/healthy`；`x.list_scheduled_runs` 显示 enabled 与 lastRun；同一 `X-GitHub-Delivery`/`Idempotency-Key` 的重复 webhook 返回 `duplicate:true` |
| 6 | 用量与成本 | `server/src/llm/usage.ts`、`ModelUsageStore.ts`、订阅页「模型用量」 | 每次模型调用后 `model_usage` 新增一行；`GET /api/usage/models?days=7` 有总计/按模型/按天 |
| 7 | 后台任务 + 渠道进度提示 | `server/src/jobs/`、`orchestrator/tools/jobs.ts`、`scheduler/progressNotice.ts` | `shell.run(run_in_background:true)` 立即返回 jobId，`job.output` 可查，完成后有通知；QQ 私聊中超过 20 秒的回复先收到「正在处理中」 |
| 8 | 记忆 2.0 | `server/src/memory/memoryEntries.ts`、`TopicNotes.ts`、`orchestrator/tools/memoryTopics.ts` | 对助手说「记住预产期是 2027-03-20」→ `memory/MEMORY.md` 出现带日期的一行；「医院改成 B 院」→ 旧行被 `~~划掉~~`；`memory_undo` 可撤销；`GET /api/memory/topics` |
| 9 | Codemode（`run_code`） | `server/src/codemode/`、`orchestrator/tools/runCodeTool.ts` | 让助手「用脚本把 5 个文件各读前 3 行汇总」→ 工具记录里只有一次 `run_code`，输出是脚本返回值；脚本内 `require('fs')` 读文件会被拒绝 |
| 10 | 分层配置 + 热重载 | `server/src/config/layeredConfig.ts`、`defaultConfig.ts`、`routes/runtime.ts` | 新建 `server/.x-config.local.json` 覆盖某项后不重启即生效（日志「配置已重新加载」）；管理员 `GET /api/runtime/config` 看到各层来源与脱敏后的结果 |
| 11 | 组件化回复（动作卡） | `orchestrator/tools/cards.ts`、前端 `ActionCard.tsx` | 让助手「用卡片让我确认是否发送」→ 对话里出现带按钮的卡片，点击后文字填入输入框 |
| 12 | Skills 对齐 Agent Skills 规范 | `server/src/skills/discovery.ts`、`skillCommand.ts` | 嵌套目录与 `.agents/skills` 下的 SKILL.md 被发现；`disable-model-invocation: true` 的 Skill 不出现在模型列表，但 `/skill:name 请求` 可用 |

## 配置开关汇总

```jsonc
// server/.x-config.json（基础层）；同目录 .x-config.<profile>.json、.x-config.local.json 依次覆盖；环境变量 X_CONFIG_PATCH_JSON 最后覆盖
{
  "llm_config": {
    "autoRoute": { "cheap": { "providerId": "minimax", "modelId": "MiniMax-M3.1-Flash" }, "strong": { "providerId": "deepseek", "modelId": "deepseek-chat" }, "longInputTokens": 6000 },
    "models": [{ "match": "MiniMax-M3.1", "contextWindow": 204800, "inputUsdPerMTok": 0.2, "outputUsdPerMTok": 1.1 }]
  }
}
```

环境变量：`X_PACKAGE_CATALOG_URLS`（包目录索引，逗号分隔）、`X_SCHEDULER_MAX_JOBS_PER_USER`（默认 20）、`X_CHANNEL_PROGRESS_NOTICE_MS`（默认 20000）、`X_CONFIG_PATCH_JSON`。

## 已知边界

- 后台任务注册表在进程内，重启后运行中的任务不保留（工具说明里已写明）。
- `run_code` 依赖 Node 的权限模型（`node --permission`，Node 20+），脚本只能通过 `tools` 访问外界；它不是容器级隔离。
- 热重载只覆盖配置值的读取方；已挂载的路由与插件启停仍需重启。
- 包目录（catalog）安装的是静态 zip 包，不运行安装脚本。
