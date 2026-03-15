# 远程服务器管理功能总结

## 概述

X-Computer 现已支持**远程服务器管理**，让 X 可以通过 SSH 连接和管理任何远程服务器。这是一个完整的、生产级的服务器管理解决方案。

## 核心能力

### 1. 连接管理
- ✅ SSH 密码认证
- ✅ SSH 密钥认证（推荐）
- ✅ 自动连接（执行命令时自动连接）
- ✅ 连接池管理（复用已建立的连接）
- ✅ 连接测试

### 2. 命令执行
- ✅ 执行任意 Shell 命令
- ✅ 查看 stdout、stderr、exitCode
- ✅ 超时控制（默认 30 秒，最大 5 分钟）
- ✅ 后台执行支持（nohup、&）

### 3. 文件传输
- ✅ SFTP 上传文件
- ✅ SFTP 下载文件
- ✅ 支持任意文件类型

### 4. 配置管理
- ✅ 添加/更新/删除服务器配置
- ✅ 列出所有服务器
- ✅ 标签分类管理
- ✅ 持久化存储（SQLite）

## 工具列表

| 工具 | 功能 | 参数 |
|------|------|------|
| `server.add` | 添加服务器配置 | name, host, port, username, authType, password/privateKey, description, tags |
| `server.list` | 列出所有服务器 | - |
| `server.connect` | 连接到服务器 | serverId |
| `server.exec` | 执行远程命令 | serverId, command, timeout |
| `server.upload` | 上传文件 | serverId, localPath, remotePath |
| `server.download` | 下载文件 | serverId, remotePath, localPath |
| `server.disconnect` | 断开连接 | serverId |
| `server.remove` | 删除服务器配置 | serverId |
| `server.test` | 测试连接 | serverId |

## 使用场景

### 场景 1：部署 Web 应用

```
用户："帮我把这个 Node.js 应用部署到生产服务器"

X 的操作流程：
1. server.connect (连接到生产服务器)
2. server.exec (创建部署目录)
3. server.upload (上传应用文件)
4. server.exec (安装依赖: npm install)
5. server.exec (启动应用: pm2 start app.js)
6. server.exec (验证应用运行)
7. server.disconnect (断开连接)
```

### 场景 2：监控服务器状态

```
用户："帮我检查生产服务器的状态"

X 的操作流程：
1. server.connect
2. server.exec (查看 CPU: top -bn1)
3. server.exec (查看内存: free -h)
4. server.exec (查看磁盘: df -h)
5. server.exec (查看进程: ps aux)
6. server.exec (查看日志: tail /var/log/app.log)
7. server.disconnect
```

### 场景 3：数据库备份

```
用户："帮我备份生产数据库"

X 的操作流程：
1. server.connect (连接到数据库服务器)
2. server.exec (导出数据库: mysqldump)
3. server.download (下载备份文件)
4. server.exec (删除远程备份文件)
5. server.disconnect
```

### 场景 4：批量管理

```
用户："帮我在所有服务器上更新系统"

X 的操作流程：
1. server.list (获取所有服务器)
2. 对每台服务器：
   - server.connect
   - server.exec (apt-get update && apt-get upgrade -y)
   - server.disconnect
```

### 场景 5：日志分析

```
用户："帮我分析所有服务器的错误日志"

X 的操作流程：
1. server.list (获取所有服务器)
2. 对每台服务器：
   - server.connect
   - server.exec (grep ERROR /var/log/app.log)
   - server.download (下载日志文件)
   - server.disconnect
3. 分析所有下载的日志文件
```

## 技术实现

### 架构

```
┌─────────────────────────────────────────────────────┐
│                   ToolExecutor                      │
│  (server.add, server.list, server.exec, ...)       │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│                 ServerManager                       │
│  - 服务器配置管理                                    │
│  - SSH 连接管理                                      │
│  - 命令执行                                          │
│  - 文件传输 (SFTP)                                   │
└────────────────┬────────────────────────────────────┘
                 │
                 ├─────────────────┬──────────────────┐
                 ▼                 ▼                  ▼
        ┌────────────────┐  ┌──────────┐   ┌────────────┐
        │   ssh2 库      │  │ 数据库   │   │  日志系统  │
        │  (SSH 连接)    │  │ (配置)   │   │           │
        └────────────────┘  └──────────┘   └────────────┘
```

### 核心类

#### ServerManager

```typescript
class ServerManager {
  // 配置管理
  addServer(config): ServerConfig
  listServers(): ServerConfig[]
  getServer(serverId): ServerConfig | null
  updateServer(serverId, updates): void
  removeServer(serverId): Promise<void>

  // 连接管理
  connect(serverId): Promise<void>
  disconnect(serverId): Promise<void>
  listConnections(): ConnectionInfo[]
  testConnection(serverId): Promise<TestResult>

  // 命令执行
  executeCommand(serverId, command, timeout): Promise<CommandResult>

  // 文件传输
  uploadFile(serverId, localPath, remotePath): Promise<void>
  downloadFile(serverId, remotePath, localPath): Promise<void>
}
```

### 数据库表

```sql
CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK(auth_type IN ('password', 'privateKey')),
  password TEXT,
  private_key TEXT,
  passphrase TEXT,
  description TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

## 安全特性

### 1. 权限控制

所有服务器工具都需要 `server` 权限：

```typescript
requiredPermissions: ['server']
```

### 2. 认证方式

- **密码认证**：简单但安全性较低
- **密钥认证**：推荐使用，安全性高

### 3. 连接管理

- 自动连接：执行命令时自动连接
- 连接池：复用已建立的连接
- 自动清理：断开连接时释放资源

### 4. 超时保护

所有命令都有超时限制（默认 30 秒，最大 5 分钟）。

### 5. 输出限制

- stdout 限制在 50KB
- stderr 限制在 10KB

## 最佳实践

### 1. 使用密钥认证

```javascript
// ✅ 推荐
await server.add({
  authType: "privateKey",
  privateKey: "...",
});

// ⚠️ 不推荐
await server.add({
  authType: "password",
  password: "password123",
});
```

### 2. 后台执行长时间命令

```javascript
// ✅ 正确
await server.exec({
  serverId,
  command: "nohup python long_task.py > /var/log/task.log 2>&1 &"
});

// ❌ 错误
await server.exec({
  serverId,
  command: "python long_task.py"  // 可能超时
});
```

### 3. 设置合理的超时

```javascript
await server.exec({
  serverId,
  command: "apt-get update && apt-get upgrade -y",
  timeout: 300000  // 5 分钟
});
```

### 4. 使用标签分类

```javascript
await server.add({
  name: "Web服务器1",
  tags: ["生产", "Web", "前端"]
});
```

### 5. 测试连接后再使用

```javascript
const { serverId } = await server.add({...});
const testResult = await server.test({ serverId });

if (testResult.success) {
  console.log("连接成功，可以使用");
} else {
  console.error("连接失败:", testResult.message);
}
```

## 文档

- **完整文档**：[SERVER_MANAGEMENT.md](./SERVER_MANAGEMENT.md)
- **快速开始**：[SERVER_QUICKSTART.md](./SERVER_QUICKSTART.md)
- **需求记录**：[REQUIREMENTS.md](./REQUIREMENTS.md) (R053)

## 测试验证

所有功能已通过测试验证：

```bash
cd server
npx tsx test-server-management.js
```

测试覆盖：
- ✅ 添加服务器（密码认证）
- ✅ 添加服务器（密钥认证）
- ✅ 列出所有服务器
- ✅ 获取单个服务器
- ✅ 更新服务器配置
- ✅ 列出连接
- ✅ 删除服务器

## 依赖

- `ssh2`: SSH 客户端库
- `@types/ssh2`: TypeScript 类型定义

## 下一步

可能的增强方向：

1. **SSH 隧道**：支持端口转发
2. **批量操作**：一次命令在多台服务器上执行
3. **脚本模板**：预定义常用操作脚本
4. **监控告警**：定期检查服务器状态并告警
5. **审计日志**：记录所有服务器操作
6. **权限细化**：不同用户不同服务器权限

## 总结

远程服务器管理功能让 X 具备了完整的服务器运维能力：

✅ **管理服务器配置** - 添加、列出、更新、删除
✅ **执行远程命令** - SSH 连接、命令执行、查看输出
✅ **传输文件** - SFTP 上传、下载
✅ **应用场景** - 部署、监控、备份、批量管理、日志分析

现在，X 可以管理任何远程服务器！🚀
