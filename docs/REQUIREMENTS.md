# X-Computer 需求管理

本文档以**需求表**形式记录所有功能需求，用于项目化管理和迭代规划。当你提供新需求时，我会先评估、录入本表并标注状态与优先级，再按优先级安排开发；开发过程中更新状态，完成后标记「已完成」。

**最后更新**：2026-03-12（R069 新增：Admin 角色与全局管理，详见 ADMIN_PLAN.md）。

---

## 1. 使用说明

### 1.1 状态定义

| 状态     | 说明                           |
|----------|--------------------------------|
| **待开发** | 已确认、未开始                 |
| **开发中** | 正在实现中                     |
| **已完成** | 已实现并通过验证/测试          |

### 1.2 优先级定义

| 优先级 | 说明                     |
|--------|--------------------------|
| **P0** | 最高，阻塞发布或核心体验 |
| **P1** | 高，本迭代重点           |
| **P2** | 中，有计划排期           |
| **P3** | 低，可延后               |

### 1.3 工作流程

1. **你提供需求** → 我评估可行性、范围与依赖，写入下表（状态：待开发，并给出优先级建议）。
2. **开始开发** → 将该需求状态改为「开发中」，必要时在备注中写实现要点或关联文档。
3. **开发完成** → 状态改为「已完成」，填写完成日期；若有文档/测试变更在备注中说明。

---

## 2. 需求表

| ID   | 需求描述 | 状态   | 优先级 | 创建日期   | 完成/更新 | 备注/关联 |
|------|----------|--------|--------|------------|-----------|-----------|
| R001 | Chat 会话持久化：会话历史存后端，刷新/重开不丢失 | 已完成 | P1 | 2026-02-12 | 2026-02-11 | INFRASTRUCTURE 阶段 D：chat_sessions/chat_messages 持久化与同步 |
| R002 | 不可用应用标注：浏览器/表格/邮件/日历在设置或列表中标注为「演示」或「即将推出」 | 已完成 | P2 | 2026-02-12 | 2026-02-11 | DEV_PLAN 阶段一 |
| R003 | 多用户与云端存储：多用户隔离、云端存储与同步 | 已完成 | P1 | 2026-02-12 | 2026-02-11 | 核心项已完成：身份/沙箱/任务/审计/配置/聊天按用户隔离，见 INFRASTRUCTURE_MULTIUSER_CLOUD.md |
| R004 | 文件管理器增强：创建/修改时间精确到秒、列排序、右键复制路径、属性展示完整时间 | 已完成 | P2 | 2026-02-11 | 2026-02-11 | 后端 FSEntry 增加 created、modified 全 ISO；前端排序与右键菜单 |
| R005 | 图片查看器与按类型打开：图片用 image-viewer，其他按扩展名选 code-editor/text-editor | 已完成 | P2 | 2026-02-11 | 2026-02-11 | GET /api/fs/read-binary、ImageViewerApp、BuiltinAppId image-viewer |
| R006 | MCP API Key 兼容 Cursor：URL/headers 支持 ${VAR} 替换，配置支持 env 对象 | 已完成 | P2 | 2026-02-11 | 2026-02-11 | server/src/mcp/client.ts env 替换与 cleanUrl；MCP_CONFIG.md、设置页说明 |
| R007 | Skill 注册与发现：发现 SKILL.md、注册到能力列表、主脑可见；可选 skill 工具加载内容 | 已完成 | P2 | 2026-02-11 | 2026-02-26 | discovery.ts：discoverSkills/getDiscoveredSkills 多路径扫描 SKILL.md；formatSkillsSummary 注入能力列表；skill.load 加载正文到上下文；R031 补充自安装/删除/SkillHub；详见 REFERENCE_OPENCLAW_OPENCODE_SKILLS.md、SKILLS_SELF_INSTALL_PLAN.md |
| R008 | 测试覆盖补全：关键 API（聊天/图片/会话）、记忆召回与捕获、LEARNED_PROMPT 链路有测试 | 开发中 | P1 | 2026-02-11 | 2026-03-10 | api.test.ts 92 用例全通过；修复 app backend 路由缺 await、测试中 db 异步调用；DockerTaskRunner 测试依赖环境仍 skip |
| R009 | 更多工具真实化：search.web、llm.analyze 等按需接入真实后端或 MCP | 待开发 | P2 | 2026-02-11 | — | DEV_PLAN 阶段四 4.3；每项单独评审 |
| R010 | 界面文字可选中复制：聊天/编辑器/文件列表等内容区可选中复制，仅标题栏与任务栏保持不可选 | 已完成 | P2 | 2026-02-12 | 2026-02-12 | 移除全局 user-select: none，任务栏加 select-none |
| R011 | 主脑能查资料与分析文本：search.web（委托已注入的 MCP 搜索）与 llm.analyze（真实 LLM 分析），使对话/任务中可查资料、总结、分类 | 已完成 | **P1** | 2026-02-12 | 2026-02-12 | ToolExecutor 新增 search.web、llm.analyze；MCP 已注入则直接委托 |
| R012 | X 主脑：不断进步、主动学习、主动找用户、X 专属入口 | 已完成 | P1 | 2026-02-12 | 2026-02-12 | 主脑人设：有抱负、用搜索/工具学习、后台进化提示词（用户无感知）；可自配 MCP/Skills、缺 Key 时搜索免费或 x.notify_user；新增「X 主脑」应用：纯对话 + 展示 X 主动消息；GET /api/x/proactive-messages、WS x_proactive_message、工具 x.notify_user |
| R013 | X 定时任务目标驱动与永不零任务：每次自动/定时运行有目标，完成后定下一个；用沙箱记录任务；任务持久化；保证至少一个唤醒任务 | 已完成 | P1 | 2026-02-12 | 2026-02-12 | scheduled_jobs 表持久化、XScheduler 支持 Store、执行后 ensureDefaultScheduleForUser；系统提示：目标、沙箱任务清单、完成后定下一个、至少一个定时 |
| R014 | X 事件驱动执行：除定时外，支持「用户发消息后」「任务完成后」等触发一次 run-now，使 X 在有事发生时自动跑一轮 | 已完成 | P2 | 2026-02-12 | 2026-02-12 | 用户追加聊天消息 → onMessageAdded；task_complete 钩子 → triggerXRunForUser；节流 60s/用户 |
| R015 | X 读取用户待办/留言：提供「给 X 的待办」或留言 API/存储，X 定时或事件触发时读取并处理，形成闭环 | 已完成 | P2 | 2026-02-12 | 2026-02-12 | db 配置 x_pending_requests；GET/POST/DELETE /api/x/pending-requests；工具 read_pending_requests、clear_pending_requests |
| R016 | X 创建/更新系统任务：主脑通过工具创建任务进任务时间线（create_task 或等价），用户可见、可审批或自动执行，与沙箱 x-tasks.md 协同 | 已完成 | P2 | 2026-02-12 | 2026-03-10 | task.create 工具；domain/title/description/mode；对接 orchestrator.createAndRun；主脑提示词注入；planToolFilter 高级工具 |
| R017 | X 对外触达：除 x.notify_user 应用内推送外，支持发邮件/WhatsApp/QQ/Telegram/Discord/Slack，用户不在线时也能触达 | 已完成 | P3 | 2026-02-12 | 2026-03-09 | 六大渠道完成：x.send_email/whatsapp/qq/telegram/discord/slack；设置→渠道 Tab 化配置 |
| R018 | 定时/run-now 失败重试：LLM 或网络失败时自动重试（有限次数+退避），避免一次失败即丢 | 已完成 | P2 | 2026-02-12 | 2026-02-12 | runScheduledIntent 与 run-now 使用 runWithRetry；2 次重试、指数退避；仅瞬时错误重试 |
| R019 | X 资源与限流：单次运行 max_steps、每日/每周 API 预算或运行次数上限，防止失控 | 待开发 | P3 | 2026-02-12 | — | 配置项 + 运行时检查；可选 per-user 配额 |
| R020 | Python 执行支持：沙箱内执行 Python 脚本，X 可编写、执行并查看输出，支持简单调试（如超时、stdout/stderr） | 已完成 | P1 | 2026-02-12 | 2026-02-12 | 工具 python.run：scriptPath、args、timeout；沙箱内 python3 执行，返回 stdout/stderr/exitCode；x_direct 提示已提及 |
| R021 | 小程序/桌面快捷应用：将 Python 脚本或微应用「固定到桌面」为图标，点击即运行并在独立窗口展示输出，形成用户可自制的小程序 | 已完成 | P2 | 2026-02-12 | 2026-02-13 | X 用 **x.create_app** 制作有界面小程序（app_id、name、html_content、css/js 可选），存沙箱 apps/、配置 x_mini_apps；GET /api/apps、/api/apps/sandbox；前端桌面/搜索展示，iframe 打开 |
| R022 | 应用/游戏多媒体资源生成：X 可根据需求自动规划并生成音乐、音效等；图片沿用 llm.generate_image；音频方案见 AUDIO_GENERATION_OPTIONS.md | 已完成 | P3 | 2026-02-13 | 2026-02-14 | 设置→多媒体配置（fal/MusicAPI/ElevenLabs）；llm.generate_sound_effect、llm.generate_music 均使用 fal.ai |
| R023 | X 小程序与小游戏创作增强：资源目录约定、主脑「做小游戏」指引与 plan 结构，使 X 能按用户意图生成可玩小游戏或更复杂小程序 | 已完成 | P2 | 2026-02-14 | 2026-03-10 | MINIAPP_GAME_PLAN.md 新增 §1 资源目录约定（images/sfx/bgm）；x_direct 注入【做小游戏专用流程】含 plan 结构、5 步顺序、音效手势解锁；x.create_app 强化 apps/&lt;id&gt;/assets/ 路径说明 |
| R024 | X 办公文档处理：支持 docx、PPT、Excel 的创建与读取，使用户可让 X 撰写/整理周报、汇报、表格等 | 已完成 | P1 | 2026-02-14 | 2026-02-14 | office.create_docx/read_docx、office.create_xlsx/read_xlsx、office.create_pptx；server/src/office/index.ts；主脑提示已注入办公工具说明 |
| R025 | 小程序/小游戏后端能力：需要后端存储、接口、队列时，为 X 提供标准能力，使其可自行创建数据库（KV）、后台接口、队列等 | 已完成 | P2 | 2026-02-14 | 2026-02-14 | backend.kv_set/get/delete/list、backend.queue_push/pop/len；GET/PUT/DELETE /api/x-apps/backend/kv/:appId、POST/GET /api/x-apps/backend/queue/:appId/:queueName；见 MINIAPP_BACKEND.md；WebSocket 推送规划中 |
| R026 | X 办公能力升级：Agent 团队、角色、文件与外部连接——多智能体组队（x.create_team/list_teams/run_team）、智能体角色（role）、办公场景下文件/office 工具与 http/MCP 使用说明 | 已完成 | P1 | 2026-02-14 | 2026-03-09 | 12 个工具全实现（团队 5 + 群组 7）；REST API CRUD；前端 AgentManagerApp 三 Tab UI；群组执行取消/历史；API 测试覆盖；见 docs/X_OFFICE_AGENT_TEAM.md |
| R027 | 对话中上传图片作为参考图：对话框中可上传 1–3 张图，用户要求基于图片修改时作为参考图传给主脑；参考图支持沙箱路径或公网 URL；read_recent_assistant_chat 返回顺序为从新到旧 | 已完成 | P2 | 2026-02-14 | 2026-02-14 | ChatApp 上传 UI、referenceImagePaths 入参、后端注入最后一条用户消息；附带图时走 Agent 流程不走直接文生图；ToolExecutor 参考图支持 http(s) URL；recentChatForX 排序新→旧 |
| R028 | 沙箱文件云端存储与跨设备同步：① 沙箱内所有文件保存到云端（对象存储 S3/Blob）；② 从其他浏览器登录时按需或批量下载，类似 OneDrive 体验 | 待开发 | P1 | 2026-02-23 | — | 详见 INFRASTRUCTURE_MULTIUSER_CLOUD.md 阶段 E；SandboxFS 需对接对象存储；前端可选按需拉取或首次登录全量同步 |
| R029 | 账号注册与登录：Mac 风格登录页、进入系统前必须登录、无匿名、验证码防自动化、多次失败锁定防暴力破解 | 已完成 | P1 | 2026-02-23 | 2026-02-23 | LoginScreen、GET /api/auth/captcha、数学验证码、rateLimit 5 次/15 分钟；退出登录清空 localStorage/Cookie/Cache；X_COMPUTER_REQUIRE_LOGIN=false 可关闭 |
| R030 | 默认配置文件 .x-config.json：首次进入使用默认 LLM 配置与 API Key，支持 {env:VAR} 占位符 | 已完成 | P1 | 2026-02-23 | 2026-02-23 | server/src/config/defaultConfig.ts；X_COMPUTER_CONFIG_PATH、工作区、~/.x-computer/ 查找；GET /api/users/me/config 合并默认值；首次登录自动填入 apiKey |
| R031 | Skills 自安装与缺 Key 时询问用户：借鉴 OpenClaw，X 可自行安装 Skill（skill.install 从 URL/SkillHub）、删除 Skill（skill.uninstall）、搜索 SkillHub（skill.list_remote），缺 API Key 时通过 x.notify_user 引导用户到设置填写 | 已完成 | P2 | 2026-02-23 | 2026-02-23 | skill.install、skill.uninstall、skill.list_remote、configFields、设置页配置与删除；详见 SKILLS_SELF_INSTALL_PLAN.md |
| R032 | X 对话与 AI 助手流式输出及 Markdown 表格：回复内容流式展示；remark-gfm 支持表格渲染 | 已完成 | P2 | 2026-02-23 | 2026-02-23 | callLLMWithToolsStream、onContentChunk、content_chunk SSE；XApp/ChatApp 流式更新；remark-gfm 表格样式 |
| R033 | 文件管理器展示宿主机沙箱路径：显示沙箱在宿主机上的绝对路径，支持复制 | 已完成 | P2 | 2026-02-23 | 2026-02-23 | GET /api/fs/workspace-path、api.getWorkspacePath；FileManagerApp 工具栏展示并复制 |
| R034 | shell.run 工作目录固定为宿主机工作区：X/agent 执行 node/python 等时 cwd 为沙箱宿主机路径，确保能找到 file.write 写入的脚本 | 已完成 | P1 | 2026-02-23 | 2026-02-23 | ToolExecutor shell.run 传入宿主机绝对路径；SandboxShell 接受绝对 cwd |
| R035 | X 编程与制作 Skill/工具：X 可通过编程创建新 Skill、自定义工具，形成自扩展能力链 | 待开发 | P1 | 2026-02-23 | — | 详见 X_PROGRAMMING_SKILLS_TOOLS_PLAN.md |
| R036 | sleep 工具：rate limit、超时等错误时，X 可 sleep 几十秒再重试 | 已完成 | P2 | 2026-02-23 | 2026-02-23 | 工具 sleep(seconds)，上限 300 秒；主脑提示已注入 |
| R037 | 信号/条件触发：满足条件时触发某 agent 或主脑任务，类似工作流/BPMN；signal.emit、signal.add_trigger 等 | 已完成 | P1 | 2026-02-23 | 2026-02-23 | signal.emit/add_trigger/list_triggers/remove_trigger；内置 user_message_sent、task_completed；signalService |
| R038 | X 智能决定触发时间：根据上下文主动预约下次运行，不依赖固定 cron 或人类交互 | 已完成 | P1 | 2026-02-23 | 2026-02-23 | x.schedule_run 支持 in_minutes/in_hours 相对时间；提示强化 |
| R039 | 每个 agent 独立工作目录：X 创建的 agent 有独立沙箱目录，文件读写、shell 执行互不影响 | 已完成 | P1 | 2026-02-23 | 2026-02-23 | UserSandboxManager getForAgent、users/{uid}/workspace/agents/{agentId}/；ToolExecutor/AgentOrchestrator 传入 agentId |
| R040 | 服务器日志东八区时间：控制台日志时间戳显示为 Asia/Shanghai，便于本地查看 | 已完成 | P3 | 2026-02-23 | 2026-02-23 | ServerLogger 用 toLocaleString timeZone: Asia/Shanghai 替代 toISOString |
| R041 | 工作流引擎微服务：BPMN 风格流程编排，定时/事件触发、任务/网关/分支，X 可调用并读写任务数据 | 已完成 | P1 | 2026-02-23 | 2026-02-24 | workflow-engine；workflow.* 工具；script/ai 任务回调主服务 execute-task；X 系统提示词工作流指引 |
| R042 | 邮件渠道双向通信：X 收邮件（IMAP）、收到回复后可处理并回信，形成邮件渠道通信 | 已完成 | P3 | 2026-02-24 | 2026-02-24 | IMAP 定时拉取→emails 表→GET /api/email/inbox 读 DB；mailparser 解析正文；email_received 信号含 goal（发件人/主题/正文），X 用 x.send_email 回复；x.set_email_from_filter / x.list_email_from_filter 发件人过滤；POST /api/email/sync 手动同步 |
| R043 | 对话中上传文件：对话框中可附加文档（txt、md、pdf 等），上传到沙箱并作为 attachedFilePaths 传给 X，供 file.read / memory_embed_add 使用 | 已完成 | P2 | 2026-02-24 | 2026-02-24 | ChatApp Paperclip 按钮、attachedFilePaths、后端注入最后用户消息；DEVELOPMENT.md API 更新 |
| R044 | X 向量记忆工具：memory_search、memory_embed_add、memory_delete，使 X 可转向量、检索、删除；大文件先 embed 再 search | 已完成 | P2 | 2026-02-24 | 2026-02-24 | ToolExecutor 新工具、systemCore 提示、getVectorConfigForUser 注入；X 可主动查向量 |
| R045 | Skill 安装后自动 npm install：skillhub/URL 安装后若存在 package.json 则执行 npm install，支持 npx 调用；缺失 npm/npx 时尝试安装（brew/fnm/nvm） | 已完成 | P2 | 2026-02-24 | 2026-02-24 | runNpmInstallInSkillDir、ensureNpmAvailable、ensureNpxAvailable；R031 增强 |
| R046 | Shell 安全策略放宽：允许 2>/dev/null 抑制 stderr，仅拦截重定向到块设备 | 已完成 | P3 | 2026-02-24 | 2026-02-24 | SandboxShell BLOCKED_PATTERNS 放宽，du -sh /* 2>/dev/null 等可执行 |
| R047 | 定时/触发任务运行日志持久化：定时执行（XScheduler）和信号触发（fireSignal）产生的运行需保留日志，与普通任务结果一样可查询、可追溯 | 已完成 | P2 | 2026-02-24 | 2026-02-25 | 复用 tasks 表：runIntentAsPersistedTask / runAgentAsPersistedTask 创建并持久化 Task，metadata 含 source（scheduled_job/event_driven/run_now/signal_trigger）、sourceId；GET /api/tasks 可查询，task.metadata.source 可过滤 |
| R048 | 任务完成后 AI 助手自动回复：AI 助手触发创建任务并执行完成后，回到对话框自动追加「任务完成了，根据结果xxxx」风格回复 | 已完成 | P2 | 2026-02-25 | 2026-02-25 | POST /api/chat/task-completion-reply；ChatApp 监听任务完成并调用 API 生成跟帖、插入消息并持久化；另：移除界面用量统计（文本编辑器底栏字符/词/行） |
| R049 | 定时/事件触发去重：记录已处理事件 fingerprint（如 email uid、taskId），7 天内相同事件不再重复触发，避免「收到邮件已处理但仍触发」 | 已完成 | P1 | 2026-02-26 | 2026-02-26 | handled_events 表；signalService computeActionFingerprint；fireSignal 前 checkHandled、完成后 recordHandled；task metadata actionFingerprint |
| R050 | 数据库可配置 SQLite/MySQL：DATABASE_TYPE 环境变量切换，MYSQL_HOST/PORT/USER/PASSWORD/DATABASE 配置 MySQL 连接；默认 SQLite | 开发中 | P2 | 2026-02-26 | 2026-03-09 | createDatabase 工厂；database-mysql.ts 已实现（异步 API）；api.ts 缺失 await bug 已修复（WhatsApp 消息/审计日志/MCP 配置/小程序列表）；MySQL 端到端测试待验证 |
| R051 | X 任务看板与近期已完成增强：X 有看板（todo/in_progress/pending/done）、x.board_* 工具、桌面「X 任务看板」应用；x.record_done 支持 scheduled 与结构化（schedule/title/action）；定时任务创建同步到看板、完成后对应项自动改为 done；事件触发「用户发消息」时意图改为处理聊天记录、不生成面向用户的对话式回复 | 已完成 | P1 | 2026-02-26 | 2026-02-26 | shared XBoardItem/XDoneLogEntry；x_board_items 表+source_id；x.record_done 参数 scheduled/schedule/title/action；GET /x/done-log、GET/POST/PATCH/DELETE /x/board；XApp 近期已完成面板；SCHEDULED_RUN_MANDATE 约束「处理聊天记录」 |
| R052 | WhatsApp 渠道接入：参考 Openclaw，使用 Baileys（WhatsApp Web）实现双向通信；QR 码登录、白名单策略、x.send_whatsapp 工具、whatsapp_message_received 信号 | 已完成 | P2 | 2026-02-27 | 2026-02-27 | whatsappService、whatsapp_messages 表、API 路由、设置页配置；详见 docs/WHATSAPP_INTEGRATION.md |
| R053 | 远程服务器管理：X 可通过 SSH 连接和管理远程服务器，支持密码/密钥认证、命令执行、文件传输（SFTP）；9 个 server.* 工具（add/list/connect/exec/upload/download/disconnect/remove/test）；servers 表持久化配置；支持标签分类、自动连接、连接池、超时控制 | 已完成 | P1 | 2026-02-28 | 2026-02-28 | ServerManager、server/* 工具、servers 表、核心提示词更新；详见 docs/SERVER_MANAGEMENT.md、docs/SERVER_QUICKSTART.md |
| R054 | 国际化（i18n）：界面和 AI 提示词支持中英文切换；前端使用 react-i18next，语言包 en.json/zh-CN.json；后端提示词按用户语言动态选择；用户配置保存语言偏好 | 已完成 | **P0** | 2026-02-28 | 2026-02-28 | 前端国际化 100%，AI 核心提示词英文版已完成；详见 I18N_IMPLEMENTATION_SUMMARY.md |
| R055 | 营销首页：专业产品介绍页面，包含 Hero、Features、Pricing、Footer；独立部署到 CDN；响应式设计；支持中英文；SEO 优化 | 已完成 | **P0** | 2026-02-28 | 2026-02-28 | Next.js 15 项目已创建，响应式设计，Vercel 部署配置完成；位于 marketing/ 目录 |
| R056 | 用户认证增强：邮箱验证（注册时发送验证邮件）、密码重置（忘记密码流程）、会话管理（JWT 刷新、多设备）；可选第三方登录（Google/GitHub） | 开发中 | P1 | 2026-02-28 | 2026-03-09 | 邮箱验证、密码重置 API 已完成；密码重置 bug 已修复（SHA-256→scrypt）；前端忘记密码 UI 已完成；OAuth 待集成；详见 AUTH_ENHANCEMENT_SUMMARY.md |
| R057 | 付费与订阅系统：试用（7 天/100 次调用）+ 多套餐订阅（个人版/专业版/企业版）；Stripe 支付集成；配额管理（AI 调用、存储、并发任务）；超限提示升级；数据库表：subscriptions、usage_records、plans | 已完成 | **P0** | 2026-02-28 | 2026-02-28 | 商业化核心；详见 R057_SUBSCRIPTION_IMPLEMENTATION.md |
| R058 | 用户仪表板：订阅管理（当前套餐、升级/降级、取消）、使用统计（AI 调用、存储、图表）、账单历史（订单、发票下载）、账户设置（个人信息、密码修改） | 开发中 | P1 | 2026-02-28 | 2026-03-10 | 订阅管理（SubscriptionApp）已有；GET /api/subscriptions/me/invoices 账单历史 API + SubscriptionApp 账单区块已完成；账户设置（密码修改）见 R056 忘记密码 |
| R059 | 管理后台：用户管理（列表、搜索、封禁）、订阅管理（手动调整、退款）、系统监控（用户数、收入、API 调用量）、内容管理（公告、邮件模板）；独立部署或集成到主应用 | 待开发 | P2 | 2026-02-28 | — | 运营管理工具；详见 COMMERCIALIZATION_PLAN.md §2.6 |
| R060 | 安全加固：Docker 容器隔离、禁用宿主机命令执行、环境变量清理、资源限制、网络隔离；防止用户突破沙箱访问宿主机或其他用户数据 | 已完成 | **P0** | 2026-02-28 | 2026-03-01 | 阶段 1-3 已完成；详见 SECURITY_HARDENING_COMPLETE.md |
| R061 | 性能优化与并发扩展：支持 100-500 并发用户，响应时间 < 500ms；移除全局并发限制、容器池优化、数据库升级、集群部署 | 开发中 | **P1** | 2026-02-28 | — | 阶段 1 部分完成；详见 PERFORMANCE_ANALYSIS.md |
| R062 | CentOS 8 / 1Panel 部署修复：Node.js 22、Python 3.9、GCC 11、better-sqlite3 编译；1Panel OpenResty 前端同步（frontendSyncPath）；.x-config.json 合并而非覆盖；dockerode 符号链接；Docker 沙箱 UID/GID 修复 | 已完成 | P1 | 2026-03-02 | 2026-03-02 | 详见 docs/deployment/CENTOS8_DEPLOYMENT_COMPLETE.md、docs/fixes/NODE_VERSION_FIX.md、docs/OPENRESTY_CONFIG.md |
| R063 | SaaS 线上版完善：① 登录页、设置页等界面翻译（i18n）；② 内置工具/MCP/大模型默认配置文档（SAAS_DEFAULT_CONFIG.md）；③ 试用 vs 专业版功能区分（trial 仅基础工具，personal 含 office/http，pro 含 MCP/高级工具） | 已完成 | P1 | 2026-03-07 | 2026-03-07 | LoginScreen/SettingsApp 使用 useTranslation；planToolFilter 按 plan features 过滤工具；详见 docs/SAAS_DEFAULT_CONFIG.md |
| R064 | 设置页简洁模式：隐藏高级设置（AI、MCP、Skills 等），仅显示通用、账号、关于；localStorage 持久化；可随时切换「显示高级设置」 | 已完成 | P1 | 2026-03-07 | 2026-03-07 | SettingsApp 增加 simpleMode 开关；BASIC_TABS 过滤 |
| R065 | 新手向导：首次登录后 3 步引导（打开 AI 助手→发送消息→查看任务）；可跳过；完成后不再显示 | 已完成 | P1 | 2026-03-07 | 2026-03-07 | OnboardingOverlay 组件；localStorage onboarding_done |
| R066 | ChatApp 示例对话：空状态展示「试试这些」6 个示例 prompt（整理邮件、写代码、周报、总结文档、解释代码、搜索）；支持 i18n | 已完成 | P1 | 2026-03-07 | 2026-03-07 | quickActions 扩展为 6 项，使用 t()；详见 SAAS_UX_FEATURES.md |
| R067 | 多渠道消息接入（QQ/Telegram/Discord/Slack）：参考 WhatsApp 六层模式（Service + Loop + Signal + Route + Tool + Frontend），统一接入 QQ（qq-official-bot SDK）、Telegram（node-telegram-bot-api）、Discord（discord.js）、Slack（@slack/bolt）；channel_messages 统一消息表；各渠道独立信号触发与去重；消息渠道免节流 | 已完成 | P1 | 2026-03-09 | 2026-03-09 | qqService/Loop、telegramService/Loop、discordService/Loop、slackService/Loop；channel_messages 表；x.send_qq/telegram/discord/slack 工具；信号触发免节流 |
| R068 | 渠道设置 Tab 化重构：设置侧边栏「通知/邮件」改为「渠道」；内部使用子 Tab 管理 Email、WhatsApp、QQ、Telegram、Discord、Slack 六大渠道配置；各渠道配置独立加载与保存 | 已完成 | P2 | 2026-03-09 | 2026-03-12 | SettingsTab notify→channels；ChannelsSettings 容器 + 子 Tab；qq_config/telegram_config 等加入 EMPTY_OBJECT_KEYS，首次打开免 404；SettingsApp MCP 区 JSX 结构修复 |
| R069 | Admin 角色与全局管理：新增 admin，用于管理注册用户和全局管理；配置指定 admin 邮箱（admin.emails）；requireAdmin 中间件保护 /api/admin/*；AdminApp 用户列表、封禁/解封、系统概览；R059 管理后台可基于此扩展 | 已完成 | P2 | 2026-03-12 | 2026-03-12 | adminConfig、requireAdmin、admin 路由、AdminApp、adminStore；详见 docs/ADMIN_PLAN.md |

*新需求按上述流程追加；完成或状态变更时更新本表与关联文档。*

---

## 2.1 完全自主所需能力（X 主脑）

为使 X **完全自主**（不依赖用户主动来找、到点或有事都能动、能触达用户、能派活且可恢复），在现有「定时 + 立即执行 + 自我进化 + 通知用户」基础上，建议补齐以下能力（已录入上表）：

| 能力方向 | 说明 | 需求 ID |
|----------|------|---------|
| **事件驱动** | 不仅定时，还能在「用户刚发消息」「某任务完成」等事件时自动跑一轮，做到「有事就动」 | R014 |
| **读用户意图** | 有地方存「用户希望 X 做的事」或待办，X 定时/事件时读取并处理 | R015 |
| **派活到时间线** | X 能把要做的事做成系统「任务」，进任务时间线，用户可见、可审批，与整机一致 | R016 |
| **对外触达** | 用户不在线时通过邮件/Slack/推送等触达，而不只是应用内 x.notify_user | R017 |
| **失败可恢复** | 定时/run-now 失败时有限重试+退避，不因一次报错就丢 | R018 |
| **资源与限流** | 单次/每日步数或调用上限，防止失控或成本爆掉 | R019 |

当前已有：定时 + 永不零任务、**事件驱动（R014）**、**用户待办/留言（R015）**、**失败重试（R018）**、自我进化与助手优化、沙箱任务清单、MCP/Skill、搜索与分析、run-now 带前端配置、大模型配置同步云端、**Python 执行（R020）**、**桌面小程序（R021）**、**应用/游戏多媒体资源（R022）**。下一步可优先 **R023（小程序/小游戏创作增强）** 或 **R016（派活到时间线）**、**R017（对外触达）**、**R019（限流）**。

---

## 3. 下一迭代建议（进化与真正帮人干活）

R011–R015、R018、R020–R022 已完成（查资料、X 主脑、定时/事件/待办、失败重试、Python、桌面小程序、**多媒体资源生成**）。当前推荐开发顺序如下：

| 顺序 | 需求 | 目标 |
|------|------|------|
| **1** | **R023** 小程序与小游戏创作增强 | 强化 X 做小程序/小游戏的能力：资源约定、主脑指引，使 X 能产出**可玩小游戏**与更复杂小程序。详见 MINIAPP_GAME_PLAN.md。 |
| **2** | **R008** 测试覆盖补全 | 关键 API（聊天/图片/会话）、记忆召回与捕获、LEARNED_PROMPT 链路有测试，**稳**。 |
| **3** | **R016** X 创建/更新系统任务 | X 通过工具创建任务进任务时间线，用户可见、可审批或自动执行，与沙箱 x-tasks.md 协同，**派活到时间线**。 |

简要说明：

- **R023**：用户希望「强化小程序和小游戏创造能力」。实现要点：① 资源目录约定（apps/&lt;id&gt;/assets/ 放图片/音效/BGM），与 llm.generate_image、llm.generate_sound_effect、llm.generate_music 配合；② 在主脑（x_direct）或系统提示中注入「如何做小游戏」的指引（plan.md 必含：游戏类型、玩法、资源清单、canvas/游戏循环要点）。明显提升「X 能做小游戏」的体验。
- **R007**：已完成。发现 SKILL.md、注册到能力列表、主脑可见、skill.load 加载内容；R031 补充自安装/删除/SkillHub，形成「内置 + MCP + Skill」三源能力。
- **R008**：关键路径测试，`cd server && npm run test` 稳定通过。
- **R016**：与现有 createTask API 对接，ToolExecutor 暴露 task.create 类工具。

**面向「完全自主」的后续可选**（见 §2.1）：R016（创建系统任务）、R017（对外触达）、R019（限流）。

**已完成**：R020（Python）、R021（桌面小程序）、**R022（多媒体资源）**——设置→多媒体、llm.generate_sound_effect/music（均使用 fal.ai）；**R031（Skills 自安装与删除）**——skill.install、skill.uninstall、skill.list_remote、configFields、设置页配置与删除；**R032（流式与 Markdown 表格）**——X/AI 助手对话流式输出、remark-gfm 表格渲染。

---

## 4. 需求录入模板（供 AI 参考）

新增行时请保持列一致，并遵循：

- **ID**：R + 三位数字，与已有 ID 不重复。
- **需求描述**：一句话概括；复杂需求可在备注中写「详见 xxx.md」。
- **状态**：待开发 / 开发中 / 已完成。
- **优先级**：P0 / P1 / P2 / P3。
- **创建日期**：YYYY-MM-DD。
- **完成/更新**：完成时填日期，否则 `—`。
- **备注/关联**：依赖文档、子任务、测试要求等。

---

## 5. 与开发文档的关系

- **DEVELOPMENT.md**：当前版本、架构、模块清单、API/WS 等「现状」描述。
- **DEV_PLAN_OPENCLAW_OPENCODE.md**：按阶段的开发计划与任务列表（可与需求表 ID 交叉引用）。
- **本需求表**：所有需求的单一来源，按状态与优先级驱动「接下来做什么」。

需求实现后，若涉及接口或行为变更，需同步更新 DEVELOPMENT.md 的 API 参考、WebSocket 协议或相关章节（见 DEVELOPMENT 约定）。
