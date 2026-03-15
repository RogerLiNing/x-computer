# Admin 管理角色与全局管理设计

**需求**：X-Computer 新增 admin，用于管理注册用户和全局管理。  
**关联需求**：R069（Admin 角色与鉴权）、R059（管理后台功能）

---

## 1. 概述

- **Admin 角色**：具备管理员权限的注册用户，可访问 `/api/admin/*` 接口和 Admin 应用。
- **能力范围**：用户管理（列表、搜索、封禁/解封）、全局配置（如 allowRegister）、系统概览（用户数、调用量等）。
- **设计原则**：配置驱动、最小权限、与 R059 管理后台对接。

---

## 2. Admin 身份识别

### 2.1 方案：配置指定 Admin 邮箱

不引入 `users.role` 字段，优先使用配置白名单，部署简单：

```json
// .x-config.json 或环境变量
{
  "admin": {
    "emails": ["admin@example.com", "ops@company.com"]
  }
}
```

- 登录后，后端通过 `auth_accounts.email` 查 user_id，再判断该 email 是否在 `admin.emails` 中。
- 优点：无需改库表，配置即可生效。
- 备选：`X_COMPUTER_ADMIN_EMAILS=admin@a.com,admin@b.com` 环境变量。

### 2.2 可选扩展：users 表 role 字段

若需更细粒度权限，可在 `users` 表增加 `role TEXT DEFAULT 'user'`：

- `admin`：管理员
- `user`：普通用户（默认）

迁移时可为指定 user_id 设置 `role='admin'`，同时保留配置白名单作为兼容。

---

## 3. 后端实现要点

### 3.1 Admin 鉴权

```ts
// server/src/middleware/requireAdmin.ts
export function requireAdmin(getAdminEmails: () => string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    if (!userId || userId === 'anonymous') {
      return res.status(401).json({ error: '请先登录' });
    }
    const email = await db.getEmailByUserId(userId);
    const admins = getAdminEmails();
    if (!email || !admins.includes(email.toLowerCase())) {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
  };
}
```

- `getAdminEmails` 从 config 读取 `admin.emails`。
- 需在 database 中增加 `getEmailByUserId(userId)`（或通过 `auth_accounts` 查询）。

### 3.2 Admin API 路由

挂载在 `/api/admin/` 下，全部经 `requireAdmin` 保护：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users | 用户列表（分页、搜索） |
| GET | /api/admin/users/:id | 用户详情 |
| POST | /api/admin/users/:id/ban | 封禁用户 |
| POST | /api/admin/users/:id/unban | 解封用户 |
| GET | /api/admin/stats | 系统概览（用户数、任务数、调用量等） |
| GET | /api/admin/config | 全局配置（只读，如 allowRegister） |
| PUT | /api/admin/config | 更新全局配置（需谨慎，如 allowRegister） |

先实现用户管理与 stats，config 可后续补充。

### 3.3 数据库与接口

- `auth_accounts` 已有 `(email, user_id)`，可反向查 `getEmailByUserId`。
- `users` 表若有 `banned_at` 或 `status`，可支持封禁；否则用 `user_config` 存 `banned: "1"` 等。
- 新增 `db.listUsers(options)`, `db.banUser(userId)`, `db.unbanUser(userId)` 等（按当前 DB 抽象封装）。

---

## 4. 前端实现

### 4.1 Admin 应用

- 新增 `AdminApp`，桌面入口仅对 admin 可见。
- 或通过 `/admin` 路由访问：非 admin 重定向到首页并提示无权限。
- 在 `appRegistry` 中注册 Admin 应用，通过 `api.adminCheck()` 或用户角色判断是否展示。

### 4.2 功能区块（与 R059 对齐）

1. **用户管理**：列表、搜索、查看详情、封禁/解封。
2. **系统概览**：总用户数、今日/本周活跃、任务数、AI 调用量（若有统计）。
3. **全局配置**（可选）：allowRegister、公告等，可读可改。

---

## 5. 配置示例

```json
// server/.x-config.json
{
  "admin": {
    "emails": ["admin@yourcompany.com"]
  },
  "auth": {
    "allowRegister": true
  }
}
```

```bash
# 或环境变量
export X_COMPUTER_ADMIN_EMAILS="admin@a.com,admin@b.com"
```

---

## 6. 与 R059 的关系

- **R069**：Admin 角色识别 + 鉴权中间件 + `/api/admin/*` 骨架 + `AdminApp` 入口。
- **R059**：在 R069 基础上实现完整管理后台（订阅管理、系统监控、内容管理等）。

建议先完成 R069，再扩展 R059。
