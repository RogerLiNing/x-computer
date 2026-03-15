# Docker 工具 AI 使用示例

## 示例 1：快速脚本执行

### 用户请求

```
用户：帮我用 Python 计算 1 到 100 的和
```

### AI 响应

```
AI：好的，我来用 Python 计算。

[调用 docker.run]
{
  "image": "python:3.11-slim",
  "script": "print(sum(range(1, 101)))"
}

结果：5050
```

**分析：** 单次任务，不需要 Shell 会话。

---

## 示例 2：Web 应用开发

### 用户请求

```
用户：帮我在 Docker 里搭建一个 Express 应用
```

### AI 响应

```
AI：好的，我来帮你搭建 Express 应用。

步骤 1：创建开发容器
[调用 docker.run]
{
  "image": "node:20-alpine",
  "detach": true,
  "name": "express-dev",
  "ports": {"3000": "3000"},
  "workdir": "/workspace"
}

步骤 2：进入容器 Shell
[调用 docker.shell.enter]
{
  "container": "express-dev",
  "workdir": "/workspace"
}

步骤 3：初始化项目
[调用 docker.shell.exec]
{
  "container": "express-dev",
  "command": "npm init -y"
}

步骤 4：安装 Express
[调用 docker.shell.exec]
{
  "container": "express-dev",
  "command": "npm install express"
}

步骤 5：创建应用文件
[调用 docker.shell.exec]
{
  "container": "express-dev",
  "command": "cat > app.js << 'EOF'\nconst express = require('express');\nconst app = express();\napp.get('/', (req, res) => res.send('Hello World!'));\napp.listen(3000, () => console.log('Server running on port 3000'));\nEOF"
}

步骤 6：启动应用
[调用 docker.shell.exec]
{
  "container": "express-dev",
  "command": "node app.js &"
}

步骤 7：退出 Shell
[调用 docker.shell.exit]
{
  "container": "express-dev"
}

完成！Express 应用已启动，访问 http://localhost:3000 查看。
```

**分析：** 多步操作，需要保持状态，使用 Shell 会话。

---

## 示例 3：数据分析

### 用户请求

```
用户：帮我分析这个 CSV 文件（/Users/me/data.csv），计算平均值
```

### AI 响应

```
AI：好的，我来分析这个 CSV 文件。

[调用 docker.run]
{
  "image": "python:3.11-slim",
  "script": "import pandas as pd\ndf = pd.read_csv('/data/data.csv')\nprint('平均值：', df.mean())",
  "volumes": {"/Users/me": "/data"}
}

结果：
平均值：
column1    45.2
column2    78.9
column3    123.4
```

**分析：** 单次任务，使用卷挂载访问文件。

---

## 示例 4：数据库操作

### 用户请求

```
用户：帮我在 MySQL 里创建一个用户表并插入数据
```

### AI 响应

```
AI：好的，我来帮你操作 MySQL。

步骤 1：启动 MySQL 容器
[调用 docker.run]
{
  "image": "mysql:8",
  "detach": true,
  "name": "mysql-db",
  "env": {"MYSQL_ROOT_PASSWORD": "password"},
  "ports": {"3306": "3306"}
}

步骤 2：等待 MySQL 启动
[等待 10 秒]

步骤 3：进入容器 Shell
[调用 docker.shell.enter]
{
  "container": "mysql-db"
}

步骤 4：创建数据库
[调用 docker.shell.exec]
{
  "container": "mysql-db",
  "command": "mysql -uroot -ppassword -e 'CREATE DATABASE mydb;'"
}

步骤 5：创建用户表
[调用 docker.shell.exec]
{
  "container": "mysql-db",
  "command": "mysql -uroot -ppassword -e 'USE mydb; CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100), email VARCHAR(100));'"
}

步骤 6：插入数据
[调用 docker.shell.exec]
{
  "container": "mysql-db",
  "command": "mysql -uroot -ppassword -e 'USE mydb; INSERT INTO users VALUES (1, \"Alice\", \"alice@example.com\"), (2, \"Bob\", \"bob@example.com\");'"
}

步骤 7：查询数据
[调用 docker.shell.exec]
{
  "container": "mysql-db",
  "command": "mysql -uroot -ppassword -e 'USE mydb; SELECT * FROM users;'"
}

步骤 8：退出 Shell
[调用 docker.shell.exit]
{
  "container": "mysql-db"
}

完成！用户表已创建并插入了 2 条数据。
```

**分析：** 多步数据库操作，需要保持连接状态。

---

## 示例 5：调试应用

### 用户请求

```
用户：我的应用报错了，帮我看看
```

### AI 响应

```
AI：好的，我来帮你调试。

步骤 1：进入容器
[调用 docker.shell.enter]
{
  "container": "my-app"
}

步骤 2：查看最近的日志
[调用 docker.shell.exec]
{
  "container": "my-app",
  "command": "tail -n 100 /var/log/app.log"
}

发现错误：Error: Cannot find module 'express'

步骤 3：检查 package.json
[调用 docker.shell.exec]
{
  "container": "my-app",
  "command": "cat package.json"
}

步骤 4：安装缺失的依赖
[调用 docker.shell.exec]
{
  "container": "my-app",
  "command": "npm install"
}

步骤 5：重启应用
[调用 docker.shell.exec]
{
  "container": "my-app",
  "command": "pm2 restart app"
}

步骤 6：验证应用状态
[调用 docker.shell.exec]
{
  "container": "my-app",
  "command": "pm2 status"
}

步骤 7：退出 Shell
[调用 docker.shell.exit]
{
  "container": "my-app"
}

问题已解决！应用现在正常运行。
```

**分析：** 调试需要多步操作和状态保持。

---

## 示例 6：编译项目

### 用户请求

```
用户：帮我编译这个 Go 项目
```

### AI 响应

```
AI：好的，我来编译 Go 项目。

[调用 docker.run]
{
  "image": "golang:1.21-alpine",
  "command": ["go", "build", "-o", "app", "main.go"],
  "volumes": {"/Users/me/project": "/workspace"},
  "workdir": "/workspace"
}

编译成功！可执行文件：/Users/me/project/app
```

**分析：** 单次编译任务，不需要 Shell 会话。

---

## 示例 7：多容器协作

### 用户请求

```
用户：帮我搭建一个 Web 应用 + Redis 的环境
```

### AI 响应

```
AI：好的，我来搭建 Web 应用 + Redis 环境。

步骤 1：启动 Redis
[调用 docker.run]
{
  "image": "redis:alpine",
  "detach": true,
  "name": "redis-cache",
  "ports": {"6379": "6379"}
}

步骤 2：启动 Web 应用容器
[调用 docker.run]
{
  "image": "node:20-alpine",
  "detach": true,
  "name": "web-app",
  "ports": {"3000": "3000"},
  "env": {"REDIS_HOST": "host.docker.internal", "REDIS_PORT": "6379"}
}

步骤 3：进入 Web 应用容器
[调用 docker.shell.enter]
{
  "container": "web-app"
}

步骤 4：安装依赖
[调用 docker.shell.exec]
{
  "container": "web-app",
  "command": "npm install express redis"
}

步骤 5：创建应用
[调用 docker.shell.exec]
{
  "container": "web-app",
  "command": "cat > app.js << 'EOF'\nconst express = require('express');\nconst redis = require('redis');\nconst app = express();\nconst client = redis.createClient({host: process.env.REDIS_HOST, port: process.env.REDIS_PORT});\napp.get('/', async (req, res) => {\n  await client.incr('visits');\n  const visits = await client.get('visits');\n  res.send(`Visits: ${visits}`);\n});\napp.listen(3000);\nEOF"
}

步骤 6：启动应用
[调用 docker.shell.exec]
{
  "container": "web-app",
  "command": "node app.js &"
}

步骤 7：退出 Shell
[调用 docker.shell.exit]
{
  "container": "web-app"
}

完成！Web 应用已启动，访问 http://localhost:3000 查看。
```

**分析：** 多容器协作，需要配置网络和环境变量。

---

## 示例 8：数据处理流水线

### 用户请求

```
用户：帮我处理这批数据：下载 → 清洗 → 分析 → 生成报告
```

### AI 响应

```
AI：好的，我来执行数据处理流水线。

步骤 1：创建处理容器
[调用 docker.run]
{
  "image": "python:3.11",
  "detach": true,
  "name": "data-pipeline",
  "volumes": {"/Users/me/data": "/data"}
}

步骤 2：进入容器
[调用 docker.shell.enter]
{
  "container": "data-pipeline",
  "workdir": "/data"
}

步骤 3：安装依赖
[调用 docker.shell.exec]
{
  "container": "data-pipeline",
  "command": "pip install pandas requests matplotlib"
}

步骤 4：下载数据
[调用 docker.shell.exec]
{
  "container": "data-pipeline",
  "command": "python -c 'import requests; r = requests.get(\"https://example.com/data.csv\"); open(\"raw_data.csv\", \"wb\").write(r.content)'"
}

步骤 5：清洗数据
[调用 docker.shell.exec]
{
  "container": "data-pipeline",
  "command": "python -c 'import pandas as pd; df = pd.read_csv(\"raw_data.csv\"); df = df.dropna(); df.to_csv(\"cleaned_data.csv\", index=False)'"
}

步骤 6：分析数据
[调用 docker.shell.exec]
{
  "container": "data-pipeline",
  "command": "python -c 'import pandas as pd; df = pd.read_csv(\"cleaned_data.csv\"); stats = df.describe(); stats.to_csv(\"analysis.csv\")'"
}

步骤 7：生成报告
[调用 docker.shell.exec]
{
  "container": "data-pipeline",
  "command": "python -c 'import pandas as pd; import matplotlib.pyplot as plt; df = pd.read_csv(\"cleaned_data.csv\"); df.plot(); plt.savefig(\"report.png\")'"
}

步骤 8：退出 Shell
[调用 docker.shell.exit]
{
  "container": "data-pipeline"
}

完成！数据处理流水线已执行，结果保存在 /Users/me/data/ 目录。
```

**分析：** 复杂的多步流水线，需要保持状态和环境。

---

## 示例 9：性能测试

### 用户请求

```
用户：帮我测试这个 API 的性能
```

### AI 响应

```
AI：好的，我来测试 API 性能。

[调用 docker.run]
{
  "image": "alpine:latest",
  "script": "apk add --no-cache curl && for i in $(seq 1 100); do curl -s -w '%{time_total}\\n' -o /dev/null https://api.example.com/endpoint; done | awk '{sum+=$1; count++} END {print \"平均响应时间:\", sum/count, \"秒\"}'"
}

结果：
平均响应时间: 0.234 秒
```

**分析：** 单次测试任务，使用脚本执行。

---

## 示例 10：持续监控

### 用户请求

```
用户：帮我监控这个容器的资源使用情况
```

### AI 响应

```
AI：好的，我来监控容器资源使用。

步骤 1：进入容器
[调用 docker.shell.enter]
{
  "container": "my-app"
}

步骤 2：查看 CPU 使用
[调用 docker.shell.exec]
{
  "container": "my-app",
  "command": "top -bn1 | head -n 20"
}

步骤 3：查看内存使用
[调用 docker.shell.exec]
{
  "container": "my-app",
  "command": "free -h"
}

步骤 4：查看磁盘使用
[调用 docker.shell.exec]
{
  "container": "my-app",
  "command": "df -h"
}

步骤 5：查看网络连接
[调用 docker.shell.exec]
{
  "container": "my-app",
  "command": "netstat -tulpn"
}

步骤 6：退出 Shell
[调用 docker.shell.exit]
{
  "container": "my-app"
}

监控完成！容器资源使用正常。
```

**分析：** 多个监控命令，使用 Shell 会话连续执行。

---

## AI 决策流程

### 何时使用 `docker.run`（单次）？

```
if (任务只需执行一次 && 不需要保持状态) {
  使用 docker.run
}
```

**示例：**
- 执行脚本
- 编译项目
- 数据分析
- 性能测试

### 何时使用 `docker.shell.*`（交互式）？

```
if (需要多步操作 || 需要保持状态 || 需要调试) {
  使用 docker.shell.enter + docker.shell.exec
}
```

**示例：**
- Web 应用开发
- 数据库操作
- 调试应用
- 数据处理流水线
- 持续监控

### 何时使用 `docker.exec`（单次命令）？

```
if (容器已存在 && 只需执行一个命令 && 不需要保持状态) {
  使用 docker.exec
}
```

**示例：**
- 查看容器状态
- 重启服务
- 清理缓存

---

## 总结

AI 现在可以：

✅ **智能选择工具**
- 单次任务 → `docker.run`
- 多步操作 → `docker.shell.*`
- 简单命令 → `docker.exec`

✅ **像真人一样操作**
- 进入容器
- 执行命令
- 查看结果
- 调试问题

✅ **处理复杂场景**
- Web 应用开发
- 数据库操作
- 数据处理流水线
- 多容器协作

✅ **提供完整体验**
- 清晰的步骤说明
- 实时的结果反馈
- 友好的错误处理

现在，AI 可以**做任何需要 Docker 的事情**！🚀
