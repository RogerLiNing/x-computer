# 服务器管理快速开始

## 5 分钟上手

### 1. 添加服务器

```javascript
// 方式 1：密码认证（简单但安全性较低）
await server.add({
  name: "生产服务器",
  host: "192.168.1.100",
  port: 22,
  username: "root",
  authType: "password",
  password: "your_password",
  tags: ["生产", "Web"]
});

// 方式 2：密钥认证（推荐）
await server.add({
  name: "开发服务器",
  host: "dev.example.com",
  port: 22,
  username: "ubuntu",
  authType: "privateKey",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
  tags: ["开发"]
});
```

### 2. 连接并执行命令

```javascript
// 列出所有服务器
const { servers } = await server.list();
const serverId = servers[0].serverId;

// 连接服务器
await server.connect({ serverId });

// 执行命令
await server.exec({
  serverId,
  command: "ls -la /var/www"
});

// 查看系统信息
await server.exec({
  serverId,
  command: "uname -a && df -h && free -h"
});
```

### 3. 文件传输

```javascript
// 上传文件
await server.upload({
  serverId,
  localPath: "/tmp/app.js",
  remotePath: "/var/www/app.js"
});

// 下载文件
await server.download({
  serverId,
  remotePath: "/var/log/app.log",
  localPath: "/tmp/app.log"
});
```

### 4. 部署应用（完整流程）

```javascript
// 1. 连接
await server.connect({ serverId });

// 2. 创建目录
await server.exec({
  serverId,
  command: "mkdir -p /var/www/myapp"
});

// 3. 上传文件
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
  command: "cd /var/www/myapp && npm install",
  timeout: 120000  // 2 分钟
});

// 5. 启动应用（后台运行）
await server.exec({
  serverId,
  command: "cd /var/www/myapp && nohup node app.js > /var/log/myapp.log 2>&1 &"
});

// 6. 验证
await server.exec({
  serverId,
  command: "ps aux | grep 'node app.js'"
});

// 7. 断开连接
await server.disconnect({ serverId });
```

## 常用命令

### 系统监控

```javascript
// CPU 和内存
await server.exec({
  serverId,
  command: "top -bn1 | head -n 20"
});

// 磁盘使用
await server.exec({
  serverId,
  command: "df -h"
});

// 网络连接
await server.exec({
  serverId,
  command: "netstat -tulpn"
});

// 查看日志
await server.exec({
  serverId,
  command: "tail -n 100 /var/log/syslog"
});
```

### 进程管理

```javascript
// 查看进程
await server.exec({
  serverId,
  command: "ps aux | grep node"
});

// 停止进程
await server.exec({
  serverId,
  command: "pkill -f 'node app.js'"
});

// 启动服务
await server.exec({
  serverId,
  command: "systemctl start nginx"
});

// 查看服务状态
await server.exec({
  serverId,
  command: "systemctl status nginx"
});
```

### 数据库操作

```javascript
// MySQL 备份
await server.exec({
  serverId,
  command: "mysqldump -u root -p'password' mydb > /tmp/backup.sql",
  timeout: 120000
});

// 下载备份
await server.download({
  serverId,
  remotePath: "/tmp/backup.sql",
  localPath: "/Users/me/backups/backup.sql"
});

// PostgreSQL 备份
await server.exec({
  serverId,
  command: "pg_dump -U postgres mydb > /tmp/backup.sql",
  timeout: 120000
});
```

## 最佳实践

### 1. 使用密钥认证

```javascript
// ✅ 推荐
await server.add({
  name: "生产服务器",
  host: "prod.example.com",
  username: "ubuntu",
  authType: "privateKey",
  privateKey: "...",
});

// ⚠️ 不推荐（安全性较低）
await server.add({
  name: "测试服务器",
  host: "test.example.com",
  username: "root",
  authType: "password",
  password: "password123",
});
```

### 2. 后台执行长时间命令

```javascript
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

```javascript
// 长时间运行的命令
await server.exec({
  serverId,
  command: "apt-get update && apt-get upgrade -y",
  timeout: 300000  // 5 分钟
});
```

### 4. 使用标签分类

```javascript
// 添加标签便于管理
await server.add({
  name: "Web服务器1",
  host: "web1.example.com",
  username: "ubuntu",
  authType: "privateKey",
  privateKey: "...",
  tags: ["生产", "Web", "前端"]
});
```

### 5. 测试连接后再使用

```javascript
// 添加服务器后先测试
const { serverId } = await server.add({...});

const testResult = await server.test({ serverId });

if (testResult.success) {
  console.log("连接成功，可以使用");
} else {
  console.error("连接失败:", testResult.message);
}
```

## 故障排除

### 连接超时

```
错误：连接失败: Timed out while waiting for handshake
```

**解决：**
- 检查服务器地址和端口是否正确
- 检查防火墙是否允许 SSH 连接
- 检查服务器是否在线

### 认证失败

```
错误：连接失败: All configured authentication methods failed
```

**解决：**
- 检查用户名是否正确
- 检查密码或私钥是否正确
- 检查私钥格式是否正确（PEM 格式）

### 命令超时

```
错误：命令超时 (30000ms): apt-get upgrade
```

**解决：**
- 增加 timeout 参数
- 使用后台执行（& 或 nohup）

## 更多信息

详细文档请参考：[SERVER_MANAGEMENT.md](./SERVER_MANAGEMENT.md)
