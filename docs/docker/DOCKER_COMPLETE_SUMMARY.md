# Docker 完整功能总结

## 概述

X-Computer 现在拥有**完整的 Docker 管理能力**，包括：

1. **通用 Docker 管理**（6 个工具）
2. **交互式 Shell 会话**（4 个工具）
3. **底层任务执行器**（DockerTaskRunner）

## 功能矩阵

### 1. 通用 Docker 管理工具

| 工具 | 功能 | 使用场景 |
|------|------|----------|
| `docker.run` | 创建并运行容器 | 任意镜像、任意命令、任意配置 |
| `docker.list` | 列出容器 | 查看所有容器状态 |
| `docker.logs` | 查看日志 | 监控容器输出 |
| `docker.stop` | 停止容器 | 停止后台服务 |
| `docker.exec` | 执行单个命令 | 在运行容器中执行命令 |
| `docker.pull` | 拉取镜像 | 预拉取或更新镜像 |

### 2. 交互式 Shell 会话工具

| 工具 | 功能 | 使用场景 |
|------|------|----------|
| `docker.shell.enter` | 进入容器 Shell | 创建持久化会话 |
| `docker.shell.exec` | 执行命令 | 在会话中执行命令（保持状态） |
| `docker.shell.exit` | 退出 Shell | 关闭会话，释放资源 |
| `docker.shell.list` | 列出会话 | 查看所有活跃会话 |

### 3. 底层任务执行器

| 组件 | 功能 | 使用场景 |
|------|------|----------|
| `DockerTaskRunner` | 执行 Docker 任务 | 代码执行、数据处理 |
| `DockerShellSession` | 管理 Shell 会话 | 交互式操作 |
| `DockerShellSessionManager` | 管理多个会话 | 多用户、多容器 |

## 完整工作流

### 工作流 1：单次任务执行

```
用户：帮我用 Python 计算斐波那契数列

AI：
1. docker.run
   - image: "python:3.11"
   - script: "def fib(n): ..."
   - 自动删除容器
```

**特点：**
- ✅ 简单快速
- ✅ 自动清理
- ✅ 适合单次任务

### 工作流 2：后台服务 + 单次命令

```
用户：启动一个 Web 服务器

AI：
1. docker.run
   - image: "nginx:alpine"
   - detach: true
   - ports: {"80": "8080"}
   
2. docker.exec
   - container: "nginx"
   - command: "nginx -t"
   
3. docker.logs
   - container: "nginx"
```

**特点：**
- ✅ 后台运行
- ✅ 端口映射
- ✅ 单次命令（无状态）

### 工作流 3：交互式开发（新功能！）

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
   
3. docker.shell.exec
   - command: "npm init -y"
   
4. docker.shell.exec
   - command: "npm install express"
   
5. docker.shell.exec
   - command: "cat > app.js << 'EOF' ..."
   
6. docker.shell.exec
   - command: "node app.js &"
   
7. docker.shell.exit
   - container: "web-dev"
```

**特点：**
- ✅ 多步操作
- ✅ 保持状态（工作目录、环境变量）
- ✅ 像真人操作终端
- ✅ 适合复杂场景

## 对比：Shell 会话 vs 单次执行

| 特性 | `docker.exec` | `docker.shell.*` |
|------|---------------|------------------|
| **执行方式** | 每次独立执行 | 持久化 Shell 会话 |
| **工作目录** | 每次重置 | 保持（cd 后目录会保持） |
| **环境变量** | 每次重置 | 保持（export 后变量会保持） |
| **状态连续性** | ❌ 无 | ✅ 有 |
| **使用场景** | 单次命令 | 多步操作、调试、开发 |
| **资源占用** | 低（即时释放） | 中（会话保持） |
| **复杂度** | 简单 | 稍复杂（需要 enter/exit） |

## 使用决策树

```
需要执行 Docker 任务？
│
├─ 单次命令？
│  ├─ 容器不存在？ → docker.run (foreground)
│  └─ 容器已存在？ → docker.exec
│
└─ 多步操作？
   ├─ 需要保持状态？ → docker.shell.enter + docker.shell.exec
   └─ 不需要状态？ → 多次 docker.exec
```

## 实际应用场景

### 场景 1：Web 应用开发

**需求：** 搭建 Node.js 项目，安装依赖，启动服务

**方案：** Shell 会话

```typescript
docker.run({ image: "node:20", detach: true, name: "web-dev" })
docker.shell.enter({ container: "web-dev" })
docker.shell.exec({ command: "npm init -y" })
docker.shell.exec({ command: "npm install express" })
docker.shell.exec({ command: "node app.js &" })
docker.shell.exit({ container: "web-dev" })
```

### 场景 2：数据分析

**需求：** 分析 CSV 文件，生成图表

**方案：** 单次执行

```typescript
docker.run({
  image: "python:3.11",
  script: "import pandas as pd; df = pd.read_csv('data.csv'); print(df.describe())",
  volumes: { "/Users/me/data": "/data" }
})
```

### 场景 3：数据库操作

**需求：** 创建数据库，创建表，插入数据

**方案：** Shell 会话

```typescript
docker.run({ image: "mysql:8", detach: true, name: "mysql-db" })
docker.shell.enter({ container: "mysql-db" })
docker.shell.exec({ command: "mysql -e 'CREATE DATABASE mydb;'" })
docker.shell.exec({ command: "mysql -e 'USE mydb; CREATE TABLE users ...'" })
docker.shell.exec({ command: "mysql -e 'USE mydb; INSERT INTO users ...'" })
docker.shell.exit({ container: "mysql-db" })
```

### 场景 4：编译项目

**需求：** 编译 Go 项目

**方案：** 单次执行

```typescript
docker.run({
  image: "golang:1.21",
  command: ["go", "build", "-o", "app", "main.go"],
  volumes: { "/Users/me/project": "/workspace" }
})
```

### 场景 5：调试应用

**需求：** 查看日志，检查进程，修复问题

**方案：** Shell 会话

```typescript
docker.shell.enter({ container: "app" })
docker.shell.exec({ command: "tail -n 100 /var/log/app.log" })
docker.shell.exec({ command: "ps aux" })
docker.shell.exec({ command: "systemctl restart app" })
docker.shell.exit({ container: "app" })
```

## 技术架构

### 层次结构

```
┌─────────────────────────────────────────┐
│          AI 工具层（ToolExecutor）        │
│  docker.run, docker.shell.enter, etc.   │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│           管理层（Managers）              │
│  DockerShellSessionManager              │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│           执行层（Executors）             │
│  DockerTaskRunner, DockerShellSession   │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│           Docker API（dockerode）        │
└─────────────────────────────────────────┘
```

### 核心类

#### 1. DockerTaskRunner

```typescript
class DockerTaskRunner {
  async runTask(config: DockerTaskConfig): Promise<DockerTaskResult>
  static templates = { nodejs, python, bash, go, rust }
}
```

**用途：** 执行单次 Docker 任务

#### 2. DockerShellSession

```typescript
class DockerShellSession {
  async start(): Promise<void>
  async execute(command: string): Promise<CommandResult>
  async pwd(): Promise<string>
  async cd(path: string): Promise<void>
  async close(): Promise<void>
  isActive(): boolean
}
```

**用途：** 管理单个 Shell 会话

#### 3. DockerShellSessionManager

```typescript
class DockerShellSessionManager {
  async getOrCreateSession(sessionId: string, config: ShellSessionConfig): Promise<DockerShellSession>
  getSession(sessionId: string): DockerShellSession | undefined
  async closeSession(sessionId: string): Promise<void>
  async closeAll(): Promise<void>
  listSessions(): Array<{ sessionId: string; containerId: string; active: boolean }>
}
```

**用途：** 管理多个用户的 Shell 会话

## 安全特性

### 1. 权限控制

所有 Docker 工具都需要 `docker` 权限：

```typescript
requiredPermissions: ['docker']
```

### 2. 资源限制

```typescript
docker.run({
  memory: 512 * 1024 * 1024,  // 512MB
  cpus: 0.5,                   // 0.5 核心
  timeout: 300000              // 5 分钟
})
```

### 3. 网络隔离

```typescript
docker.run({
  network: 'none'  // 无网络访问
})
```

### 4. 会话隔离

每个用户的 Shell 会话是隔离的：

```typescript
sessionId = `${userId}-${containerId}`
```

### 5. 自动清理

- 单次任务：自动删除容器
- Shell 会话：手动关闭释放资源

## 性能优化

### 1. 镜像预拉取

```bash
docker pull node:20-alpine
docker pull python:3.11-slim
docker pull alpine:latest
```

### 2. 使用轻量级镜像

```typescript
// ✅ 好
docker.run({ image: "node:20-alpine" })

// ❌ 不好
docker.run({ image: "node:20" })  // 体积大 3-5 倍
```

### 3. 复用容器

```typescript
// 创建一次，多次使用
docker.run({ image: "node:20", detach: true, name: "dev" })
docker.shell.enter({ container: "dev" })
// ... 多次操作 ...
docker.shell.exit({ container: "dev" })
```

### 4. 并发控制

```typescript
// 限制同时运行的容器数
const maxConcurrent = 5;
```

## 最佳实践

### 1. 选择合适的工具

```typescript
// ✅ 单次任务 → docker.run
docker.run({ image: "python:3.11", script: "print('hello')" })

// ✅ 多步操作 → docker.shell.*
docker.shell.enter({ container: "dev" })
docker.shell.exec({ command: "npm install" })
docker.shell.exec({ command: "npm test" })
docker.shell.exit({ container: "dev" })
```

### 2. 总是关闭会话

```typescript
try {
  await docker.shell.enter({ container: "app" });
  // ... 操作 ...
} finally {
  await docker.shell.exit({ container: "app" });
}
```

### 3. 设置合理的超时

```typescript
docker.shell.exec({
  container: "app",
  command: "npm install",
  timeout: 120000  // 2 分钟
})
```

### 4. 使用卷挂载共享文件

```typescript
docker.run({
  image: "node:20",
  detach: true,
  volumes: { "/Users/me/project": "/workspace" }
})
```

### 5. 监控容器日志

```typescript
// 定期检查日志
docker.logs({ container: "app", tail: 100 })
```

## 文档索引

### 快速入门

- [Docker Shell 快速入门](./DOCKER_SHELL_QUICKSTART.md)
- [Docker 交互式 Shell 会话](./DOCKER_SHELL_SESSION.md)

### 详细文档

- [Docker 任务执行器](./docs/DOCKER_TASK_RUNNER.md)
- [Docker 通用工具](./DOCKER_UNIVERSAL_TOOLS.md)
- [Docker 持久化使用](./DOCKER_PERSISTENT_USAGE.md)
- [Docker 交互指南](./DOCKER_INTERACTION_GUIDE.md)

### 代码示例

- [工具集成示例](./server/src/docker/docker-tool-integration.example.ts)
- [Shell 工具定义](./server/src/orchestrator/tools/docker/shell.ts)
- [管理工具定义](./server/src/orchestrator/tools/docker/manage.ts)

### 测试

- [DockerTaskRunner 测试](./server/src/docker/DockerTaskRunner.test.ts)
- [DockerShellSession 测试](./server/src/docker/DockerShellSession.test.ts)

## 总结

X-Computer 现在拥有**完整的 Docker 管理能力**：

### ✅ 功能完整

- 10 个 Docker 工具（6 个通用 + 4 个 Shell）
- 支持任意镜像、任意命令、任意配置
- 单次执行 + 交互式会话

### ✅ 灵活强大

- 适用于任何需要 Docker 的场景
- 从简单脚本到复杂开发流程
- 像真人一样操作容器

### ✅ 安全可靠

- 权限控制
- 资源限制
- 会话隔离
- 自动清理

### ✅ 易于使用

- 清晰的工具定义
- 完善的文档
- 丰富的示例
- 完整的测试

现在，AI 可以**做任何需要 Docker 的事情**！🚀
