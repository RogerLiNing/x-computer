# Docker 任务执行器

## 概述

`DockerTaskRunner` 是一个灵活的 Docker 任务执行器，可以按需创建容器执行各种任务。

### 特性

- ✅ **多语言支持**：Node.js、Python、Bash、Go、Rust 等
- ✅ **按需创建**：任务驱动，用完即删
- ✅ **资源隔离**：每个任务独立容器
- ✅ **资源限制**：内存、CPU、超时控制
- ✅ **自动清理**：任务完成后自动删除容器
- ✅ **环境变量**：支持自定义环境变量
- ✅ **卷挂载**：支持挂载主机目录

## 快速开始

### 安装依赖

```bash
npm install dockerode
npm install --save-dev @types/dockerode
```

### 基础用法

```typescript
import { DockerTaskRunner } from './docker/DockerTaskRunner.js';

const runner = new DockerTaskRunner();

// 执行 Node.js 任务
const result = await runner.runTask(
  DockerTaskRunner.templates.nodejs(`
    console.log('Hello from Docker!');
    console.log('2 + 2 =', 2 + 2);
  `)
);

console.log('输出:', result.stdout);
console.log('退出码:', result.exitCode);
console.log('耗时:', result.duration, 'ms');
```

## 使用示例

### 1. Node.js 任务

```typescript
// 简单脚本
const config = DockerTaskRunner.templates.nodejs(`
  const fs = require('fs');
  console.log('当前目录:', process.cwd());
  console.log('环境变量:', process.env);
`);

const result = await runner.runTask(config);
```

### 2. Python 任务

```typescript
// Python 数据分析
const config = DockerTaskRunner.templates.python(`
import json
import sys

data = {'name': 'test', 'value': 123}
print(json.dumps(data))
print('Python version:', sys.version, file=sys.stderr)
`);

const result = await runner.runTask(config);
console.log('JSON 输出:', result.stdout);
console.log('错误输出:', result.stderr);
```

### 3. Bash 脚本

```typescript
// 系统命令
const config = DockerTaskRunner.templates.bash(`
echo "系统信息:"
uname -a
echo "磁盘使用:"
df -h
`);

const result = await runner.runTask(config);
```

### 4. 自定义镜像

```typescript
// 使用自定义 Docker 镜像
const config = {
  image: 'tensorflow/tensorflow:latest-py3',
  script: `
import tensorflow as tf
print('TensorFlow version:', tf.__version__)
  `,
  memory: 1024 * 1024 * 1024, // 1GB
  cpus: 2,
  timeout: 120000, // 2 分钟
};

const result = await runner.runTask(config);
```

## 高级功能

### 环境变量

```typescript
const config = DockerTaskRunner.templates.nodejs(
  `
console.log('API Key:', process.env.API_KEY);
console.log('Database:', process.env.DB_URL);
`,
  {
    env: {
      API_KEY: 'secret-key-123',
      DB_URL: 'postgresql://localhost:5432/mydb',
    },
  }
);

const result = await runner.runTask(config);
```

### 卷挂载

```typescript
const config = DockerTaskRunner.templates.nodejs(
  `
const fs = require('fs');
const data = fs.readFileSync('/data/input.txt', 'utf8');
console.log('读取到:', data);
fs.writeFileSync('/data/output.txt', data.toUpperCase());
`,
  {
    volumes: {
      '/Users/me/data': '/data', // 主机路径:容器路径
    },
  }
);

const result = await runner.runTask(config);
```

### 资源限制

```typescript
const config = DockerTaskRunner.templates.python(
  `
import numpy as np
# 创建大数组
arr = np.random.rand(1000, 1000)
print('数组大小:', arr.shape)
`,
  {
    memory: 256 * 1024 * 1024, // 256MB
    cpus: 0.5, // 0.5 核心
    timeout: 30000, // 30 秒
  }
);

const result = await runner.runTask(config);
```

### 网络配置

```typescript
// 完全隔离（无网络）
const config = DockerTaskRunner.templates.nodejs(
  `
console.log('离线环境');
`,
  {
    network: 'none',
  }
);

// 使用自定义网络
const config2 = DockerTaskRunner.templates.nodejs(
  `
console.log('自定义网络');
`,
  {
    network: 'my-custom-network',
  }
);
```

## 任务管理

### 列出运行中的任务

```typescript
const tasks = await runner.listRunningTasks();
console.log('运行中的任务:', tasks);
// [
//   { id: 'abc123', image: 'node:20-alpine', status: 'Up 5 seconds' },
//   { id: 'def456', image: 'python:3.11-slim', status: 'Up 2 seconds' }
// ]
```

### 停止任务

```typescript
await runner.stopTask('abc123');
console.log('任务已停止');
```

## 集成到 AI 工具

### 作为工具函数

```typescript
// 在 ToolExecutor 中添加
async function executeDockerTask(params: {
  language: 'nodejs' | 'python' | 'bash';
  code: string;
  env?: Record<string, string>;
  timeout?: number;
}) {
  const runner = new DockerTaskRunner();

  const templates = {
    nodejs: DockerTaskRunner.templates.nodejs,
    python: DockerTaskRunner.templates.python,
    bash: DockerTaskRunner.templates.bash,
  };

  const config = templates[params.language](params.code, {
    env: params.env,
    timeout: params.timeout || 60000,
  });

  const result = await runner.runTask(config);

  return {
    success: result.exitCode === 0,
    output: result.stdout,
    error: result.stderr,
    duration: result.duration,
  };
}
```

### AI 使用示例

用户可以通过聊天让 AI 执行任务：

```
用户：帮我用 Python 计算斐波那契数列的前 20 项

AI：好的，我来执行 Python 代码计算斐波那契数列。

[调用 executeDockerTask]
{
  language: 'python',
  code: `
def fibonacci(n):
    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    return fib

result = fibonacci(20)
print('斐波那契数列前20项:')
print(result)
  `
}

AI：计算完成！斐波那契数列的前 20 项是：
[0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181]
```

## 实际应用场景

### 1. 数据处理

```typescript
// 批量处理 CSV 文件
const config = DockerTaskRunner.templates.python(
  `
import pandas as pd
df = pd.read_csv('/data/input.csv')
df['processed'] = df['value'] * 2
df.to_csv('/data/output.csv', index=False)
print(f'处理了 {len(df)} 行数据')
`,
  {
    volumes: {
      '/Users/me/data': '/data',
    },
  }
);
```

### 2. 代码测试

```typescript
// 运行单元测试
const config = DockerTaskRunner.templates.nodejs(
  `
const assert = require('assert');

function add(a, b) {
  return a + b;
}

assert.strictEqual(add(2, 3), 5);
assert.strictEqual(add(-1, 1), 0);
console.log('✅ 所有测试通过');
`
);
```

### 3. 网络爬虫

```typescript
// 爬取网页数据
const config = DockerTaskRunner.templates.python(
  `
import requests
from bs4 import BeautifulSoup

url = 'https://example.com'
response = requests.get(url)
soup = BeautifulSoup(response.text, 'html.parser')
title = soup.find('title').text
print('页面标题:', title)
`
);
```

### 4. 图像处理

```typescript
// 处理图片
const config = DockerTaskRunner.templates.python(
  `
from PIL import Image

img = Image.open('/data/input.jpg')
img_resized = img.resize((800, 600))
img_resized.save('/data/output.jpg')
print('图片已调整大小')
`,
  {
    volumes: {
      '/Users/me/images': '/data',
    },
  }
);
```

### 5. 机器学习推理

```typescript
// 运行模型推理
const config = {
  image: 'tensorflow/tensorflow:latest-py3',
  script: `
import tensorflow as tf
import numpy as np

# 加载模型
model = tf.keras.models.load_model('/models/my_model.h5')

# 推理
data = np.random.rand(1, 224, 224, 3)
predictions = model.predict(data)
print('预测结果:', predictions)
  `,
  volumes: {
    '/Users/me/models': '/models',
  },
  memory: 2 * 1024 * 1024 * 1024, // 2GB
  timeout: 300000, // 5 分钟
};
```

## 错误处理

```typescript
try {
  const result = await runner.runTask(config);

  if (result.exitCode !== 0) {
    console.error('任务执行失败:');
    console.error('错误输出:', result.stderr);
  } else {
    console.log('任务成功:', result.stdout);
  }
} catch (error) {
  if (error.message.includes('timeout')) {
    console.error('任务超时');
  } else if (error.message.includes('No such image')) {
    console.error('Docker 镜像不存在');
  } else {
    console.error('未知错误:', error);
  }
}
```

## 性能优化

### 1. 镜像预拉取

```bash
# 预先拉取常用镜像
docker pull node:20-alpine
docker pull python:3.11-slim
docker pull alpine:latest
```

### 2. 使用轻量级镜像

```typescript
// 优先使用 alpine 版本
const config = {
  image: 'node:20-alpine', // 而不是 node:20
  script: '...',
};
```

### 3. 复用容器（可选）

对于频繁执行的任务，可以考虑保留容器：

```typescript
const config = {
  image: 'node:20-alpine',
  script: '...',
  autoRemove: false, // 不自动删除
};

const result = await runner.runTask(config);
// 手动管理容器生命周期
```

## 安全建议

1. **资源限制**：始终设置内存和 CPU 限制
2. **网络隔离**：敏感任务使用 `network: 'none'`
3. **只读文件系统**：可以添加只读根文件系统配置
4. **超时控制**：设置合理的超时时间
5. **镜像安全**：使用官方或可信镜像

## 与之前 Docker 沙箱的区别

| 特性 | 旧方案（用户沙箱） | 新方案（任务执行器） |
|------|-------------------|---------------------|
| 容器生命周期 | 长期运行（30分钟） | 按需创建，用完即删 |
| 适用场景 | 用户会话管理 | 任务执行 |
| 镜像选择 | 固定镜像 | 灵活选择 |
| 资源使用 | 持续占用 | 按需使用 |
| 复杂度 | 较高 | 较低 |

## 总结

`DockerTaskRunner` 提供了一个简单而强大的方式来执行各种 Docker 任务：

- ✅ 灵活：支持任意镜像和语言
- ✅ 安全：资源隔离和限制
- ✅ 高效：按需创建，自动清理
- ✅ 易用：预定义模板，简单 API

适合用于 AI 代理执行各种代码任务、数据处理、测试等场景。
