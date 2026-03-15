# Docker 容器交互完整指南

## 🎯 核心交互方式

### `docker.exec` - 在运行中的容器内执行命令

这是与后台容器交互的**核心工具**。

**参数**：
- `container` (必需): 容器 ID 或名称
- `command`: 命令数组（如 `["ls", "-la"]`）
- `script`: 脚本内容（推荐，更灵活）
- `workdir`: 工作目录
- `timeout`: 超时毫秒数

## 💡 完整交互示例

### 示例 1: Web 应用开发

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 1 步：创建开发容器
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：创建一个 Node.js 开发环境

AI：[docker.run]
{
  image: "node:20-alpine",
  name: "my-app-dev",
  script: "tail -f /dev/null",  // 保持运行
  volumes: {
    "/Users/me/my-app": "/workspace"
  },
  workdir: "/workspace",
  ports: {
    "3000": "3000"
  },
  detach: true
}

返回：容器 my-app-dev 已启动

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 2 步：初始化项目
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：初始化一个 Express 项目

AI：[docker.exec]
{
  container: "my-app-dev",
  script: "npm init -y"
}

返回：package.json 已创建

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 3 步：安装依赖
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：安装 Express

AI：[docker.exec]
{
  container: "my-app-dev",
  script: "npm install express"
}

返回：Express 已安装

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 4 步：创建应用文件
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：创建一个简单的 API

AI：[docker.exec]
{
  container: "my-app-dev",
  script: `
cat > app.js << 'EOF'
const express = require('express');
const app = express();

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Docker!' });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
EOF
  `
}

返回：app.js 已创建

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 5 步：启动应用
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：启动服务器

AI：[docker.exec]
{
  container: "my-app-dev",
  script: "node app.js > /tmp/app.log 2>&1 &"
}

返回：服务器已启动

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 6 步：测试 API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：测试一下 API

AI：[docker.exec]
{
  container: "my-app-dev",
  script: "wget -qO- http://localhost:3000/api/hello"
}

返回：{"message":"Hello from Docker!"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 7 步：查看日志
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：查看服务器日志

AI：[docker.exec]
{
  container: "my-app-dev",
  script: "cat /tmp/app.log"
}

返回：Server running on port 3000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 8 步：修改代码
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：添加一个新的路由

AI：[docker.exec]
{
  container: "my-app-dev",
  script: `
cat >> app.js << 'EOF'

app.get('/api/time', (req, res) => {
  res.json({ time: new Date().toISOString() });
});
EOF
  `
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 9 步：重启应用
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：重启服务器

AI：[docker.exec]
{
  container: "my-app-dev",
  script: "pkill -f 'node app.js' && node app.js > /tmp/app.log 2>&1 &"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 10 步：测试新路由
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：测试新的 time 接口

AI：[docker.exec]
{
  container: "my-app-dev",
  script: "wget -qO- http://localhost:3000/api/time"
}

返回：{"time":"2026-02-28T03:30:00.000Z"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 11 步：查看进程
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：查看容器内的进程

AI：[docker.exec]
{
  container: "my-app-dev",
  script: "ps aux"
}

返回：进程列表...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 12 步：清理
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：完成开发，清理容器

AI：[docker.stop]
{
  container: "my-app-dev",
  remove: true
}

返回：容器已停止并删除
```

### 示例 2: 数据库操作

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 1 步：启动 PostgreSQL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：启动一个 PostgreSQL 数据库

AI：[docker.run]
{
  image: "postgres:15-alpine",
  name: "my-postgres",
  env: {
    "POSTGRES_PASSWORD": "password123",
    "POSTGRES_DB": "myapp"
  },
  ports: { "5432": "5432" },
  detach: true
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 2 步：等待数据库就绪
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：等待 10 秒让数据库启动

AI：[sleep] 10000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 3 步：创建表
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：创建 users 表

AI：[docker.exec]
{
  container: "my-postgres",
  script: `
psql -U postgres -d myapp << 'EOF'
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  email VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
EOF
  `
}

返回：表已创建

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 4 步：插入数据
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：插入 3 个用户

AI：[docker.exec]
{
  container: "my-postgres",
  script: `
psql -U postgres -d myapp << 'EOF'
INSERT INTO users (name, email) VALUES 
  ('Alice', 'alice@example.com'),
  ('Bob', 'bob@example.com'),
  ('Charlie', 'charlie@example.com');
EOF
  `
}

返回：3 行已插入

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 5 步：查询数据
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：查询所有用户

AI：[docker.exec]
{
  container: "my-postgres",
  script: "psql -U postgres -d myapp -c 'SELECT * FROM users;'"
}

返回：
 id |  name   |       email        |     created_at      
----+---------+--------------------+---------------------
  1 | Alice   | alice@example.com  | 2026-02-28 03:30:00
  2 | Bob     | bob@example.com    | 2026-02-28 03:30:00
  3 | Charlie | charlie@example.com| 2026-02-28 03:30:00

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 6 步：更新数据
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：更新 Alice 的邮箱

AI：[docker.exec]
{
  container: "my-postgres",
  script: "psql -U postgres -d myapp -c \"UPDATE users SET email='alice.new@example.com' WHERE name='Alice';\""
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 7 步：查看更新后的数据
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：再查询一次

AI：[docker.exec]
{
  container: "my-postgres",
  script: "psql -U postgres -d myapp -c 'SELECT * FROM users WHERE name=\\'Alice\\';'"
}

返回：Alice 的邮箱已更新

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 8 步：备份数据库
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：备份数据库

AI：[docker.exec]
{
  container: "my-postgres",
  script: "pg_dump -U postgres myapp > /tmp/backup.sql"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 9 步：查看容器状态
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：数据库运行了多久？

AI：[docker.list]
{ all: false }

返回：my-postgres 已运行 2 小时

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第 10 步：停止数据库
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户：停止数据库

AI：[docker.stop]
{
  container: "my-postgres",
  remove: true
}
```

## 🎨 交互模式详解

### 模式 1: 命令执行

```typescript
// 执行单个命令
docker.exec({
  container: "my-container",
  command: ["ls", "-la", "/workspace"]
})

// 执行多个命令（使用 script）
docker.exec({
  container: "my-container",
  script: `
    cd /workspace
    ls -la
    pwd
  `
})
```

### 模式 2: 文件操作

```typescript
// 创建文件
docker.exec({
  container: "my-container",
  script: `
cat > /workspace/config.json << 'EOF'
{
  "port": 3000,
  "host": "0.0.0.0"
}
EOF
  `
})

// 读取文件
docker.exec({
  container: "my-container",
  script: "cat /workspace/config.json"
})

// 修改文件
docker.exec({
  container: "my-container",
  script: "sed -i 's/3000/4000/g' /workspace/config.json"
})
```

### 模式 3: 进程管理

```typescript
// 启动进程
docker.exec({
  container: "my-container",
  script: "node app.js > /tmp/app.log 2>&1 &"
})

// 查看进程
docker.exec({
  container: "my-container",
  script: "ps aux | grep node"
})

// 停止进程
docker.exec({
  container: "my-container",
  script: "pkill -f 'node app.js'"
})

// 重启进程
docker.exec({
  container: "my-container",
  script: "pkill -f 'node app.js' && node app.js > /tmp/app.log 2>&1 &"
})
```

### 模式 4: 数据库操作

```typescript
// 创建表
docker.exec({
  container: "my-mysql",
  script: `
mysql -uroot -ppassword mydb << 'EOF'
CREATE TABLE products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100),
  price DECIMAL(10,2)
);
EOF
  `
})

// 插入数据
docker.exec({
  container: "my-mysql",
  script: `
mysql -uroot -ppassword mydb << 'EOF'
INSERT INTO products (name, price) VALUES 
  ('Product A', 19.99),
  ('Product B', 29.99);
EOF
  `
})

// 查询数据
docker.exec({
  container: "my-mysql",
  script: "mysql -uroot -ppassword mydb -e 'SELECT * FROM products;'"
})

// 更新数据
docker.exec({
  container: "my-mysql",
  script: "mysql -uroot -ppassword mydb -e \"UPDATE products SET price=24.99 WHERE name='Product A';\""
})
```

### 模式 5: 服务管理

```typescript
// 重载配置（Nginx）
docker.exec({
  container: "my-nginx",
  script: "nginx -s reload"
})

// 检查配置
docker.exec({
  container: "my-nginx",
  script: "nginx -t"
})

// 查看状态
docker.exec({
  container: "my-nginx",
  script: "ps aux | grep nginx"
})
```

## 🔄 完整的交互流程

### 流程图

```
1. docker.run (detach: true)
   ↓
   容器启动并持续运行
   ↓
2. docker.exec (多次调用)
   ├─ 执行命令 A
   ├─ 执行命令 B
   ├─ 执行命令 C
   └─ ...
   ↓
3. docker.logs (随时查看)
   ↓
4. docker.list (检查状态)
   ↓
5. docker.stop (完成后清理)
```

### 时间线示例

```
T=0s    docker.run → 启动容器
T=5s    docker.exec → 安装依赖
T=30s   docker.exec → 启动服务
T=1m    docker.logs → 查看日志
T=5m    docker.exec → 修改配置
T=6m    docker.exec → 重启服务
T=10m   docker.exec → 测试功能
T=1h    docker.logs → 查看运行日志
T=2h    docker.stop → 停止容器
```

## 💡 高级交互技巧

### 技巧 1: 后台进程 + 日志文件

```typescript
// 启动后台进程，输出到日志文件
docker.exec({
  container: "my-container",
  script: "node app.js > /tmp/app.log 2>&1 &"
})

// 查看日志
docker.exec({
  container: "my-container",
  script: "tail -f /tmp/app.log"
})
```

### 技巧 2: 环境变量

```typescript
// 设置环境变量
docker.exec({
  container: "my-container",
  script: "export API_KEY=secret123 && node app.js"
})
```

### 技巧 3: 多行脚本

```typescript
docker.exec({
  container: "my-container",
  script: `
    echo "开始部署..."
    cd /workspace
    npm install
    npm run build
    echo "部署完成！"
  `
})
```

### 技巧 4: 条件执行

```typescript
docker.exec({
  container: "my-container",
  script: `
    if [ -f /workspace/app.js ]; then
      node app.js
    else
      echo "app.js not found"
      exit 1
    fi
  `
})
```

### 技巧 5: 循环操作

```typescript
docker.exec({
  container: "my-container",
  script: `
    for i in 1 2 3 4 5; do
      echo "Processing item $i"
      sleep 1
    done
  `
})
```

## 🎯 实际工作流示例

### 工作流 1: CI/CD 流程

```
1. docker.run → 启动构建容器
   ↓
2. docker.exec → git clone 代码
   ↓
3. docker.exec → npm install
   ↓
4. docker.exec → npm test
   ↓
5. docker.exec → npm run build
   ↓
6. docker.exec → 打包产物
   ↓
7. docker.stop → 清理容器
```

### 工作流 2: 数据 ETL

```
1. docker.run → 启动 Python 容器
   ↓
2. docker.exec → 下载数据
   ↓
3. docker.exec → 清洗数据
   ↓
4. docker.exec → 转换格式
   ↓
5. docker.exec → 加载到数据库
   ↓
6. docker.logs → 查看处理日志
   ↓
7. docker.stop → 清理容器
```

### 工作流 3: 微服务开发

```
1. docker.run → 启动 MySQL
   ↓
2. docker.run → 启动 Redis
   ↓
3. docker.run → 启动后端容器
   ↓
4. docker.exec (后端) → 运行数据库迁移
   ↓
5. docker.exec (后端) → 启动 API 服务
   ↓
6. docker.run → 启动前端容器
   ↓
7. docker.exec (前端) → 启动开发服务器
   ↓
8. docker.list → 查看所有服务状态
   ↓
9. docker.logs → 查看各服务日志
   ↓
10. docker.exec → 测试 API
   ↓
11. docker.stop (全部) → 清理环境
```

## 📊 交互方式对比

| 方式 | 工具 | 用途 | 频率 |
|------|------|------|------|
| **创建容器** | docker.run | 启动新容器 | 一次 |
| **执行命令** | docker.exec | 在容器内操作 | 多次 ⭐ |
| **查看日志** | docker.logs | 查看输出 | 多次 |
| **查看状态** | docker.list | 检查容器 | 多次 |
| **停止容器** | docker.stop | 清理资源 | 一次 |

## 🎨 AI 的交互能力

AI 可以：

### ✅ 持续交互
```
启动容器 → 执行命令 → 查看结果 → 再执行 → 再查看 → ...
```

### ✅ 状态管理
```
随时查看容器状态、日志、进程
```

### ✅ 动态调整
```
根据结果动态调整后续操作
```

### ✅ 多容器编排
```
同时管理多个容器，相互配合
```

## 🔑 关键点总结

### 1. `docker.exec` 是核心

**在容器内执行任意命令**，实现持续交互：
```typescript
docker.exec({
  container: "my-container",
  script: "任意命令或脚本"
})
```

### 2. 容器持久化

使用 `detach: true` 让容器持续运行：
```typescript
docker.run({
  name: "my-container",
  detach: true  // ← 关键
})
```

### 3. 容器命名

通过 `name` 参数便于后续引用：
```typescript
docker.run({ name: "my-app", ... })
docker.exec({ container: "my-app", ... })
docker.logs({ container: "my-app" })
docker.stop({ container: "my-app" })
```

### 4. 多次调用

AI 可以多次调用 `docker.exec` 与同一个容器交互：
```
调用 1: docker.exec → 安装依赖
调用 2: docker.exec → 启动服务
调用 3: docker.exec → 测试功能
调用 4: docker.exec → 修改配置
调用 5: docker.exec → 重启服务
...
```

## 🎉 总结

### ✅ 不是单次调用！

Docker 容器支持：
- ✅ **持续运行**：使用 `detach: true`
- ✅ **多次交互**：通过 `docker.exec` 执行命令
- ✅ **状态查询**：通过 `docker.list` 和 `docker.logs`
- ✅ **完整管理**：创建 → 使用 → 查看 → 停止

### 交互流程

```
1次 docker.run (detach: true)  ← 创建容器
   ↓
N次 docker.exec                ← 持续交互 ⭐
N次 docker.logs                ← 查看日志
N次 docker.list                ← 检查状态
   ↓
1次 docker.stop                ← 清理容器
```

**AI 可以与后台容器进行无限次交互！** 🎉
