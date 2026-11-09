# X 包模型（一期）与工具执行流水线

更新：2026-11-09。设计来源与对照见 `docs/ARCHITECTURE_PLUGIN_CORE.md` 的「后续阶段」，本页记录已落地的部分。

## 工具执行流水线

所有工具调用（网页聊天、QQ 等渠道、定时任务、子代理、审批后重放）都经过 `server/src/orchestrator/pipeline/`：

```
pre-execute 策略 → 审计 action 行（执行前写入，带 initiator）→ 包装执行（超时…）→ 工具体 → post hooks → 审计 result / error 行
```

- 策略：`scopePolicy`（本轮 allowed/blocked 列表）、`permissionPolicy`（`requiredPermissions` 须包含于 `grantedPermissions`，未声明授权时不生效）。
- 包装：`timeout`，默认 10 分钟，`LONG_RUNNING_TOOLS` 豁免。
- 审计行 `metadata.initiator` 为 `user | agent | channel | scheduled | system`，由 `ExecutionContext.initiator` 显式给出，否则按 `agentId`、渠道消息推断。
- 被拒绝的调用抛 `ToolDeniedError`，`ToolExecutor.execute` 把它转成 `call.error`，模型会看到拒绝原因。
- 接入点：`AgentOrchestrator` 构造时 `executor.setPipeline(createDefaultToolPipeline({ audit }))`；审计仍走现有 `AuditLogger` 与 `audit_log` 表。

## 包清单 `apps/<id>/x-package.json`

类型见 `shared/src/index.ts` 的 `XPackageManifest`，校验见 `server/src/packages/manifest.ts`。

```jsonc
{
  "format": 1,
  "id": "counter",
  "name": "计数器",
  "version": "0.1.0",
  "kinds": ["ui"],
  "ui": { "entry": "index.html" },
  "permissions": ["kv"],
  "startupPolicy": "on-demand"
}
```

- `kinds`：`ui`（有界面）、`tools`（给模型新增工具，只允许 `kv / http / mcp / script` 声明式实现，不加载宿主代码）、`skill`。
- `permissions` 只接受已知权限名：`kv queue broadcast notify llm scheduler fs.read fs.write network mcp script`，`network:` 与 `fs.read:` 可带作用域后缀。
- 工具名不得使用系统保留前缀（`x.`、`file.`、`shell.` 等）。

## 注册表 `x_packages`

`server/src/packages/PackageRegistry.ts`，主键 `(user_id, pkg_id)`，字段 `manifest_json, enabled, source, path, installed_at, updated_at`。

- `install` 校验后 upsert，重装保留用户的启停选择；`setEnabled` 不删数据；`remove` 只删登记并同步剔除旧 `x_mini_apps` 条目，源码与 `app_source_versions` 快照保留。
- `migrateMiniApps(userId, sandbox)`：把旧 `x_mini_apps` 里尚未登记的应用写入表，并在应用目录写出默认清单；模型已写好且 id 一致的清单优先。`GET /api/apps`、`GET /api/packages`、`x.list_apps` 读取前都会先迁移一次。
- `x.create_app` 在登记应用后同时写清单并 `install`；旧的 `x_mini_apps` 仍由 `AppVersionStore.register` 维护以兼容版本恢复。

## 接口

- `GET /api/packages` → `{ packages: XPackageRecord[], builtin: ServerPluginManifest[] }`（内置服务端插件只读）。
- `POST /api/packages/:id/enabled` `{ enabled: boolean }`。
- `DELETE /api/packages/:id`。

## 二期待办

- `tools` 类包：由注册表在用户 scope 动态注册工具，`requiredPermissions` 取自清单，经流水线的 `permissionPolicy` 把关。
- 空间内分享（`source: 'space'`）与公共目录（`source: 'catalog'`，索引格式参考 dsh plugin-market）。
- 前端插件中心改读 `/api/packages`；内置插件启停持久化到表。
