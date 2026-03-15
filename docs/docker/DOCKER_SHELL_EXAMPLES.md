# Docker Shell 实际使用示例

## 问题解决方案总结

### ✅ 问题 1：长时间运行的命令会堵塞

**解决方案：使用后台执行（`&` 或 `nohup`）**

```typescript
// ❌ 错误：会堵塞 30 秒（或直到超时）
await docker.shell.exec({
  container: "web-app",
  command: "node app.js"  // 前台运行，会一直等待
});

// ✅ 正确：立即返回（< 5 秒）
await docker.shell.exec({
  container: "web-app",
  command: "node app.js &"  // 后台运行
});

// ✅ 更好：使用 nohup（即使 Shell 关闭也继续运行）
await docker.shell.exec({
  container: "web-app",
  command: "nohup node app.js > /var/log/app.log 2>&1 &"
});
```

### ✅ 问题 2：交互式程序（如 MySQL）无法使用

**解决方案：使用 `docker.shell.interactive` 工具**

```typescript
// ❌ 错误：会堵塞等待输入
await docker.shell.exec({
  container: "mysql-db",
  command: "mysql -uroot -ppassword"  // 会等待交互式输入
});

// ✅ 正确：使用 interactive 工具
await docker.shell.interactive({
  container: "mysql-db",
  program: "mysql -uroot -ppassword",
  commands: [
    "SHOW DATABASES;",
    "USE mydb;",
    "SELECT * FROM users;"
  ]
});
```

## 完整示例

### 示例 1：启动 Node.js Web 服务器

```typescript
// 1. 创建容器
await docker.run({
  image: "node:20",
  detach: true,
  name: "web-server",
  ports: {"3000": "3000"}
});

// 2. 进入 Shell
await docker.shell.enter({
  container: "web-server"
});

// 3. 创建应用文件
await docker.shell.exec({
  container: "web-server",
  command: "cat > app.js << 'EOF'\nconst http = require('http');\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, {'Content-Type': 'text/plain'});\n  res.end('Hello World\\n');\n});\nserver.listen(3000, () => console.log('Server running on port 3000'));\nEOF"
});

// 4. 后台启动服务器（不会堵塞！）
await docker.shell.exec({
  container: "web-server",
  command: "node app.js > /var/log/app.log 2>&1 &"
});
// 输出：(后台运行)

// 5. 等待服务器启动
await sleep(2000);

// 6. 测试服务器
await docker.shell.exec({
  container: "web-server",
  command: "curl http://localhost:3000"
});
// 输出：Hello World

// 7. 查看日志
await docker.shell.exec({
  container: "web-server",
  command: "cat /var/log/app.log"
});
// 输出：Server running on port 3000

// 8. 查看进程
await docker.shell.exec({
  container: "web-server",
  command: "ps aux | grep 'node app.js'"
});

// 9. 退出
await docker.shell.exit({
  container: "web-server"
});
```

### 示例 2：MySQL 数据库操作（交互式）

```typescript
// 1. 启动 MySQL
await docker.run({
  image: "mysql:8",
  detach: true,
  name: "mysql-db",
  env: {"MYSQL_ROOT_PASSWORD": "password"},
  ports: {"3306": "3306"}
});

// 2. 等待 MySQL 启动
await sleep(15000);

// 3. 进入 Shell
await docker.shell.enter({
  container: "mysql-db"
});

// 4. 使用交互式工具操作数据库
await docker.shell.interactive({
  container: "mysql-db",
  program: "mysql -uroot -ppassword",
  commands: [
    "CREATE DATABASE shop;",
    "USE shop;",
    "CREATE TABLE products (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100), price DECIMAL(10,2));",
    "INSERT INTO products (name, price) VALUES ('Apple', 1.50), ('Banana', 0.80), ('Orange', 1.20);",
    "SELECT * FROM products;",
    "SELECT name, price FROM products WHERE price < 1.00;",
    "UPDATE products SET price = 0.90 WHERE name = 'Banana';",
    "SELECT * FROM products;"
  ]
});

// 输出：
// +----+--------+-------+
// | id | name   | price |
// +----+--------+-------+
// |  1 | Apple  |  1.50 |
// |  2 | Banana |  0.90 |
// |  3 | Orange |  1.20 |
// +----+--------+-------+

// 5. 退出
await docker.shell.exit({
  container: "mysql-db"
});
```

### 示例 3：Python 数据分析服务器

```typescript
// 1. 创建容器
await docker.run({
  image: "python:3.11",
  detach: true,
  name: "data-server",
  ports: {"8000": "8000"},
  volumes: {"/Users/me/data": "/data"}
});

// 2. 进入 Shell
await docker.shell.enter({
  container: "data-server",
  workdir: "/data"
});

// 3. 安装依赖
await docker.shell.exec({
  container: "data-server",
  command: "pip install pandas flask"
});

// 4. 创建服务器脚本
await docker.shell.exec({
  container: "data-server",
  command: "cat > server.py << 'EOF'\nfrom flask import Flask, jsonify\nimport pandas as pd\nimport os\n\napp = Flask(__name__)\n\n@app.route('/analyze')\ndef analyze():\n    df = pd.read_csv('/data/data.csv')\n    return jsonify({\n        'count': len(df),\n        'mean': df.mean().to_dict(),\n        'sum': df.sum().to_dict()\n    })\n\nif __name__ == '__main__':\n    app.run(host='0.0.0.0', port=8000)\nEOF"
});

// 5. 后台启动服务器（不会堵塞！）
await docker.shell.exec({
  container: "data-server",
  command: "nohup python server.py > /var/log/server.log 2>&1 &"
});

// 6. 等待服务器启动
await sleep(3000);

// 7. 测试 API
await docker.shell.exec({
  container: "data-server",
  command: "curl http://localhost:8000/analyze"
});

// 8. 查看日志
await docker.shell.exec({
  container: "data-server",
  command: "tail -n 20 /var/log/server.log"
});

// 9. 退出
await docker.shell.exit({
  container: "data-server"
});
```

### 示例 4：Redis 缓存操作

```typescript
// 1. 启动 Redis
await docker.run({
  image: "redis:alpine",
  detach: true,
  name: "redis-cache",
  ports: {"6379": "6379"}
});

await sleep(3000);

// 2. 进入 Shell
await docker.shell.enter({
  container: "redis-cache"
});

// 3. 使用 Redis CLI
await docker.shell.interactive({
  container: "redis-cache",
  program: "redis-cli",
  commands: [
    "SET user:1:name 'Alice'",
    "SET user:1:email 'alice@example.com'",
    "SET user:2:name 'Bob'",
    "SET user:2:email 'bob@example.com'",
    "GET user:1:name",
    "KEYS user:*",
    "MGET user:1:name user:2:name",
    "INCR page:views",
    "INCR page:views",
    "INCR page:views",
    "GET page:views"
  ]
});

// 输出：
// OK
// OK
// OK
// OK
// "Alice"
// 1) "user:1:name"
// 2) "user:1:email"
// 3) "user:2:name"
// 4) "user:2:email"
// 1) "Alice"
// 2) "Bob"
// (integer) 1
// (integer) 2
// (integer) 3
// "3"

// 4. 退出
await docker.shell.exit({
  container: "redis-cache"
});
```

### 示例 5：使用 screen 管理多个后台任务

```typescript
// 1. 创建容器
await docker.run({
  image: "ubuntu:22.04",
  detach: true,
  name: "task-runner"
});

// 2. 进入 Shell
await docker.shell.enter({
  container: "task-runner"
});

// 3. 安装 screen
await docker.shell.exec({
  container: "task-runner",
  command: "apt-get update && apt-get install -y screen curl"
});

// 4. 启动多个后台任务
await docker.shell.exec({
  container: "task-runner",
  command: "screen -dmS task1 bash -c 'for i in {1..100}; do echo \"Task 1: $i\"; sleep 1; done'"
});

await docker.shell.exec({
  container: "task-runner",
  command: "screen -dmS task2 bash -c 'for i in {1..100}; do echo \"Task 2: $i\"; sleep 2; done'"
});

await docker.shell.exec({
  container: "task-runner",
  command: "screen -dmS task3 bash -c 'for i in {1..100}; do echo \"Task 3: $i\"; sleep 3; done'"
});

// 5. 列出所有 screen 会话
await docker.shell.exec({
  container: "task-runner",
  command: "screen -ls"
});

// 输出：
// There are screens on:
//     12345.task1     (Detached)
//     12346.task2     (Detached)
//     12347.task3     (Detached)

// 6. 查看 task1 的输出
await docker.shell.exec({
  container: "task-runner",
  command: "screen -S task1 -X hardcopy /tmp/task1.log && tail -n 10 /tmp/task1.log"
});

// 7. 停止 task2
await docker.shell.exec({
  container: "task-runner",
  command: "screen -S task2 -X quit"
});

// 8. 再次列出会话（task2 应该消失了）
await docker.shell.exec({
  container: "task-runner",
  command: "screen -ls"
});

// 9. 退出
await docker.shell.exit({
  container: "task-runner"
});
```

### 示例 6：PostgreSQL + Web 应用完整流程

```typescript
// 1. 启动 PostgreSQL
await docker.run({
  image: "postgres:15",
  detach: true,
  name: "postgres-db",
  env: {"POSTGRES_PASSWORD": "password"},
  ports: {"5432": "5432"}
});

await sleep(10000);

// 2. 初始化数据库
await docker.shell.enter({container: "postgres-db"});

await docker.shell.interactive({
  container: "postgres-db",
  program: "psql -U postgres",
  commands: [
    "CREATE DATABASE blog;",
    "\\c blog",
    "CREATE TABLE posts (id SERIAL PRIMARY KEY, title VARCHAR(200), content TEXT, created_at TIMESTAMP DEFAULT NOW());",
    "INSERT INTO posts (title, content) VALUES ('First Post', 'Hello World!'), ('Second Post', 'This is my blog.');",
    "SELECT * FROM posts;"
  ]
});

await docker.shell.exit({container: "postgres-db"});

// 3. 启动 Web 应用
await docker.run({
  image: "node:20",
  detach: true,
  name: "blog-app",
  ports: {"3000": "3000"},
  env: {
    "DB_HOST": "host.docker.internal",
    "DB_PORT": "5432",
    "DB_USER": "postgres",
    "DB_PASSWORD": "password",
    "DB_NAME": "blog"
  }
});

await docker.shell.enter({container: "blog-app"});

// 4. 安装依赖
await docker.shell.exec({
  container: "blog-app",
  command: "npm install express pg"
});

// 5. 创建应用
await docker.shell.exec({
  container: "blog-app",
  command: `cat > app.js << 'EOF'
const express = require('express');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

app.get('/posts', async (req, res) => {
  const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC');
  res.json(result.rows);
});

app.get('/posts/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  res.json(result.rows[0]);
});

app.listen(3000, () => console.log('Blog app running on port 3000'));
EOF`
});

// 6. 后台启动应用
await docker.shell.exec({
  container: "blog-app",
  command: "node app.js > /var/log/app.log 2>&1 &"
});

await sleep(2000);

// 7. 测试 API
await docker.shell.exec({
  container: "blog-app",
  command: "curl http://localhost:3000/posts"
});

// 输出：
// [
//   {"id":2,"title":"Second Post","content":"This is my blog.","created_at":"2024-01-01T12:00:00.000Z"},
//   {"id":1,"title":"First Post","content":"Hello World!","created_at":"2024-01-01T11:00:00.000Z"}
// ]

await docker.shell.exec({
  container: "blog-app",
  command: "curl http://localhost:3000/posts/1"
});

// 输出：
// {"id":1,"title":"First Post","content":"Hello World!","created_at":"2024-01-01T11:00:00.000Z"}

// 8. 退出
await docker.shell.exit({container: "blog-app"});
```

## 工具选择指南

| 场景 | 使用工具 | 示例 |
|------|---------|------|
| 单次命令 | `docker.shell.exec` | `ls -la` |
| 长时间运行 | `docker.shell.exec` + `&` | `node app.js &` |
| 数据库操作 | `docker.shell.interactive` | MySQL, PostgreSQL, Redis |
| 后台任务管理 | `docker.shell.exec` + `screen` | `screen -dmS task python script.py` |
| 查看日志 | `docker.shell.exec` + `tail` | `tail -n 100 /var/log/app.log` |
| 停止进程 | `docker.shell.exec` + `pkill` | `pkill -f 'node app.js'` |

## 最佳实践

### 1. 后台执行

```typescript
// ✅ 推荐
await docker.shell.exec({
  container: "app",
  command: "nohup node app.js > /var/log/app.log 2>&1 &"
});

// ⚠️ 可以，但 Shell 关闭后进程会停止
await docker.shell.exec({
  container: "app",
  command: "node app.js &"
});

// ❌ 不推荐（会堵塞）
await docker.shell.exec({
  container: "app",
  command: "node app.js"
});
```

### 2. 查看后台进程

```typescript
// 查看进程
await docker.shell.exec({
  container: "app",
  command: "ps aux | grep 'node app.js'"
});

// 查看日志（使用 tail -n，不要用 tail -f）
await docker.shell.exec({
  container: "app",
  command: "tail -n 100 /var/log/app.log"
});
```

### 3. 停止后台进程

```typescript
// 方法 1：pkill
await docker.shell.exec({
  container: "app",
  command: "pkill -f 'node app.js'"
});

// 方法 2：kill
await docker.shell.exec({
  container: "app",
  command: "ps aux | grep 'node app.js' | grep -v grep | awk '{print $2}' | xargs kill"
});
```

## 总结

✅ **后台执行**
- 使用 `&` 或 `nohup`
- 不会堵塞工具
- 自动检测，使用较短超时（5秒）

✅ **交互式程序**
- 使用 `docker.shell.interactive`
- 支持 MySQL、PostgreSQL、Redis、MongoDB
- 像真人一样操作数据库

✅ **完整的任务管理**
- 使用 `screen` 管理后台任务
- 查看进程和日志
- 停止和重启服务

现在，X-Computer 可以处理**任何 Docker 场景**！🚀
