# Docker 任务执行器

## 📋 概述

这是一个灵活的 Docker 任务执行系统，允许 AI 在隔离的容器中执行各种代码和任务。

### 🎯 设计理念

- **任务驱动**：按需创建容器，而不是为用户维护长期沙箱
- **多语言支持**：Node.js、Python、Bash、Go、Rust 等
- **资源高效**：用完即删，不占用资源
- **灵活配置**：支持自定义镜像、环境变量、资源限制

## 📁 文件结构

```
server/src/docker/
├── DockerTaskRunner.ts              # 核心任务执行器
├── DockerTaskRunner.test.ts        # 单元测试
├── DockerShellSession.ts            # 交互式 Shell 会话
├── DockerShellSession.test.ts      # Shell 会话测试
├── docker-tool-integration.example.ts  # 工具集成示例
└── README.md                        # 本文件
```

## 🚀 快速开始

### 1. 安装依赖

```bash
cd server
npm install dockerode
npm install --save-dev @types/dockerode
```

### 2. 基础使用

```typescript
import { DockerTaskRunner } from './docker/DockerTaskRunner.js';

const runner = new DockerTaskRunner();

// 执行 Node.js 任务
const result = await runner.runTask(
  DockerTaskRunner.templates.nodejs(`
    console.log('Hello from Docker!');
  `)
);

console.log(result.stdout); // "Hello from Docker!"
```

### 3. 运行测试

```bash
npm test -- DockerTaskRunner.test.ts
```

## 💡 使用场景

### 场景 1: 代码执行（单次任务）

用户可以让 AI 执行任意代码：

```
用户：帮我用 Python 计算斐波那契数列
AI：[调用 docker.run 工具]
```

### 场景 2: 交互式开发（多步操作）

```
用户：帮我在 Docker 里搭建一个 Node.js 项目
AI：
1. [docker.run 创建容器]
2. [docker.shell.enter 进入 Shell]
3. [docker.shell.exec 执行 npm init]
4. [docker.shell.exec 安装依赖]
5. [docker.shell.exec 创建文件]
6. [docker.shell.exit 退出]
```

### 场景 3: 数据处理

```
用户：处理这个 CSV 文件，计算平均值
AI：[使用 pandas 在 Docker 中处理]
```

### 场景 4: 调试和排错

```
用户：我的应用报错了，帮我看看
AI：
1. [docker.shell.enter 进入容器]
2. [docker.shell.exec 查看日志]
3. [docker.shell.exec 检查配置]
4. [docker.shell.exec 修复问题]
5. [docker.shell.exit 退出]
```

### 场景 5: 机器学习

```
用户：用这个模型做推理
AI：[使用 TensorFlow Docker 镜像]
```

## 🔧 集成到 ToolExecutor

### 方法 1: 添加工具定义

```typescript
// 在 ToolExecutor.ts 中添加
import { dockerTools } from './docker/docker-tool-integration.example.js';

// 注册工具
this.tools = {
  ...existingTools,
  ...dockerTools,
};
```

### 方法 2: 直接使用

```typescript
import { DockerTaskRunner } from './docker/DockerTaskRunner.js';

async function executeCode(language: string, code: string) {
  const runner = new DockerTaskRunner();
  
  const templates = {
    nodejs: DockerTaskRunner.templates.nodejs,
    python: DockerTaskRunner.templates.python,
    bash: DockerTaskRunner.templates.bash,
  };
  
  const config = templates[language](code);
  const result = await runner.runTask(config);
  
  return result;
}
```

## 📊 与旧方案对比

| 特性 | 旧方案（用户沙箱） | 新方案（任务执行器） |
|------|-------------------|---------------------|
| **容器生命周期** | 长期运行（30分钟空闲超时） | 按需创建，用完即删 |
| **适用场景** | 用户会话管理 | 任务执行 |
| **镜像选择** | 固定单一镜像 | 灵活选择任意镜像 |
| **资源占用** | 持续占用资源 | 按需使用，不占用 |
| **复杂度** | 高（需要管理容器池） | 低（简单的创建-执行-删除） |
| **文件持久化** | 支持（Volume 挂载） | 可选（按需挂载） |
| **多语言支持** | 有限（需预装） | 完全（任意镜像） |

## 🎨 预定义模板

```typescript
// Node.js
DockerTaskRunner.templates.nodejs(code, options)

// Python
DockerTaskRunner.templates.python(code, options)

// Bash
DockerTaskRunner.templates.bash(script, options)

// Go
DockerTaskRunner.templates.go(code, options)

// Rust
DockerTaskRunner.templates.rust(code, options)
```

## ⚙️ 配置选项

```typescript
interface DockerTaskConfig {
  image: string;                    // Docker 镜像
  command?: string[];               // 命令
  script?: string;                  // 脚本内容
  workdir?: string;                 // 工作目录
  env?: Record<string, string>;     // 环境变量
  timeout?: number;                 // 超时（毫秒）
  memory?: number;                  // 内存限制（字节）
  cpus?: number;                    // CPU 限制
  volumes?: Record<string, string>; // 卷挂载
  network?: string;                 // 网络模式
  autoRemove?: boolean;             // 自动删除
}
```

## 🔒 安全特性

- ✅ **资源限制**：内存、CPU、进程数
- ✅ **网络隔离**：可选 `network: 'none'`
- ✅ **超时控制**：防止无限运行
- ✅ **自动清理**：任务完成后删除容器
- ✅ **安全选项**：no-new-privileges、cap-drop

## 📈 性能优化

### 1. 镜像预拉取

```bash
docker pull node:20-alpine
docker pull python:3.11-slim
docker pull alpine:latest
```

### 2. 使用轻量级镜像

优先使用 `-alpine` 或 `-slim` 版本。

### 3. 并发控制

```typescript
// 限制同时运行的任务数
const maxConcurrent = 5;
const queue = new TaskQueue(maxConcurrent);
```

## 🐛 故障排查

### Docker 未运行

```bash
# 检查 Docker 状态
docker ps

# 启动 Docker
# macOS: 打开 Docker Desktop
# Linux: sudo systemctl start docker
```

### 镜像不存在

```bash
# 拉取镜像
docker pull node:20-alpine
```

### 权限错误

```bash
# 将用户添加到 docker 组
sudo usermod -aG docker $USER
newgrp docker
```

## 📚 更多文档

- [详细使用指南](../../../docs/DOCKER_TASK_RUNNER.md)
- [交互式 Shell 会话](../../../DOCKER_SHELL_SESSION.md)
- [工具集成示例](./docker-tool-integration.example.ts)
- [测试用例](./DockerTaskRunner.test.ts)
- [Shell 会话测试](./DockerShellSession.test.ts)

## 🎯 下一步

1. **集成到 ToolExecutor**：添加 `execute_nodejs`、`execute_python` 等工具
2. **添加更多模板**：Java、Ruby、PHP 等
3. **实现任务队列**：支持批量任务和并发控制
4. **添加监控**：任务执行统计、资源使用监控
5. **持久化存储**：可选的文件持久化方案

## 💬 反馈

如有问题或建议，请创建 Issue 或 Pull Request。
