# Docker Shell 高级功能

## 概述

X-Computer 的 Docker Shell 现在支持：

1. ✅ **后台命令执行**（不会堵塞）
2. ✅ **交互式程序**（如 MySQL、PostgreSQL、Redis）
3. ✅ **长时间运行的服务**（如 Web 服务器）

## 问题与解决方案

### 问题 1：长时间运行的命令会堵塞

**场景：**
```bash
# 这些命令会一直运行，导致工具堵塞
node app.js
python server.py
npm run dev
```

**解决方案：使用后台执行**

#### 方法 1：使用 `&` 后台执行

```typescript
// ✅ 正确：使用 & 后台执行
await docker.shell.exec({
  container: "web-app",
  command: "node app.js &"
});

// 命令会立即返回，不会堵塞
// 输出：(后台运行)
```

#### 方法 2：使用 `nohup`

```typescript
// ✅ 正确：使用 nohup（即使 Shell 关闭也继续运行）
await docker.shell.exec({
  container: "web-app",
  command: "nohup node app.js > /var/log/app.log 2>&1 &"
});
```

#### 方法 3：使用 `screen` 或 `tmux`（推荐）

```typescript
// 1. 安装 screen
await docker.shell.exec({
  container: "web-app",
  command: "apt-get update && apt-get install -y screen"
});

// 2. 在 screen 中启动应用
await docker.shell.exec({
  container: "web-app",
  command: "screen -dmS myapp node app.js"
});

// 3. 查看 screen 会话
await docker.shell.exec({
  container: "web-app",
  command: "screen -ls"
});

// 4. 查看应用输出
await docker.shell.exec({
  container: "web-app",
  command: "screen -S myapp -X hardcopy /tmp/screen.log && cat /tmp/screen.log"
});
```

### 问题 2：交互式程序无法使用

**场景：**
```bash
# 这些交互式程序需要持续输入命令
mysql -uroot -p
psql -U postgres
redis-cli
mongo
```

**解决方案：使用 `docker.shell.interactive` 工具**

## 新工具：`docker.shell.interactive`

### 功能

执行交互式程序（如数据库客户端），支持：
- MySQL
- PostgreSQL
- Redis
- MongoDB
- 任何其他交互式命令行工具

### 参数

- `container` (string, 必需): 容器 ID 或名称
- `program` (string, 必需): 交互式程序（如 "mysql -uroot -ppassword"）
- `commands` (array, 必需): 要执行的命令数组
- `timeout` (number, 可选): 超时毫秒数（默认 30000）

### 使用示例

#### 示例 1：MySQL 数据库操作

```typescript
// 1. 启动 MySQL 容器
await docker.run({
  image: "mysql:8",
  detach: true,
  name: "mysql-db",
  env: { "MYSQL_ROOT_PASSWORD": "password" },
  ports: { "3306": "3306" }
});

// 2. 等待 MySQL 启动
await sleep(10000);

// 3. 进入 Shell
await docker.shell.enter({
  container: "mysql-db"
});

// 4. 使用交互式工具执行 MySQL 命令
await docker.shell.interactive({
  container: "mysql-db",
  program: "mysql -uroot -ppassword",
  commands: [
    "SHOW DATABASES;",
    "CREATE DATABASE mydb;",
    "USE mydb;",
    "CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100));",
    "INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob');",
    "SELECT * FROM users;"
  ]
});

// 输出：
// +----+-------+
// | id | name  |
// +----+-------+
// |  1 | Alice |
// |  2 | Bob   |
// +----+-------+
```

#### 示例 2：PostgreSQL 操作

```typescript
await docker.run({
  image: "postgres:15",
  detach: true,
  name: "postgres-db",
  env: { "POSTGRES_PASSWORD": "password" },
  ports: { "5432": "5432" }
});

await sleep(10000);

await docker.shell.enter({
  container: "postgres-db"
});

await docker.shell.interactive({
  container: "postgres-db",
  program: "psql -U postgres",
  commands: [
    "\\l",  // 列出数据库
    "CREATE DATABASE mydb;",
    "\\c mydb",  // 连接到 mydb
    "CREATE TABLE users (id SERIAL PRIMARY KEY, name VARCHAR(100));",
    "INSERT INTO users (name) VALUES ('Alice'), ('Bob');",
    "SELECT * FROM users;"
  ]
});
```

#### 示例 3：Redis 操作

```typescript
await docker.run({
  image: "redis:alpine",
  detach: true,
  name: "redis-cache",
  ports: { "6379": "6379" }
});

await docker.shell.enter({
  container: "redis-cache"
});

await docker.shell.interactive({
  container: "redis-cache",
  program: "redis-cli",
  commands: [
    "SET user:1 'Alice'",
    "SET user:2 'Bob'",
    "GET user:1",
    "KEYS user:*",
    "MGET user:1 user:2"
  ]
});

// 输出：
// OK
// OK
// "Alice"
// 1) "user:1"
// 2) "user:2"
// 1) "Alice"
// 2) "Bob"
```

#### 示例 4：MongoDB 操作

```typescript
await docker.run({
  image: "mongo:7",
  detach: true,
  name: "mongo-db",
  ports: { "27017": "27017" }
});

await sleep(5000);

await docker.shell.enter({
  container: "mongo-db"
});

await docker.shell.interactive({
  container: "mongo-db",
  program: "mongo",
  commands: [
    "use mydb",
    "db.users.insertMany([{name: 'Alice', age: 25}, {name: 'Bob', age: 30}])",
    "db.users.find()",
    "db.users.find({age: {$gt: 26}})"
  ]
});
```

## 完整工作流示例

### 示例 1：Web 应用开发（后台运行）

```typescript
// 1. 创建开发容器
await docker.run({
  image: "node:20",
  detach: true,
  name: "web-dev",
  ports: { "3000": "3000" },
  volumes: { "/Users/me/project": "/workspace" }
});

// 2. 进入 Shell
await docker.shell.enter({
  container: "web-dev",
  workdir: "/workspace"
});

// 3. 安装依赖
await docker.shell.exec({
  container: "web-dev",
  command: "npm install"
});

// 4. 后台启动应用（不会堵塞）
await docker.shell.exec({
  container: "web-dev",
  command: "npm run dev > /var/log/app.log 2>&1 &"
});

// 5. 等待应用启动
await sleep(3000);

// 6. 查看日志
await docker.shell.exec({
  container: "web-dev",
  command: "tail -n 50 /var/log/app.log"
});

// 7. 测试应用
await docker.shell.exec({
  container: "web-dev",
  command: "curl http://localhost:3000"
});

// 8. 退出 Shell
await docker.shell.exit({
  container: "web-dev"
});
```

### 示例 2：数据库 + Web 应用

```typescript
// 1. 启动 MySQL
await docker.run({
  image: "mysql:8",
  detach: true,
  name: "mysql-db",
  env: { "MYSQL_ROOT_PASSWORD": "password" },
  ports: { "3306": "3306" }
});

await sleep(10000);

// 2. 初始化数据库
await docker.shell.enter({ container: "mysql-db" });

await docker.shell.interactive({
  container: "mysql-db",
  program: "mysql -uroot -ppassword",
  commands: [
    "CREATE DATABASE myapp;",
    "USE myapp;",
    "CREATE TABLE users (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100), email VARCHAR(100));",
    "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com'), ('Bob', 'bob@example.com');"
  ]
});

await docker.shell.exit({ container: "mysql-db" });

// 3. 启动 Web 应用
await docker.run({
  image: "node:20",
  detach: true,
  name: "web-app",
  ports: { "3000": "3000" },
  env: {
    "DB_HOST": "host.docker.internal",
    "DB_PORT": "3306",
    "DB_USER": "root",
    "DB_PASSWORD": "password",
    "DB_NAME": "myapp"
  }
});

await docker.shell.enter({ container: "web-app" });

await docker.shell.exec({
  container: "web-app",
  command: "npm install express mysql2"
});

await docker.shell.exec({
  container: "web-app",
  command: "cat > app.js << 'EOF'\nconst express = require('express');\nconst mysql = require('mysql2/promise');\nconst app = express();\n\nconst pool = mysql.createPool({\n  host: process.env.DB_HOST,\n  port: process.env.DB_PORT,\n  user: process.env.DB_USER,\n  password: process.env.DB_PASSWORD,\n  database: process.env.DB_NAME\n});\n\napp.get('/users', async (req, res) => {\n  const [rows] = await pool.query('SELECT * FROM users');\n  res.json(rows);\n});\n\napp.listen(3000, () => console.log('Server running on port 3000'));\nEOF"
});

// 后台启动应用
await docker.shell.exec({
  container: "web-app",
  command: "node app.js > /var/log/app.log 2>&1 &"
});

await sleep(2000);

// 测试 API
await docker.shell.exec({
  container: "web-app",
  command: "curl http://localhost:3000/users"
});

await docker.shell.exit({ container: "web-app" });
```

### 示例 3：Python 数据分析 + 数据库

```typescript
// 1. 启动 PostgreSQL
await docker.run({
  image: "postgres:15",
  detach: true,
  name: "postgres-db",
  env: { "POSTGRES_PASSWORD": "password" },
  ports: { "5432": "5432" }
});

await sleep(10000);

// 2. 创建数据库和表
await docker.shell.enter({ container: "postgres-db" });

await docker.shell.interactive({
  container: "postgres-db",
  program: "psql -U postgres",
  commands: [
    "CREATE DATABASE analytics;",
    "\\c analytics",
    "CREATE TABLE sales (id SERIAL PRIMARY KEY, product VARCHAR(100), amount DECIMAL(10,2), date DATE);",
    "INSERT INTO sales (product, amount, date) VALUES ('Product A', 100.50, '2024-01-01'), ('Product B', 200.75, '2024-01-02'), ('Product A', 150.25, '2024-01-03');"
  ]
});

await docker.shell.exit({ container: "postgres-db" });

// 3. 启动 Python 分析容器
await docker.run({
  image: "python:3.11",
  detach: true,
  name: "python-analytics",
  env: {
    "DB_HOST": "host.docker.internal",
    "DB_PORT": "5432",
    "DB_USER": "postgres",
    "DB_PASSWORD": "password",
    "DB_NAME": "analytics"
  }
});

await docker.shell.enter({ container: "python-analytics" });

await docker.shell.exec({
  container: "python-analytics",
  command: "pip install psycopg2-binary pandas matplotlib"
});

await docker.shell.exec({
  container: "python-analytics",
  command: "cat > analyze.py << 'EOF'\nimport psycopg2\nimport pandas as pd\nimport os\n\nconn = psycopg2.connect(\n    host=os.environ['DB_HOST'],\n    port=os.environ['DB_PORT'],\n    user=os.environ['DB_USER'],\n    password=os.environ['DB_PASSWORD'],\n    database=os.environ['DB_NAME']\n)\n\ndf = pd.read_sql('SELECT * FROM sales', conn)\nprint('总销售额:', df['amount'].sum())\nprint('平均销售额:', df['amount'].mean())\nprint('\\n按产品统计:')\nprint(df.groupby('product')['amount'].sum())\n\nconn.close()\nEOF"
});

await docker.shell.exec({
  container: "python-analytics",
  command: "python analyze.py"
});

await docker.shell.exit({ container: "python-analytics" });
```

## 最佳实践

### 1. 长时间运行的命令

```typescript
// ✅ 好的做法：使用后台执行
await docker.shell.exec({
  container: "app",
  command: "npm run dev > /var/log/app.log 2>&1 &"
});

// ❌ 不好的做法：前台执行（会堵塞）
await docker.shell.exec({
  container: "app",
  command: "npm run dev"  // 会一直等待
});
```

### 2. 查看后台进程

```typescript
// 查看进程
await docker.shell.exec({
  container: "app",
  command: "ps aux | grep node"
});

// 查看日志
await docker.shell.exec({
  container: "app",
  command: "tail -f /var/log/app.log"  // 注意：tail -f 也会堵塞，使用 tail -n 代替
});

// 正确的查看日志方式
await docker.shell.exec({
  container: "app",
  command: "tail -n 100 /var/log/app.log"
});
```

### 3. 停止后台进程

```typescript
// 方法 1：使用 pkill
await docker.shell.exec({
  container: "app",
  command: "pkill -f 'node app.js'"
});

// 方法 2：使用 kill
await docker.shell.exec({
  container: "app",
  command: "ps aux | grep 'node app.js' | grep -v grep | awk '{print $2}' | xargs kill"
});

// 方法 3：使用 screen（如果使用了 screen）
await docker.shell.exec({
  container: "app",
  command: "screen -S myapp -X quit"
});
```

### 4. 交互式程序最佳实践

```typescript
// ✅ 好的做法：使用 docker.shell.interactive
await docker.shell.interactive({
  container: "mysql-db",
  program: "mysql -uroot -ppassword",
  commands: [
    "SHOW DATABASES;",
    "USE mydb;",
    "SELECT * FROM users;"
  ]
});

// ❌ 不好的做法：尝试直接执行（不会工作）
await docker.shell.exec({
  container: "mysql-db",
  command: "mysql -uroot -ppassword"  // 会堵塞等待输入
});
```

### 5. 使用 screen 管理长时间任务

```typescript
// 1. 安装 screen
await docker.shell.exec({
  container: "app",
  command: "apt-get update && apt-get install -y screen"
});

// 2. 在 screen 中启动任务
await docker.shell.exec({
  container: "app",
  command: "screen -dmS task1 python long_running_task.py"
});

// 3. 列出所有 screen 会话
await docker.shell.exec({
  container: "app",
  command: "screen -ls"
});

// 4. 查看 screen 输出
await docker.shell.exec({
  container: "app",
  command: "screen -S task1 -X hardcopy /tmp/screen.log && cat /tmp/screen.log"
});

// 5. 终止 screen 会话
await docker.shell.exec({
  container: "app",
  command: "screen -S task1 -X quit"
});
```

## 工具对比

| 场景 | 推荐工具 | 示例 |
|------|---------|------|
| 单次命令 | `docker.shell.exec` | `ls -la` |
| 长时间运行 | `docker.shell.exec` + `&` | `node app.js &` |
| 交互式程序 | `docker.shell.interactive` | MySQL, PostgreSQL, Redis |
| 后台任务管理 | `docker.shell.exec` + `screen` | `screen -dmS task python script.py` |
| 查看日志 | `docker.shell.exec` + `tail` | `tail -n 100 /var/log/app.log` |
| 停止进程 | `docker.shell.exec` + `pkill` | `pkill -f 'node app.js'` |

## 故障排除

### 问题 1：命令超时

```
错误：Command timeout after 30000ms
```

**解决：**
- 使用后台执行：`command: "node app.js &"`
- 增加超时：`timeout: 120000`

### 问题 2：后台进程没有启动

```
命令返回了，但进程没有运行
```

**解决：**
```typescript
// 检查进程
await docker.shell.exec({
  container: "app",
  command: "ps aux | grep 'node app.js'"
});

// 检查日志
await docker.shell.exec({
  container: "app",
  command: "cat /var/log/app.log"
});
```

### 问题 3：交互式程序无响应

```
错误：Interactive command timeout
```

**解决：**
- 确保程序已安装：`which mysql`
- 检查连接参数：密码、端口等
- 增加超时：`timeout: 60000`

## 总结

现在 Docker Shell 支持：

✅ **后台命令执行**
- 使用 `&` 或 `nohup`
- 不会堵塞工具
- 适合长时间运行的服务

✅ **交互式程序**
- 新工具：`docker.shell.interactive`
- 支持 MySQL、PostgreSQL、Redis、MongoDB
- 像真人一样操作数据库

✅ **完整的任务管理**
- 使用 `screen` 管理后台任务
- 查看进程和日志
- 停止和重启服务

现在，X-Computer 可以处理**任何 Docker 场景**，包括长时间运行的服务和交互式程序！🚀
