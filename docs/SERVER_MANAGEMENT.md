# 远程服务器管理

## 概述

X-Computer 现在支持**远程服务器管理**，让 X 可以通过 SSH 连接和管理远程服务器。

## 功能列表

### 1. 服务器配置管理
- 添加服务器配置
- 列出所有服务器
- 更新服务器配置
- 删除服务器配置
- 测试连接

### 2. SSH 连接
- 自动连接管理
- 密码认证
- 密钥认证
- 连接池管理

### 3. 命令执行
- 执行远程命令
- 查看输出（stdout、stderr）
- 获取退出码
- 超时控制

### 4. 文件传输
- 上传文件（SFTP）
- 下载文件（SFTP）

## 工具列表

### 1. `server.add` - 添加服务器

添加远程服务器配置。

**参数：**
- `name` (string, 必需): 服务器名称（如 "生产服务器"）
- `host` (string, 必需): 服务器地址（IP 或域名）
- `port` (number, 可选): SSH 端口（默认 22）
- `username` (string, 必需): 用户名
- `authType` (string, 必需): 认证方式（"password" 或 "privateKey"）
- `password` (string, 可选): 密码（authType 为 password 时必需）
- `privateKey` (string, 可选): 私钥内容（authType 为 privateKey 时必需）
- `passphrase` (string, 可选): 私钥密码
- `description` (string, 可选): 服务器描述
- `tags` (array, 可选): 标签数组（如 ["生产", "Web服务器"]）

**返回：**
```json
{
  "serverId": "srv_1234567890_abc123",
  "name": "生产服务器",
  "host": "192.168.1.100",
  "port": 22,
  "username": "root",
  "message": "服务器已添加: 生产服务器 (192.168.1.100)"
}
```

### 2. `server.list` - 列出服务器

列出所有已配置的远程服务器。

**返回：**
```json
{
  "count": 2,
  "servers": [
    {
      "serverId": "srv_1234567890_abc123",
      "name": "生产服务器",
      "host": "192.168.1.100",
      "port": 22,
      "username": "root",
      "authType": "password",
      "description": "主要 Web 服务器",
      "tags": ["生产", "Web"],
      "createdAt": "2024-01-01T12:00:00.000Z"
    }
  ]
}
```

### 3. `server.connect` - 连接服务器

连接到远程服务器。连接后可使用 `server.exec` 执行命令。

**参数：**
- `serverId` (string, 必需): 服务器 ID

**返回：**
```json
{
  "serverId": "srv_1234567890_abc123",
  "name": "生产服务器",
  "host": "192.168.1.100",
  "message": "已连接到服务器: 生产服务器 (192.168.1.100)"
}
```

### 4. `server.exec` - 执行命令

在远程服务器上执行命令。

**参数：**
- `serverId` (string, 必需): 服务器 ID
- `command` (string, 必需): 要执行的命令
- `timeout` (number, 可选): 超时毫秒数（默认 30000）

**返回：**
```json
{
  "command": "ls -la /var/www",
  "stdout": "total 12\ndrwxr-xr-x 3 www-data www-data 4096 ...",
  "stderr": "",
  "exitCode": 0,
  "duration": 123,
  "success": true
}
```

### 5. `server.upload` - 上传文件

通过 SFTP 上传文件到远程服务器。

**参数：**
- `serverId` (string, 必需): 服务器 ID
- `localPath` (string, 必需): 本地文件路径
- `remotePath` (string, 必需): 远程文件路径

**返回：**
```json
{
  "serverId": "srv_1234567890_abc123",
  "localPath": "/tmp/app.js",
  "remotePath": "/var/www/app.js",
  "message": "文件已上传: /tmp/app.js -> /var/www/app.js"
}
```

### 6. `server.download` - 下载文件

通过 SFTP 从远程服务器下载文件。

**参数：**
- `serverId` (string, 必需): 服务器 ID
- `remotePath` (string, 必需): 远程文件路径
- `localPath` (string, 必需): 本地文件路径

**返回：**
```json
{
  "serverId": "srv_1234567890_abc123",
  "remotePath": "/var/log/app.log",
  "localPath": "/tmp/app.log",
  "message": "文件已下载: /var/log/app.log -> /tmp/app.log"
}
```

### 7. `server.disconnect` - 断开连接

断开与远程服务器的连接。

**参数：**
- `serverId` (string, 必需): 服务器 ID

**返回：**
```json
{
  "serverId": "srv_1234567890_abc123",
  "message": "连接已断开"
}
```

### 8. `server.remove` - 删除服务器

删除服务器配置。会先断开连接，然后删除配置。

**参数：**
- `serverId` (string, 必需): 服务器 ID

**返回：**
```json
{
  "serverId": "srv_1234567890_abc123",
  "message": "服务器已删除"
}
```

### 9. `server.test` - 测试连接

测试与远程服务器的连接。

**参数：**
- `serverId` (string, 必需): 服务器 ID

**返回：**
```json
{
  "serverId": "srv_1234567890_abc123",
  "success": true,
  "message": "连接成功",
  "duration": 456
}
```

## 使用示例

### 示例 1：添加服务器并执行命令

```typescript
// 1. 添加服务器（密码认证）
const result = await server.add({
  name: "生产服务器",
  host: "192.168.1.100",
  port: 22,
  username: "root",
  authType: "password",
  password: "your_password",
  description: "主要 Web 服务器",
  tags: ["生产", "Web"]
});

const serverId = result.serverId;

// 2. 测试连接
await server.test({ serverId });

// 3. 连接服务器
await server.connect({ serverId });

// 4. 执行命令
await server.exec({
  serverId,
  command: "ls -la /var/www"
});

// 5. 查看系统信息
await server.exec({
  serverId,
  command: "uname -a"
});

// 6. 查看磁盘使用
await server.exec({
  serverId,
  command: "df -h"
});

// 7. 断开连接
await server.disconnect({ serverId });
```

### 示例 2：使用密钥认证

```typescript
// 读取私钥文件
const privateKey = await file.read({
  path: "/Users/me/.ssh/id_rsa"
});

// 添加服务器（密钥认证）
const result = await server.add({
  name: "开发服务器",
  host: "dev.example.com",
  port: 22,
  username: "ubuntu",
  authType: "privateKey",
  privateKey: privateKey,
  description: "开发环境",
  tags: ["开发", "测试"]
});
```

### 示例 3：部署应用

```typescript
// 1. 连接服务器
await server.connect({ serverId });

// 2. 创建部署目录
await server.exec({
  serverId,
  command: "mkdir -p /var/www/myapp"
});

// 3. 上传应用文件
await server.upload({
  serverId,
  localPath: "/tmp/app.js",
  remotePath: "/var/www/myapp/app.js"
});

await server.upload({
  serverId,
  localPath: "/tmp/package.json",
  remotePath: "/var/www/myapp/package.json"
});

// 4. 安装依赖
await server.exec({
  serverId,
  command: "cd /var/www/myapp && npm install"
});

// 5. 启动应用（后台）
await server.exec({
  serverId,
  command: "cd /var/www/myapp && nohup node app.js > /var/log/myapp.log 2>&1 &"
});

// 6. 验证应用运行
await server.exec({
  serverId,
  command: "ps aux | grep 'node app.js'"
});

// 7. 断开连接
await server.disconnect({ serverId });
```

### 示例 4：监控服务器

```typescript
// 连接服务器
await server.connect({ serverId });

// 查看 CPU 使用
await server.exec({
  serverId,
  command: "top -bn1 | head -n 20"
});

// 查看内存使用
await server.exec({
  serverId,
  command: "free -h"
});

// 查看磁盘使用
await server.exec({
  serverId,
  command: "df -h"
});

// 查看网络连接
await server.exec({
  serverId,
  command: "netstat -tulpn"
});

// 查看日志
await server.exec({
  serverId,
  command: "tail -n 100 /var/log/syslog"
});

await server.disconnect({ serverId });
```

### 示例 5：数据库备份

```typescript
// 连接服务器
await server.connect({ serverId });

// 备份 MySQL 数据库
await server.exec({
  serverId,
  command: "mysqldump -u root -p'password' mydb > /tmp/backup.sql",
  timeout: 120000  // 2 分钟
});

// 下载备份文件
await server.download({
  serverId,
  remotePath: "/tmp/backup.sql",
  localPath: "/Users/me/backups/backup.sql"
});

// 删除远程备份文件
await server.exec({
  serverId,
  command: "rm /tmp/backup.sql"
});

await server.disconnect({ serverId });
```

### 示例 6：批量管理多台服务器

```typescript
// 列出所有服务器
const { servers } = await server.list();

// 在所有服务器上执行命令
for (const srv of servers) {
  console.log(`检查服务器: ${srv.name}`);
  
  await server.connect({ serverId: srv.serverId });
  
  const result = await server.exec({
    serverId: srv.serverId,
    command: "df -h | grep '/$'"
  });
  
  console.log(`${srv.name} 磁盘使用: ${result.stdout}`);
  
  await server.disconnect({ serverId: srv.serverId });
}
```

## 安全特性

### 1. 权限控制

所有服务器工具都需要 `server` 权限：

```typescript
requiredPermissions: ['server']
```

### 2. 认证方式

支持两种认证方式：
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

```typescript
// ✅ 推荐：使用密钥认证
await server.add({
  name: "生产服务器",
  host: "prod.example.com",
  username: "ubuntu",
  authType: "privateKey",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\n...",
});

// ⚠️ 不推荐：使用密码认证（安全性较低）
await server.add({
  name: "测试服务器",
  host: "test.example.com",
  username: "root",
  authType: "password",
  password: "password123",
});
```

### 2. 后台执行长时间命令

```typescript
// ✅ 正确：使用后台执行
await server.exec({
  serverId,
  command: "nohup python long_task.py > /var/log/task.log 2>&1 &"
});

// ❌ 错误：前台执行（会超时）
await server.exec({
  serverId,
  command: "python long_task.py"  // 可能超时
});
```

### 3. 设置合理的超时

```typescript
// 长时间运行的命令
await server.exec({
  serverId,
  command: "apt-get update && apt-get upgrade -y",
  timeout: 300000  // 5 分钟
});
```

### 4. 使用标签分类

```typescript
// 添加标签便于管理
await server.add({
  name: "Web服务器1",
  host: "web1.example.com",
  username: "ubuntu",
  authType: "privateKey",
  privateKey: "...",
  tags: ["生产", "Web", "前端"]
});

await server.add({
  name: "数据库服务器",
  host: "db.example.com",
  username: "ubuntu",
  authType: "privateKey",
  privateKey: "...",
  tags: ["生产", "数据库", "MySQL"]
});
```

### 5. 测试连接后再使用

```typescript
// 添加服务器后先测试
const { serverId } = await server.add({...});

const testResult = await server.test({ serverId });

if (testResult.success) {
  console.log("连接成功，可以使用");
} else {
  console.error("连接失败:", testResult.message);
}
```

## 使用场景

### 场景 1：部署 Web 应用

```
用户：帮我把这个 Node.js 应用部署到生产服务器

AI：
1. server.connect (serverId: "prod-server")
2. server.exec (command: "mkdir -p /var/www/myapp")
3. server.upload (localPath: "/tmp/app.js", remotePath: "/var/www/myapp/app.js")
4. server.upload (localPath: "/tmp/package.json", remotePath: "/var/www/myapp/package.json")
5. server.exec (command: "cd /var/www/myapp && npm install")
6. server.exec (command: "cd /var/www/myapp && pm2 start app.js")
7. server.disconnect (serverId: "prod-server")
```

### 场景 2：监控服务器

```
用户：帮我检查生产服务器的状态

AI：
1. server.connect (serverId: "prod-server")
2. server.exec (command: "uptime")
3. server.exec (command: "free -h")
4. server.exec (command: "df -h")
5. server.exec (command: "ps aux | grep node")
6. server.exec (command: "tail -n 50 /var/log/app.log")
7. server.disconnect (serverId: "prod-server")
```

### 场景 3：数据库备份

```
用户：帮我备份生产数据库

AI：
1. server.connect (serverId: "db-server")
2. server.exec (command: "mysqldump -u root -p'password' mydb > /tmp/backup.sql")
3. server.download (remotePath: "/tmp/backup.sql", localPath: "/Users/me/backups/backup.sql")
4. server.exec (command: "rm /tmp/backup.sql")
5. server.disconnect (serverId: "db-server")
```

### 场景 4：批量更新

```
用户：帮我在所有服务器上更新系统

AI：
1. server.list
2. 对每台服务器：
   - server.connect
   - server.exec (command: "apt-get update && apt-get upgrade -y")
   - server.disconnect
```

### 场景 5：日志分析

```
用户：帮我分析所有服务器的错误日志

AI：
1. server.list
2. 对每台服务器：
   - server.connect
   - server.exec (command: "grep ERROR /var/log/app.log | tail -n 50")
   - server.download (remotePath: "/var/log/app.log", localPath: "/tmp/logs/server-{name}.log")
   - server.disconnect
3. 分析所有下载的日志文件
```

## 与 Docker 的配合

### 示例：在远程服务器上管理 Docker

```typescript
// 1. 连接服务器
await server.connect({ serverId });

// 2. 检查 Docker 状态
await server.exec({
  serverId,
  command: "docker ps"
});

// 3. 拉取镜像
await server.exec({
  serverId,
  command: "docker pull node:20"
});

// 4. 运行容器
await server.exec({
  serverId,
  command: "docker run -d --name myapp -p 3000:3000 node:20"
});

// 5. 查看容器日志
await server.exec({
  serverId,
  command: "docker logs myapp"
});

// 6. 断开连接
await server.disconnect({ serverId });
```

## 故障排除

### 问题 1：连接超时

```
错误：连接失败: Timed out while waiting for handshake
```

**解决：**
- 检查服务器地址和端口是否正确
- 检查防火墙是否允许 SSH 连接
- 检查服务器是否在线

### 问题 2：认证失败

```
错误：连接失败: All configured authentication methods failed
```

**解决：**
- 检查用户名是否正确
- 检查密码或私钥是否正确
- 检查私钥格式是否正确（PEM 格式）

### 问题 3：命令超时

```
错误：命令超时 (30000ms): apt-get upgrade
```

**解决：**
- 增加 timeout 参数
- 使用后台执行（& 或 nohup）

### 问题 4：文件传输失败

```
错误：上传失败: No such file
```

**解决：**
- 检查本地文件路径是否存在
- 检查远程目录是否存在
- 检查文件权限

## 安全建议

### 1. 使用密钥认证

密钥认证比密码认证更安全。

### 2. 限制用户权限

不要使用 root 用户，使用普通用户 + sudo。

### 3. 定期更新密钥

定期更换 SSH 密钥，提高安全性。

### 4. 使用防火墙

只允许特定 IP 访问 SSH 端口。

### 5. 监控连接日志

定期检查 SSH 连接日志，发现异常及时处理。

## 总结

远程服务器管理功能让 X 可以：

✅ **管理服务器配置**
- 添加、列出、更新、删除服务器
- 支持密码和密钥认证
- 标签分类管理

✅ **执行远程命令**
- SSH 连接
- 命令执行
- 查看输出和退出码

✅ **传输文件**
- SFTP 上传
- SFTP 下载

✅ **应用场景**
- 部署应用
- 监控服务器
- 数据库备份
- 批量管理
- 日志分析

现在，X 可以管理任何远程服务器！🚀
