# 更新日志

## [Unreleased] — 2026-04-04

### 容器空闲超时

- **idleTimeout**：容器空闲超时（默认 5 分钟），超时后自动停止容器释放资源
- **maxIdleTime**：容器最大空闲时间（默认 24 小时），超时后自动删除容器
- 每次容器访问（getOrCreate/exec）记录活动时间戳，后台每 60 秒检查一次

### 系统邮件发送

- **sendSystemEmail()**：使用 `.x-config.json` 中 `email.smtp` 配置发送系统通知邮件（nodemailer + Markdown → HTML）
- **验证码邮件**：`/api/auth/send-verification-code` 现在真实发送邮件，不再仅开发模式打印
- **密码重置邮件**：`/api/auth/request-password-reset` 现在真实发送邮件
- 配置示例：`.x-config.example.json` 和 `docs/CONFIGURATION.md` 已更新

### 管理后台

- **Admin 应用**：用户管理、封禁/解封、套餐调整、统计概览（AI 调用量、会话数、活跃用户）
- **admin.emails**：`.x-config.json` 配置管理员邮箱列表，邮箱匹配不区分大小写
- 修复 aiCalls 返回 string 而非 number 的问题（SQLite COALESCE(SUM()) 返回字符串）

### 部署改进

- **deploy-multi.sh**：部署前自动 `fuser -k 4000/tcp` 清理残留进程，避免 EADDRINUSE
- **.gitignore**：加入 `users/` 目录（用户工作区数据）
- Docker 相关文件标记为待删除状态（docker-compose.yml, Dockerfile 等）

## [0.1.1] — 2026-02-24（邮件渠道增强）

### 邮件收信与双向沟通（R042 增强）

- **收件箱 DB 同步**：IMAP 拉取邮件写入 `emails` 表，前端/API 从 DB 读取，不直接调 IMAP
- **正文解析**：使用 mailparser 解析 multipart/HTML 邮件，正确提取 text/plain 与 text/html
- **email_received 信号**：payload 含 goal（发件人、主题、正文），intent 触发器将 goal 作为用户消息传给 X，X 可处理并回复
- **发件人过滤**：`email_from_filter` 配置 + `x.set_email_from_filter` / `x.list_email_from_filter`，仅处理指定发件人
- **API**：`GET /api/email/inbox` 从 DB 读取；`POST /api/email/sync` 手动触发同步

### 其他

- **发件 Markdown 转 HTML**：x.send_email 将 body 从 Markdown 转为 HTML 富文本发送
- **事件节流分渠道**：chat / task / email 各自 60s 节流，互不阻塞（邮件不再被聊天节流）
- 修复 IMAP sequence set 格式（`*:N` → `N:*`）避免 QQ 邮箱「Sequence set is invalid」
- 修复 systemCore 模板字符串内反引号导致的解析错误

---

## [0.1.0] — 2026-02-10（首个版本）

### 概述

X-Computer 首个可运行版本：Web 桌面 + AI 任务编排 + 沙箱文件/命令 + 双模式与审批，前后端打通，支持大模型配置与整机上下文感知。

### 前端

- **桌面**：窗口管理（拖拽、缩放、最小化/最大化）、任务栏、状态栏、通知中心、锁屏、⌘K 搜索、桌面右键菜单、全局快捷键（⌘W/⌘M/⌘T/⌘N/⌘L 等）
- **桌面图标**：6 列网格布局，支持拖拽排列，位置持久化到 localStorage
- **内置应用**：文件管理器、终端、AI 助手、任务时间线、代码/文本编辑器、浏览器、邮件、日历、表格、设置（共 11 个）
- **文件/终端/聊天/时间线**：对接后端 API，真实读写沙箱文件、执行命令、创建任务、审批步骤
- **系统设置**：大模型配置（多提供商、聊天/文本/视频/图像/向量模态、从 /models 导入、模型列表）、执行模式、安全/运行时/关于
- **状态与通信**：Zustand 统一状态，WebSocket 实时同步任务与模式，整机上下文上报（窗口/任务摘要等）供 AI 感知

### 后端

- **任务编排**：四域（chat/coding/agent/office）规划与执行、双模式（自动/审批）、审批通过后继续执行、非阻塞多任务（队列 + 最大并发 10）
- **策略与审计**：风险评分、审批门控、全链路审计（意图-动作-结果）
- **沙箱**：SandboxFS（list/read/write/mkdir/delete/rename/stat）、SandboxShell（超时与危险命令拦截）
- **API**：任务 CRUD、暂停/恢复、审批/拒绝、模式、工具、策略、运行时、审计、健康、整机上下文 GET、文件系统、Shell 执行
- **WebSocket**：init、task_event、mode_changed、task_created、audit_entry；客户端 create_task、set_mode、pause/resume、approve/reject、set_computer_context

### 共享与工程

- **shared**：统一类型（Task、TaskStep、ExecutionMode、ComputerContext、LLMSystemConfig 等）
- **测试**：server 端 Vitest + Supertest，37 个 REST API 用例（/api、/api/fs、/api/shell）；WebSocket 用例已编写默认 skip
- **文档**：README、docs/DEVELOPMENT.md（架构、API、数据模型、已实现/未实现、运行与测试说明）

### 已知限制

- SQLite 默认内存存储（可选切换 MySQL，连接失败时自动启动 Docker 容器）
- 无 OAuth 登录（Google/GitHub OAuth 占位符待实现）
- 无 Stripe 订阅集成（订阅 API 占位符待实现）
