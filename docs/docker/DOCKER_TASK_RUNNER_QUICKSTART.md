# Docker 任务执行器 - 快速开始

## 🎯 这是什么？

一个灵活的 Docker 任务执行系统，让 AI 能够在隔离的容器中执行各种代码和任务。

### 核心特性

- ✅ **按需创建容器**：需要时创建，用完即删
- ✅ **多语言支持**：Node.js、Python、Bash、Go、Rust 等
- ✅ **灵活配置**：自定义镜像、环境变量、资源限制
- ✅ **安全隔离**：每个任务独立容器，资源限制
- ✅ **简单易用**：预定义模板，一行代码执行

## 🚀 快速开始（3 步）

### 1. 安装依赖

```bash
cd server
npm install dockerode @types/dockerode
```

### 2. 确保 Docker 运行

```bash
# 检查 Docker 是否运行
docker ps

# 如果没有运行，启动 Docker
# macOS: 打开 Docker Desktop
# Linux: sudo systemctl start docker
```

### 3. 运行示例

```bash
# 运行测试
npm test -- DockerTaskRunner.test.ts

# 或运行集成示例
npx tsx src/docker/docker-tool-integration.example.ts
```

## 💡 基础使用

### 示例 1: 执行 Node.js 代码

```typescript
import { DockerTaskRunner } from './src/docker/DockerTaskRunner.js';

const runner = new DockerTaskRunner();

const result = await runner.runTask(
  DockerTaskRunner.templates.nodejs(`
    console.log('Hello from Docker!');
    console.log('2 + 2 =', 2 + 2);
  `)
);

console.log(result.stdout);
// 输出:
// Hello from Docker!
// 2 + 2 = 4
```

### 示例 2: 执行 Python 代码

```typescript
const result = await runner.runTask(
  DockerTaskRunner.templates.python(`
import json
data = {'message': 'Hello from Python', 'value': 42}
print(json.dumps(data))
  `)
);

console.log(result.stdout);
// 输出: {"message": "Hello from Python", "value": 42}
```

### 示例 3: 执行 Bash 脚本

```typescript
const result = await runner.runTask(
  DockerTaskRunner.templates.bash(`
echo "系统信息:"
uname -a
echo "当前时间:"
date
  `)
);

console.log(result.stdout);
```

## 🎨 使用场景

### 场景 1: 数据处理

```typescript
// 用 Python 处理 CSV 数据
const result = await runner.runTask(
  DockerTaskRunner.templates.python(`
import csv
import json

# 模拟数据
data = [
    {'name': 'Alice', 'age': 30},
    {'name': 'Bob', 'age': 25},
    {'name': 'Charlie', 'age': 35}
]

# 计算平均年龄
avg_age = sum(row['age'] for row in data) / len(data)
print(f'平均年龄: {avg_age}')
  `)
);
```

### 场景 2: 网络请求

```typescript
// 用 Python 爬取网页
const result = await runner.runTask(
  DockerTaskRunner.templates.python(
    `
import requests
import json

response = requests.get('https://api.github.com/repos/microsoft/vscode')
data = response.json()
print(json.dumps({
    'name': data['full_name'],
    'stars': data['stargazers_count']
}, indent=2))
    `,
    {
      timeout: 30000, // 30 秒超时
    }
  )
);
```

### 场景 3: 系统命令

```typescript
// 检查磁盘使用
const result = await runner.runTask(
  DockerTaskRunner.templates.bash(`
df -h | head -5
echo ""
free -h
  `)
);
```

### 场景 4: 自定义镜像

```typescript
// 使用特定的 Docker 镜像
const result = await runner.runTask({
  image: 'tensorflow/tensorflow:latest-py3',
  script: `
import tensorflow as tf
print('TensorFlow version:', tf.__version__)
  `,
  memory: 1024 * 1024 * 1024, // 1GB
  timeout: 120000, // 2 分钟
});
```

## 🔧 高级配置

### 环境变量

```typescript
const result = await runner.runTask(
  DockerTaskRunner.templates.nodejs(
    `
console.log('API Key:', process.env.API_KEY);
console.log('Database:', process.env.DB_URL);
  `,
    {
      env: {
        API_KEY: 'secret-123',
        DB_URL: 'postgresql://localhost/mydb',
      },
    }
  )
);
```

### 资源限制

```typescript
const result = await runner.runTask(
  DockerTaskRunner.templates.python(
    `
import numpy as np
arr = np.random.rand(1000, 1000)
print('Array shape:', arr.shape)
  `,
    {
      memory: 256 * 1024 * 1024, // 256MB
      cpus: 0.5, // 0.5 核心
      timeout: 30000, // 30 秒
    }
  )
);
```

### 卷挂载

```typescript
const result = await runner.runTask(
  DockerTaskRunner.templates.nodejs(
    `
const fs = require('fs');
const data = fs.readFileSync('/data/input.txt', 'utf8');
console.log('读取到:', data);
  `,
    {
      volumes: {
        '/Users/me/data': '/data', // 主机路径:容器路径
      },
    }
  )
);
```

## 🎯 集成到 AI 工具

### 添加工具定义

```typescript
// 在 ToolExecutor 中添加
const tools = {
  execute_nodejs: {
    name: 'execute_nodejs',
    description: '在隔离的 Docker 容器中执行 Node.js 代码',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要执行的代码' },
        timeout: { type: 'number', description: '超时时间（毫秒）' },
      },
      required: ['code'],
    },
    handler: async (params) => {
      const runner = new DockerTaskRunner();
      const result = await runner.runTask(
        DockerTaskRunner.templates.nodejs(params.code, {
          timeout: params.timeout || 60000,
        })
      );
      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr,
      };
    },
  },
  
  execute_python: {
    // 类似定义...
  },
};
```

### AI 对话示例

```
用户：帮我用 Python 计算 1 到 100 的和

AI：好的，我来执行 Python 代码计算。

[调用 execute_python 工具]
{
  code: "total = sum(range(1, 101))\nprint(f'1 到 100 的和是: {total}')"
}

AI：计算完成！1 到 100 的和是: 5050
```

## 📊 结果处理

```typescript
const result = await runner.runTask(config);

if (result.exitCode === 0) {
  console.log('✅ 执行成功');
  console.log('输出:', result.stdout);
} else {
  console.error('❌ 执行失败');
  console.error('错误:', result.stderr);
  console.error('退出码:', result.exitCode);
}

console.log('耗时:', result.duration, 'ms');
console.log('容器 ID:', result.containerId);
```

## 🔒 安全建议

1. **设置资源限制**

```typescript
{
  memory: 512 * 1024 * 1024,  // 512MB
  cpus: 0.5,                   // 0.5 核心
  timeout: 60000,              // 60 秒
}
```

2. **网络隔离（敏感任务）**

```typescript
{
  network: 'none',  // 完全隔离，无网络访问
}
```

3. **使用官方镜像**

```typescript
// ✅ 好
image: 'node:20-alpine'
image: 'python:3.11-slim'

// ❌ 避免
image: 'random-user/untrusted-image'
```

## 📚 更多资源

- **详细文档**: `docs/DOCKER_TASK_RUNNER.md`
- **API 参考**: `server/src/docker/DockerTaskRunner.ts`
- **集成示例**: `server/src/docker/docker-tool-integration.example.ts`
- **测试用例**: `server/src/docker/DockerTaskRunner.test.ts`

## 🐛 故障排查

### 问题 1: Docker 未运行

```bash
# 错误: Cannot connect to the Docker daemon
# 解决: 启动 Docker
docker ps
```

### 问题 2: 镜像不存在

```bash
# 错误: No such image: node:20-alpine
# 解决: 拉取镜像
docker pull node:20-alpine
```

### 问题 3: 权限错误

```bash
# 错误: permission denied
# 解决: 添加到 docker 组
sudo usermod -aG docker $USER
newgrp docker
```

### 问题 4: 超时

```typescript
// 增加超时时间
{
  timeout: 120000,  // 2 分钟
}
```

## ✅ 检查清单

开始使用前，确保：

- [ ] Docker 已安装并运行
- [ ] 已安装 `dockerode` 依赖
- [ ] 已拉取常用镜像（node、python、alpine）
- [ ] 测试通过

```bash
# 一键检查
docker ps && \
npm list dockerode && \
docker images | grep -E "node|python|alpine" && \
echo "✅ 环境就绪！"
```

## 🎉 开始使用

现在你可以开始使用 Docker 任务执行器了！

```typescript
import { DockerTaskRunner } from './src/docker/DockerTaskRunner.js';

const runner = new DockerTaskRunner();

// 你的第一个任务
const result = await runner.runTask(
  DockerTaskRunner.templates.nodejs(`
    console.log('🎉 Docker 任务执行器已就绪！');
  `)
);

console.log(result.stdout);
```

祝你使用愉快！🚀
