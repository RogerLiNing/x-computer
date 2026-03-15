# Docker 持久化容器使用指南

## 🎯 两种运行模式

### 模式 1: 前台模式（一次性任务）

**特点**：
- 执行完成后自动删除
- 返回完整的执行结果
- 适合代码执行、数据处理等

**使用方式**：
```typescript
docker.run({
  image: "python:3.11",
  script: "print('Hello')",
  detach: false  // 默认
})

// 返回：
{
  mode: "executed",
  exitCode: 0,
  stdout: "Hello\n",
  stderr: "",
  duration: 1234
}
```

### 模式 2: 后台模式（持久化容器）⭐

**特点**：
- 容器持续运行
- 可以后续管理和交互
- 适合 Web 服务、数据库、开发环境等

**使用方式**：
```typescript
docker.run({
  image: "nginx:alpine",
  name: "my-nginx",
  ports: { "80": "8080" },
  detach: true  // 后台运行
})

// 返回：
{
  mode: "detached",
  containerId: "abc123",
  name: "my-nginx",
  status: "running",
  message: "容器已在后台运行"
}
```

## 💡 后台容器的完整工作流

### 示例 1: Web 服务器

```
步骤 1: 启动 Nginx
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.run({
  image: "nginx:alpine",
  name: "web-server",
  ports: { "80": "8080" },
  volumes: { "/path/to/html": "/usr/share/nginx/html" },
  detach: true
})

返回：容器 web-server 已启动，访问 http://localhost:8080

步骤 2: 查看容器状态
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.list({ all: false })

返回：
- web-server (nginx:alpine) - 运行中

步骤 3: 查看日志
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.logs({
  container: "web-server",
  tail: 20
})

返回：最近 20 行日志...

步骤 4: 在容器内执行命令
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.exec({
  container: "web-server",
  script: "nginx -s reload"
})

返回：Nginx 已重载配置

步骤 5: 停止容器
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.stop({
  container: "web-server",
  remove: true
})

返回：容器已停止并删除
```

### 示例 2: 数据库服务

```
步骤 1: 启动 MySQL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.run({
  image: "mysql:8",
  name: "my-database",
  env: {
    "MYSQL_ROOT_PASSWORD": "rootpass",
    "MYSQL_DATABASE": "myapp",
    "MYSQL_USER": "appuser",
    "MYSQL_PASSWORD": "apppass"
  },
  ports: { "3306": "3306" },
  detach: true
})

返回：MySQL 数据库已启动

步骤 2: 等待数据库就绪
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
sleep(10000)  // 等待 10 秒

步骤 3: 测试连接
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.exec({
  container: "my-database",
  script: "mysql -uroot -prootpass -e 'SHOW DATABASES;'"
})

返回：数据库列表...

步骤 4: 创建表
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.exec({
  container: "my-database",
  script: `
mysql -uroot -prootpass myapp << 'EOF'
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100),
  email VARCHAR(100)
);
EOF
  `
})

返回：表已创建

步骤 5: 插入数据
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.exec({
  container: "my-database",
  script: `
mysql -uroot -prootpass myapp << 'EOF'
INSERT INTO users (name, email) VALUES 
  ('Alice', 'alice@example.com'),
  ('Bob', 'bob@example.com');
EOF
  `
})

步骤 6: 查询数据
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.exec({
  container: "my-database",
  script: "mysql -uroot -prootpass myapp -e 'SELECT * FROM users;'"
})

返回：用户列表...
```

### 示例 3: 开发环境

```
步骤 1: 创建 Go 开发环境
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.run({
  image: "golang:1.21-alpine",
  name: "go-dev",
  script: "tail -f /dev/null",  // 保持运行
  volumes: { "/path/to/project": "/workspace" },
  workdir: "/workspace",
  detach: true
})

返回：Go 开发环境已就绪

步骤 2: 初始化项目
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.exec({
  container: "go-dev",
  script: "go mod init myapp"
})

步骤 3: 安装依赖
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.exec({
  container: "go-dev",
  script: "go get github.com/gin-gonic/gin"
})

步骤 4: 编译项目
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.exec({
  container: "go-dev",
  script: "go build -o app main.go"
})

步骤 5: 运行应用
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.exec({
  container: "go-dev",
  script: "./app"
})

步骤 6: 完成后清理
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.stop({
  container: "go-dev",
  remove: true
})
```

### 示例 4: 多容器应用（WordPress）

```
步骤 1: 启动 MySQL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.run({
  image: "mysql:8",
  name: "wordpress-db",
  env: {
    "MYSQL_ROOT_PASSWORD": "rootpass",
    "MYSQL_DATABASE": "wordpress",
    "MYSQL_USER": "wpuser",
    "MYSQL_PASSWORD": "wppass"
  },
  detach: true
})

步骤 2: 等待数据库就绪
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
sleep(15000)

步骤 3: 启动 WordPress
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.run({
  image: "wordpress:latest",
  name: "wordpress",
  env: {
    "WORDPRESS_DB_HOST": "wordpress-db:3306",
    "WORDPRESS_DB_USER": "wpuser",
    "WORDPRESS_DB_PASSWORD": "wppass",
    "WORDPRESS_DB_NAME": "wordpress"
  },
  ports: { "80": "8080" },
  detach: true
})

步骤 4: 查看日志确认启动
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.logs({
  container: "wordpress",
  tail: 30
})

步骤 5: 列出所有容器
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.list({ all: false })

返回：
- wordpress-db (mysql:8) - 运行中
- wordpress (wordpress:latest) - 运行中

完成！WordPress 已就绪，访问 http://localhost:8080
```

### 示例 5: 定时备份任务

```
步骤 1: 创建备份脚本
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
file.write({
  path: "/path/to/backup.sh",
  content: `#!/bin/sh
mysqldump -h mysql-host -u root -ppass mydb > /backups/backup-$(date +%Y%m%d-%H%M%S).sql
echo "Backup completed at $(date)"
  `
})

步骤 2: 启动定时任务容器
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.run({
  image: "alpine:latest",
  name: "backup-cron",
  script: `
    apk add --no-cache mysql-client dcron
    chmod +x /backup.sh
    echo "0 * * * * /backup.sh" > /etc/crontabs/root
    crond -f
  `,
  volumes: {
    "/path/to/backup.sh": "/backup.sh",
    "/path/to/backups": "/backups"
  },
  detach: true
})

返回：定时备份任务已启动，每小时自动备份一次

步骤 3: 查看备份日志
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker.logs({
  container: "backup-cron",
  tail: 50
})
```

## 🔄 容器持久化的关键

### 1. 使用 `detach: true`

```typescript
docker.run({
  image: "nginx:alpine",
  detach: true  // ← 关键参数
})
```

### 2. 给容器命名

```typescript
docker.run({
  image: "nginx:alpine",
  name: "my-nginx",  // ← 便于后续管理
  detach: true
})
```

### 3. 后续管理

```typescript
// 查看日志
docker.logs({ container: "my-nginx" })

// 执行命令
docker.exec({ 
  container: "my-nginx",
  script: "nginx -s reload"
})

// 停止容器
docker.stop({ container: "my-nginx" })
```

## 🎨 AI 对话示例

### 对话 1: 启动并管理服务

```
用户：启动一个 Redis 服务器

AI：好的，我来启动 Redis 容器。

[docker.run]
{
  image: "redis:alpine",
  name: "my-redis",
  ports: { "6379": "6379" },
  detach: true
}

AI：Redis 已启动！连接地址：localhost:6379

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：测试一下 Redis 是否正常

AI：好的，我来测试连接。

[docker.exec]
{
  container: "my-redis",
  script: "redis-cli ping"
}

AI：Redis 响应：PONG - 运行正常！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：在 Redis 中设置一个值

AI：好的。

[docker.exec]
{
  container: "my-redis",
  script: "redis-cli SET mykey 'Hello Redis'"
}

AI：已设置 mykey = 'Hello Redis'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：读取这个值

AI：好的。

[docker.exec]
{
  container: "my-redis",
  script: "redis-cli GET mykey"
}

AI：mykey 的值是：'Hello Redis'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：查看 Redis 日志

AI：好的。

[docker.logs]
{
  container: "my-redis",
  tail: 20
}

AI：最近 20 行日志：...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：停止 Redis

AI：好的，我来停止容器。

[docker.stop]
{
  container: "my-redis",
  remove: true
}

AI：Redis 已停止并删除。
```

### 对话 2: 开发环境

```
用户：给我创建一个 Node.js 开发环境

AI：好的，我来创建 Node.js 开发容器。

[docker.run]
{
  image: "node:20-alpine",
  name: "node-dev",
  script: "tail -f /dev/null",
  volumes: { "/Users/me/project": "/workspace" },
  workdir: "/workspace",
  detach: true
}

AI：Node.js 开发环境已就绪！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：安装依赖

AI：好的。

[docker.exec]
{
  container: "node-dev",
  script: "npm install"
}

AI：依赖已安装完成。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：启动开发服务器

AI：好的。

[docker.exec]
{
  container: "node-dev",
  script: "npm run dev &"
}

AI：开发服务器已启动！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：查看服务器日志

AI：好的。

[docker.logs]
{
  container: "node-dev",
  tail: 50
}

AI：服务器日志：...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

（几小时后...）

用户：我的开发环境还在吗？

AI：让我检查一下。

[docker.list]
{ all: false }

AI：是的！node-dev 容器还在运行中。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：在里面运行测试

AI：好的。

[docker.exec]
{
  container: "node-dev",
  script: "npm test"
}

AI：测试结果：...
```

### 对话 3: 多容器编排

```
用户：帮我搭建一个完整的开发环境：前端 + 后端 + 数据库

AI：好的，我来创建完整的开发环境。

[步骤 1: 启动 MySQL]
docker.run({
  image: "mysql:8",
  name: "dev-mysql",
  env: { ... },
  ports: { "3306": "3306" },
  detach: true
})

[步骤 2: 启动后端]
docker.run({
  image: "node:20-alpine",
  name: "dev-backend",
  script: "tail -f /dev/null",
  volumes: { "/path/to/backend": "/workspace" },
  ports: { "4000": "4000" },
  env: { "DB_HOST": "dev-mysql" },
  detach: true
})

[步骤 3: 启动前端]
docker.run({
  image: "node:20-alpine",
  name: "dev-frontend",
  script: "tail -f /dev/null",
  volumes: { "/path/to/frontend": "/workspace" },
  ports: { "3000": "3000" },
  detach: true
})

AI：开发环境已搭建完成！
- MySQL: localhost:3306
- 后端: localhost:4000
- 前端: localhost:3000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：启动后端服务

AI：好的。

[docker.exec]
{
  container: "dev-backend",
  script: "npm install && npm run dev &"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：启动前端服务

AI：好的。

[docker.exec]
{
  container: "dev-frontend",
  script: "npm install && npm run dev &"
}

AI：所有服务已启动！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：查看所有容器

AI：好的。

[docker.list]
{ all: false }

AI：当前运行的容器：
1. dev-mysql (mysql:8)
2. dev-backend (node:20-alpine)
3. dev-frontend (node:20-alpine)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

（开发完成后）

用户：清理所有开发容器

AI：好的，我来清理。

[docker.stop] dev-mysql
[docker.stop] dev-backend
[docker.stop] dev-frontend

AI：所有开发容器已清理完成。
```

## 🎯 关键特性

### 1. 容器持久化

```typescript
// 容器会一直运行，直到你主动停止
docker.run({
  image: "nginx:alpine",
  detach: true  // ← 持久化关键
})
```

### 2. 多次交互

```typescript
// 第一次调用：启动容器
docker.run({ name: "my-app", detach: true })

// 第二次调用：执行命令
docker.exec({ container: "my-app", script: "..." })

// 第三次调用：查看日志
docker.logs({ container: "my-app" })

// 第四次调用：停止容器
docker.stop({ container: "my-app" })
```

### 3. 容器命名

```typescript
// 使用名称便于管理
docker.run({
  name: "my-nginx",  // ← 命名
  detach: true
})

// 后续通过名称引用
docker.logs({ container: "my-nginx" })
docker.exec({ container: "my-nginx", ... })
docker.stop({ container: "my-nginx" })
```

### 4. 状态查询

```typescript
// 随时查看容器状态
docker.list({ all: false })

// 返回：
{
  count: 3,
  containers: [
    { id: "abc123", name: "my-nginx", status: "Up 2 hours" },
    { id: "def456", name: "my-mysql", status: "Up 1 day" },
    { id: "ghi789", name: "my-redis", status: "Up 30 minutes" }
  ]
}
```

## 📊 总结

### ✅ 支持的模式

| 模式 | detach | 行为 | 适用场景 |
|------|--------|------|----------|
| **前台** | false | 执行完自动删除 | 代码执行、数据处理 |
| **后台** | true | 持续运行 | Web 服务、数据库、开发环境 |

### ✅ 容器管理

| 操作 | 工具 | 说明 |
|------|------|------|
| **创建** | docker.run | 创建并启动容器 |
| **查看** | docker.list | 列出所有容器 |
| **日志** | docker.logs | 查看容器输出 |
| **执行** | docker.exec | 在容器内执行命令 |
| **停止** | docker.stop | 停止并删除容器 |
| **拉取** | docker.pull | 拉取镜像 |

### ✅ 核心价值

**AI 可以创建和管理长期运行的 Docker 容器！**

- ✅ 不是单次调用
- ✅ 容器可以持续运行
- ✅ 可以多次交互
- ✅ 完整的生命周期管理
- ✅ 支持真实的应用场景

🎉 **现在 Docker 不只是执行器，而是完整的容器管理系统！**
