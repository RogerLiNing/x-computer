# Docker 通用容器管理工具 🐳

## 🎯 设计理念

**不限定任何语言或用途**，让 AI 可以用 Docker 做任何事情！

- ✅ 运行任意镜像（Node.js、Python、Nginx、MySQL、Redis...）
- ✅ 执行任意命令或脚本
- ✅ 后台运行服务或一次性任务
- ✅ 完整的容器生命周期管理
- ✅ 端口映射、卷挂载、环境变量
- ✅ AI 可以自由组合使用

## 🛠️ 可用工具

### 1. `docker.run` - 运行容器

创建并运行 Docker 容器，可以做任何事情。

**参数**：
- `image` (必需): Docker 镜像名称
- `command`: 命令数组（如 `["node", "app.js"]`）
- `script`: 脚本内容（会通过 `sh -c` 执行）
- `name`: 容器名称
- `workdir`: 工作目录
- `env`: 环境变量对象
- `volumes`: 卷挂载对象 `{"宿主机路径": "容器路径"}`
- `ports`: 端口映射对象 `{"容器端口": "宿主机端口"}`
- `detach`: 是否后台运行（默认 false）
- `timeout`: 超时毫秒数
- `memory`: 内存限制（字节）
- `cpus`: CPU 限制（核心数）
- `network`: 网络模式

### 2. `docker.list` - 列出容器

列出所有 Docker 容器。

**参数**：
- `all`: 是否显示所有容器（包括已停止的）

### 3. `docker.logs` - 查看日志

查看容器的日志输出。

**参数**：
- `container` (必需): 容器 ID 或名称
- `tail`: 只显示最后 N 行
- `since`: 只显示最近 N 秒的日志

### 4. `docker.stop` - 停止容器

停止运行中的容器。

**参数**：
- `container` (必需): 容器 ID 或名称
- `remove`: 是否删除容器（默认 true）
- `timeout`: 优雅停止的超时秒数

### 5. `docker.exec` - 在容器内执行命令

在运行中的容器内执行命令。

**参数**：
- `container` (必需): 容器 ID 或名称
- `command`: 命令数组
- `script`: 脚本内容
- `workdir`: 工作目录
- `timeout`: 超时毫秒数

### 6. `docker.pull` - 拉取镜像

拉取 Docker 镜像到本地。

**参数**：
- `image` (必需): 镜像名称

## 💡 使用场景示例

### 场景 1: 编译前端项目

```
用户：帮我用 Node.js 编译这个 React 项目

AI：好的，我来创建一个 Node.js 容器编译项目。

[调用 docker.run]
{
  image: "node:20-alpine",
  script: `
    npm install
    npm run build
  `,
  volumes: {
    "/Users/me/project": "/workspace"
  },
  workdir: "/workspace"
}

AI：编译完成！构建产物在 build 目录中。
```

### 场景 2: 运行 Web 服务器

```
用户：帮我启动一个 Nginx 服务器，端口 8080

AI：好的，我来启动 Nginx 容器。

[调用 docker.run]
{
  image: "nginx:alpine",
  name: "my-nginx",
  ports: {
    "80": "8080"
  },
  volumes: {
    "/Users/me/html": "/usr/share/nginx/html"
  },
  detach: true
}

AI：Nginx 服务器已启动！访问 http://localhost:8080
```

### 场景 3: 数据库容器

```
用户：启动一个 MySQL 数据库

AI：好的，我来启动 MySQL 容器。

[调用 docker.run]
{
  image: "mysql:8",
  name: "my-mysql",
  env: {
    "MYSQL_ROOT_PASSWORD": "password123",
    "MYSQL_DATABASE": "mydb"
  },
  ports: {
    "3306": "3306"
  },
  detach: true
}

AI：MySQL 已启动！连接信息：
- 主机: localhost:3306
- 数据库: mydb
- 密码: password123
```

### 场景 4: 定时任务

```
用户：写一个脚本每小时备份数据库

AI：好的，我来创建一个定时备份脚本。

[调用 file.write]
创建 backup.sh 脚本

[调用 docker.run]
{
  image: "alpine:latest",
  script: `
    apk add --no-cache mysql-client dcron
    echo "0 * * * * /backup.sh" > /etc/crontabs/root
    crond -f
  `,
  volumes: {
    "/Users/me/backup.sh": "/backup.sh",
    "/Users/me/backups": "/backups"
  },
  name: "backup-cron",
  detach: true
}

AI：定时备份已设置！每小时自动备份一次。
```

### 场景 5: Python 数据分析

```
用户：用 Python 分析这个 CSV 文件

AI：好的，我来运行 Python 分析脚本。

[调用 docker.run]
{
  image: "python:3.11-slim",
  script: `
    pip install pandas matplotlib
    python3 << 'EOF'
import pandas as pd
df = pd.read_csv('/data/data.csv')
print(df.describe())
EOF
  `,
  volumes: {
    "/Users/me/data": "/data"
  }
}

AI：分析完成！数据统计如下：...
```

### 场景 6: 容器化开发环境

```
用户：给我创建一个 Go 开发环境

AI：好的，我来创建 Go 开发容器。

[调用 docker.run]
{
  image: "golang:1.21-alpine",
  name: "go-dev",
  script: "tail -f /dev/null",  // 保持运行
  volumes: {
    "/Users/me/go-project": "/workspace"
  },
  workdir: "/workspace",
  detach: true
}

AI：Go 开发环境已就绪！
使用 docker.exec 在容器内执行命令：
- 编译: go build
- 运行: go run main.go
```

### 场景 7: 多容器应用

```
用户：帮我搭建一个 WordPress 环境

AI：好的，我来创建 MySQL 和 WordPress 容器。

[调用 docker.run - MySQL]
{
  image: "mysql:8",
  name: "wordpress-db",
  env: {
    "MYSQL_ROOT_PASSWORD": "rootpass",
    "MYSQL_DATABASE": "wordpress",
    "MYSQL_USER": "wpuser",
    "MYSQL_PASSWORD": "wppass"
  },
  detach: true
}

[调用 docker.run - WordPress]
{
  image: "wordpress:latest",
  name: "wordpress",
  env: {
    "WORDPRESS_DB_HOST": "wordpress-db:3306",
    "WORDPRESS_DB_USER": "wpuser",
    "WORDPRESS_DB_PASSWORD": "wppass",
    "WORDPRESS_DB_NAME": "wordpress"
  },
  ports: {
    "80": "8080"
  },
  detach: true
}

AI：WordPress 环境已搭建完成！
访问 http://localhost:8080 开始配置。
```

### 场景 8: 容器管理

```
用户：查看所有运行中的容器

AI：好的，我来查看容器列表。

[调用 docker.list]
{
  all: false
}

AI：当前运行中的容器：
1. my-nginx (nginx:alpine) - 运行 2 小时
2. my-mysql (mysql:8) - 运行 1 天
3. wordpress (wordpress:latest) - 运行 30 分钟

---

用户：查看 nginx 的日志

AI：好的，我来查看日志。

[调用 docker.logs]
{
  container: "my-nginx",
  tail: 50
}

AI：最近 50 行日志：...

---

用户：停止 nginx 容器

AI：好的，我来停止容器。

[调用 docker.stop]
{
  container: "my-nginx",
  remove: true
}

AI：nginx 容器已停止并删除。
```

## 🎨 AI 如何使用

AI 可以自由组合这些工具来完成复杂任务：

### 完整工作流示例

```
用户：帮我部署一个 Node.js 应用

AI 的思考过程：
1. 先拉取镜像（可选，加快速度）
2. 运行容器安装依赖
3. 启动应用服务
4. 查看日志确认启动成功

[步骤 1: 拉取镜像]
docker.pull({ image: "node:20-alpine" })

[步骤 2: 安装依赖]
docker.run({
  image: "node:20-alpine",
  script: "npm install",
  volumes: { "/path/to/app": "/workspace" },
  workdir: "/workspace"
})

[步骤 3: 启动应用]
docker.run({
  image: "node:20-alpine",
  name: "my-app",
  script: "npm start",
  volumes: { "/path/to/app": "/workspace" },
  workdir: "/workspace",
  ports: { "3000": "3000" },
  env: { "NODE_ENV": "production" },
  detach: true
})

[步骤 4: 查看日志]
docker.logs({
  container: "my-app",
  tail: 20
})

AI：应用已成功部署！访问 http://localhost:3000
```

## 🔄 容器生命周期管理

### 前台模式（一次性任务）

```typescript
docker.run({
  image: "python:3.11",
  script: "python -c 'print(2+2)'",
  detach: false  // 默认，执行完自动删除
})

// 返回：
{
  mode: "executed",
  exitCode: 0,
  stdout: "4\n",
  duration: 1234
}
```

### 后台模式（长期运行）

```typescript
docker.run({
  image: "nginx:alpine",
  name: "web-server",
  ports: { "80": "8080" },
  detach: true  // 后台运行
})

// 返回：
{
  mode: "detached",
  containerId: "abc123",
  name: "web-server",
  status: "running"
}

// 后续管理：
docker.logs({ container: "web-server" })
docker.exec({ container: "web-server", script: "nginx -s reload" })
docker.stop({ container: "web-server" })
```

## 🎯 与旧方案的区别

| 特性 | 旧方案（限定语言） | 新方案（通用容器） |
|------|-------------------|-------------------|
| **设计理念** | 为特定语言提供工具 | 通用容器管理 |
| **工具数量** | 4 个（nodejs/python/bash/custom） | 6 个（run/list/logs/stop/exec/pull） |
| **灵活性** | 有限（预定义模板） | 完全（任意镜像和命令） |
| **适用场景** | 代码执行 | 任何需要 Docker 的场景 |
| **容器管理** | 无（用完即删） | 完整（创建/查看/停止/执行） |
| **后台运行** | 不支持 | 支持 |
| **端口映射** | 不支持 | 支持 |
| **卷挂载** | 不支持 | 支持 |

## 🚀 优势

### 1. 完全自由

AI 可以：
- 运行任意 Docker 镜像
- 执行任意命令
- 组合多个容器
- 管理容器生命周期

### 2. 真实场景

可以做真实的事情：
- 部署 Web 应用
- 运行数据库
- 编译项目
- 定时任务
- 开发环境

### 3. 简单易用

AI 只需要知道：
- `docker.run` - 运行容器
- `docker.list` - 查看容器
- `docker.logs` - 查看日志
- `docker.stop` - 停止容器
- `docker.exec` - 执行命令
- `docker.pull` - 拉取镜像

## 🔒 安全性

- ✅ 权限控制：需要 `docker` 权限
- ✅ 资源限制：内存、CPU 限制
- ✅ 网络隔离：可选网络模式
- ✅ 风险等级：标记为 medium/high
- ✅ 容器隔离：每个容器独立运行

## 📚 总结

这个通用的 Docker 容器管理工具让 AI 可以：

- ✅ **不受限制**：运行任意镜像，执行任意命令
- ✅ **真实场景**：部署应用、运行服务、编译项目
- ✅ **完整管理**：创建、查看、停止、执行、拉取
- ✅ **灵活组合**：AI 可以自由组合工具完成复杂任务
- ✅ **简单易用**：6 个工具覆盖所有需求

**AI 现在可以用 Docker 做任何事情了！** 🎉
