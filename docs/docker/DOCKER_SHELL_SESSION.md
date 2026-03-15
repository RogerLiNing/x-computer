# Docker 交互式 Shell 会话

## 概述

X-Computer 现在支持**交互式 Shell 会话**，让 AI 可以像真人一样进入 Docker 容器，持续执行命令并查看结果。

### 与 `docker.exec` 的区别

| 特性 | `docker.exec` | `docker.shell.*` |
|------|---------------|------------------|
| **执行方式** | 每次独立执行 | 持久化 Shell 会话 |
| **工作目录** | 每次重置 | 保持（cd 后目录会保持） |
| **环境变量** | 每次重置 | 保持（export 后变量会保持） |
| **状态连续性** | ❌ 无 | ✅ 有 |
| **使用场景** | 单次命令 | 多步操作、调试、开发 |

## 工具列表

### 1. `docker.shell.enter` - 进入容器

创建一个持久化的 Shell 会话。

**参数：**
- `container` (string, 必需): 容器 ID 或名称
- `workdir` (string, 可选): 初始工作目录
- `shell` (string, 可选): Shell 类型（/bin/sh, /bin/bash 等），默认 /bin/sh

**返回：**
```json
{
  "sessionId": "user123-abc123",
  "containerId": "abc123",
  "shell": "/bin/sh",
  "workdir": "/workspace",
  "message": "已进入容器 abc123，当前目录：/workspace"
}
```

### 2. `docker.shell.exec` - 执行命令

在已建立的 Shell 会话中执行命令。

**参数：**
- `container` (string, 必需): 容器 ID 或名称
- `command` (string, 必需): 要执行的命令
- `timeout` (number, 可选): 超时毫秒数（默认 30000）

**返回：**
```json
{
  "command": "ls -la",
  "output": "total 8\ndrwxr-xr-x 2 root root 4096 ...",
  "duration": 123,
  "success": true
}
```

**特殊功能：**
- ✅ **后台执行**：命令以 `&` 结尾或使用 `nohup` 时，不会堵塞
- ✅ **自动检测**：自动识别后台命令，使用较短超时（5秒）

**示例：**
```typescript
// 后台启动应用（不会堵塞）
await docker.shell.exec({
  container: "web-app",
  command: "node app.js &"
});

// 使用 nohup（即使 Shell 关闭也继续运行）
await docker.shell.exec({
  container: "web-app",
  command: "nohup python server.py > /var/log/server.log 2>&1 &"
});
```

### 3. `docker.shell.interactive` - 交互式命令 🆕

执行交互式程序（如数据库客户端）。

**参数：**
- `container` (string, 必需): 容器 ID 或名称
- `program` (string, 必需): 交互式程序（如 "mysql -uroot -ppassword"）
- `commands` (array, 必需): 要执行的命令数组
- `timeout` (number, 可选): 超时毫秒数（默认 30000）

**返回：**
```json
{
  "program": "mysql -uroot -ppassword",
  "commandCount": 3,
  "output": "+----+-------+\n| id | name  |\n+----+-------+\n|  1 | Alice |\n|  2 | Bob   |\n+----+-------+",
  "duration": 456,
  "success": true
}
```

**支持的程序：**
- MySQL: `mysql -uroot -p`
- PostgreSQL: `psql -U postgres`
- Redis: `redis-cli`
- MongoDB: `mongo`
- 任何其他交互式命令行工具

**示例：**
```typescript
// MySQL 数据库操作
await docker.shell.interactive({
  container: "mysql-db",
  program: "mysql -uroot -ppassword",
  commands: [
    "SHOW DATABASES;",
    "USE mydb;",
    "SELECT * FROM users;"
  ]
});

// PostgreSQL 操作
await docker.shell.interactive({
  container: "postgres-db",
  program: "psql -U postgres",
  commands: [
    "\\l",
    "CREATE DATABASE mydb;",
    "\\c mydb",
    "SELECT * FROM users;"
  ]
});

// Redis 操作
await docker.shell.interactive({
  container: "redis-cache",
  program: "redis-cli",
  commands: [
    "SET key1 'value1'",
    "GET key1",
    "KEYS *"
  ]
});
```

### 4. `docker.shell.exit` - 退出会话

关闭 Shell 会话，释放资源。

**参数：**
- `container` (string, 必需): 容器 ID 或名称

**返回：**
```json
{
  "sessionId": "user123-abc123",
  "containerId": "abc123",
  "message": "Shell 会话已关闭"
}
```

### 5. `docker.shell.list` - 列出会话

列出所有活跃的 Shell 会话。

**返回：**
```json
{
  "count": 2,
  "sessions": [
    {
      "sessionId": "user123-abc123",
      "containerId": "abc123",
      "active": true
    },
    {
      "sessionId": "user123-def456",
      "containerId": "def456",
      "active": true
    }
  ]
}
```

## 使用示例

### 示例 1：Web 应用开发

```
用户：帮我在 Docker 里搭建一个 Node.js 项目

AI：
1. docker.run
   - image: "node:20"
   - detach: true
   - name: "web-dev"
   - ports: {"3000": "3000"}
   
2. docker.shell.enter
   - container: "web-dev"
   - workdir: "/workspace"
   
3. docker.shell.exec
   - container: "web-dev"
   - command: "npm init -y"
   
4. docker.shell.exec
   - container: "web-dev"
   - command: "npm install express"
   
5. docker.shell.exec
   - container: "web-dev"
   - command: "cat > app.js << 'EOF'
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Hello World!'));
app.listen(3000, () => console.log('Server running on port 3000'));
EOF"
   
6. docker.shell.exec
   - container: "web-dev"
   - command: "node app.js &"
   
7. docker.shell.exit
   - container: "web-dev"
```

### 示例 2：Python 数据分析

```
用户：帮我分析这个 CSV 文件

AI：
1. docker.run
   - image: "python:3.11"
   - detach: true
   - name: "data-analysis"
   - volumes: {"/Users/user/data": "/data"}
   
2. docker.shell.enter
   - container: "data-analysis"
   - workdir: "/data"
   
3. docker.shell.exec
   - container: "data-analysis"
   - command: "pip install pandas matplotlib"
   
4. docker.shell.exec
   - container: "data-analysis"
   - command: "python -c 'import pandas as pd; df = pd.read_csv(\"data.csv\"); print(df.describe())'"
   
5. docker.shell.exec
   - container: "data-analysis"
   - command: "python -c 'import pandas as pd; import matplotlib.pyplot as plt; df = pd.read_csv(\"data.csv\"); df.plot(); plt.savefig(\"plot.png\")'"
   
6. docker.shell.exec
   - container: "data-analysis"
   - command: "ls -lh plot.png"
   
7. docker.shell.exit
   - container: "data-analysis"
```

### 示例 3：调试应用

```
用户：我的应用报错了，帮我看看

AI：
1. docker.shell.enter
   - container: "my-app"
   
2. docker.shell.exec
   - container: "my-app"
   - command: "cd /app"
   
3. docker.shell.exec
   - container: "my-app"
   - command: "ls -la"
   
4. docker.shell.exec
   - container: "my-app"
   - command: "cat package.json"
   
5. docker.shell.exec
   - container: "my-app"
   - command: "npm install"
   
6. docker.shell.exec
   - container: "my-app"
   - command: "npm test"
   
7. docker.shell.exec
   - container: "my-app"
   - command: "tail -n 50 /var/log/app.log"
   
8. docker.shell.exit
   - container: "my-app"
```

### 示例 4：数据库操作

```
用户：帮我在 MySQL 里创建表并导入数据

AI：
1. docker.run
   - image: "mysql:8"
   - detach: true
   - name: "mysql-db"
   - env: {"MYSQL_ROOT_PASSWORD": "password"}
   - ports: {"3306": "3306"}
   
2. docker.shell.exec
   - container: "mysql-db"
   - command: "sleep 10"  # 等待 MySQL 启动
   
3. docker.shell.enter
   - container: "mysql-db"
   
4. docker.shell.exec
   - container: "mysql-db"
   - command: "mysql -uroot -ppassword -e 'CREATE DATABASE mydb;'"
   
5. docker.shell.exec
   - container: "mysql-db"
   - command: "mysql -uroot -ppassword -e 'USE mydb; CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100));'"
   
6. docker.shell.exec
   - container: "mysql-db"
   - command: "mysql -uroot -ppassword -e 'USE mydb; INSERT INTO users VALUES (1, \"Alice\"), (2, \"Bob\");'"
   
7. docker.shell.exec
   - container: "mysql-db"
   - command: "mysql -uroot -ppassword -e 'USE mydb; SELECT * FROM users;'"
   
8. docker.shell.exit
   - container: "mysql-db"
```

## 技术实现

### 核心类：`DockerShellSession`

```typescript
class DockerShellSession {
  // 启动交互式 Shell 会话
  async start(): Promise<void>
  
  // 执行命令
  async execute(command: string, timeoutMs?: number): Promise<CommandResult>
  
  // 获取当前工作目录
  async pwd(): Promise<string>
  
  // 改变工作目录
  async cd(path: string): Promise<void>
  
  // 获取命令历史
  getHistory(): CommandResult[]
  
  // 关闭会话
  async close(): Promise<void>
  
  // 检查会话是否活跃
  isActive(): boolean
}
```

### 会话管理器：`DockerShellSessionManager`

```typescript
class DockerShellSessionManager {
  // 创建或获取会话
  async getOrCreateSession(sessionId: string, config: ShellSessionConfig): Promise<DockerShellSession>
  
  // 获取会话
  getSession(sessionId: string): DockerShellSession | undefined
  
  // 关闭会话
  async closeSession(sessionId: string): Promise<void>
  
  // 关闭所有会话
  async closeAll(): Promise<void>
  
  // 列出所有会话
  listSessions(): Array<{ sessionId: string; containerId: string; active: boolean }>
}
```

### 工作原理

1. **TTY 模式**：使用 Docker Exec API 的 TTY 模式创建交互式终端
2. **持久化流**：保持 stdin/stdout/stderr 流的连接
3. **命令提示符检测**：通过正则表达式检测命令提示符（`$`, `#`, `>`）来判断命令是否完成
4. **会话隔离**：每个用户每个容器一个独立会话（sessionId = `${userId}-${containerId}`）
5. **自动清理**：会话关闭时自动释放资源

## 最佳实践

### 1. 何时使用 Shell 会话？

✅ **适合使用 Shell 会话：**
- 需要多步操作（如安装依赖、编译、测试）
- 需要保持工作目录（cd 后继续操作）
- 需要保持环境变量（export 后继续使用）
- 调试和开发场景
- 交互式操作（如数据库命令行）

❌ **不适合使用 Shell 会话：**
- 单次命令执行（用 `docker.exec`）
- 不需要状态连续性的操作
- 短期任务（用 `docker.run` 的 foreground 模式）

### 2. 资源管理

```typescript
// ✅ 好的做法：完成后关闭会话
await docker.shell.enter({ container: "my-app" });
await docker.shell.exec({ container: "my-app", command: "npm install" });
await docker.shell.exec({ container: "my-app", command: "npm test" });
await docker.shell.exit({ container: "my-app" });

// ❌ 不好的做法：忘记关闭会话
await docker.shell.enter({ container: "my-app" });
await docker.shell.exec({ container: "my-app", command: "npm install" });
// 忘记调用 docker.shell.exit
```

### 3. 错误处理

```typescript
// ✅ 好的做法：捕获错误并关闭会话
try {
  await docker.shell.enter({ container: "my-app" });
  await docker.shell.exec({ container: "my-app", command: "risky-command" });
} catch (error) {
  console.error("命令执行失败:", error);
} finally {
  await docker.shell.exit({ container: "my-app" });
}
```

### 4. 超时设置

```typescript
// ✅ 好的做法：为长时间运行的命令设置合理的超时
await docker.shell.exec({
  container: "my-app",
  command: "npm install",
  timeout: 120000  // 2 分钟
});

// ❌ 不好的做法：使用默认超时可能导致长时间命令被中断
await docker.shell.exec({
  container: "my-app",
  command: "npm install"  // 默认 30 秒可能不够
});
```

## 与其他 Docker 工具的配合

### 完整工作流

```
1. docker.run (detach: true)       # 创建并启动容器
2. docker.shell.enter              # 进入容器 Shell
3. docker.shell.exec (多次)        # 执行多个命令
4. docker.shell.exit               # 退出 Shell
5. docker.logs                     # 查看容器日志
6. docker.stop                     # 停止容器（如需要）
```

### 工具对比

| 工具 | 用途 | 状态保持 |
|------|------|----------|
| `docker.run` | 创建并运行容器 | - |
| `docker.exec` | 单次命令执行 | ❌ |
| `docker.shell.enter` | 进入交互式 Shell | ✅ |
| `docker.shell.exec` | 在 Shell 中执行命令 | ✅ |
| `docker.shell.exit` | 退出 Shell | - |
| `docker.logs` | 查看容器日志 | - |
| `docker.stop` | 停止容器 | - |

## 安全考虑

### 1. 权限控制

所有 Shell 工具都需要 `docker` 权限：

```typescript
requiredPermissions: ['docker']
```

### 2. 会话隔离

每个用户的会话是隔离的：

```typescript
sessionId = `${userId}-${containerId}`
```

用户 A 无法访问用户 B 的 Shell 会话。

### 3. 超时保护

所有命令都有超时限制（默认 30 秒，最大 5 分钟）：

```typescript
const timeout = Math.min(300000, Math.max(5000, Number(input.timeout) || 30000));
```

### 4. 输出限制

输出内容限制在 50KB 以内：

```typescript
output: result.output.slice(0, 50000)
```

## 故障排除

### 问题 1：会话未找到

**错误：** `没有找到活跃的 Shell 会话`

**解决：** 先调用 `docker.shell.enter` 创建会话

### 问题 2：命令超时

**错误：** `Timeout waiting for prompt`

**解决：** 增加 `timeout` 参数或检查命令是否需要交互式输入

### 问题 3：容器不存在

**错误：** `Failed to start shell session`

**解决：** 确保容器正在运行，使用 `docker.list` 检查

### 问题 4：Shell 类型不支持

**错误：** `Shell not found`

**解决：** 使用容器支持的 Shell（如 `/bin/sh` 或 `/bin/bash`）

## 总结

Docker 交互式 Shell 会话让 AI 可以：

✅ **像真人一样操作容器**
- 进入容器
- 持续执行命令
- 查看实时结果
- 保持状态连续性

✅ **适用于复杂场景**
- 多步开发流程
- 调试和排错
- 数据库操作
- 交互式工具使用

✅ **与现有工具完美配合**
- `docker.run` 创建容器
- `docker.shell.*` 交互式操作
- `docker.logs` 查看日志
- `docker.stop` 停止容器

现在，X-Computer 拥有了完整的 Docker 管理能力，可以应对任何需要容器化的场景！
