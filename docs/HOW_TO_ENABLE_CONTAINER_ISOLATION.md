# 如何启用容器隔离

## 📋 概述

X-Computer 支持两种运行模式：

| 模式 | 说明 | 适用场景 | 安全性 | 性能 |
|------|------|----------|--------|------|
| **直接模式** | 在宿主机直接执行命令 | 开发环境、单用户 | 中等 | 快速 (~10ms) |
| **容器模式** | 在 Docker 容器中执行命令 | 生产环境、多用户 | 高 | 较慢 (~50-100ms) |

**默认模式**：直接模式（开发友好）

---

## 🚀 快速启用

### 方式 1：配置文件（推荐）⭐

编辑 `server/.x-config.json`：

```json
{
  "container": {
    "enabled": true,
    "cpuLimit": 0.5,
    "memoryLimit": "256m",
    "pidsLimit": 100,
    "networkMode": "none"
  }
}
```

**优点**：
- ✅ 统一配置管理
- ✅ 支持资源限制配置
- ✅ 支持环境变量占位符
- ✅ 多环境配置切换方便

### 方式 2：环境变量

```bash
# 在项目根目录创建 .env 文件
echo "USE_CONTAINER_ISOLATION=true" > server/.env

# 或在启动命令中设置
USE_CONTAINER_ISOLATION=true npm run dev
```

### 方式 3：代码配置

编辑 `server/src/app.ts`：

```typescript
// 找到这一行
const useContainerIsolation =
  options?.useContainerIsolation ??
  (process.env.USE_CONTAINER_ISOLATION === 'true');

// 改为
const useContainerIsolation = true;  // 强制启用
```

---

## 📝 配置优先级

配置加载优先级（从高到低）：

```
代码 options > .x-config.json > 环境变量 > 默认值
```

**示例**：
```typescript
// 1. 代码 options（最高优先级）
createApp({ useContainerIsolation: true });

// 2. .x-config.json
{ "container": { "enabled": true } }

// 3. 环境变量
USE_CONTAINER_ISOLATION=true

// 4. 默认值
false（开发模式）
```

---

## ✅ 验证容器模式

### 1. 检查启动日志

启用容器模式后，**不会**看到警告：

```bash
# 直接模式（默认）- 会看到警告
⚠️  容器隔离未启用（开发模式），生产环境请设置 USE_CONTAINER_ISOLATION=true

# 容器模式 - 不会看到警告
```

### 2. 查看运行中的容器

```bash
# 查看所有 X-Computer 用户容器
docker ps -a --filter "name=x-computer-user"

# 示例输出（容器模式）
NAMES                      STATUS         IMAGE                  CREATED AT
x-computer-user-alice      Up 2 minutes   x-computer-sandbox     2026-03-01 18:00:00
x-computer-user-bob        Up 1 minute    x-computer-sandbox     2026-03-01 18:01:00
```

### 3. 运行测试脚本

```bash
# 测试容器功能
cd server
npx tsx quick-test-container.ts

# 预期输出
✅ 所有测试通过！
```

---

## 🔍 两种模式的区别

### 直接模式（默认）

**特点**：
- ✅ 快速响应（~10ms）
- ✅ 无需 Docker
- ✅ 调试方便
- ⚠️ 安全性依赖黑名单
- ⚠️ 用户间无物理隔离

**日志示例**：
```
[INFO][system/shell] 执行命令: ls -la
[INFO][system/security-audit] [SHELL_EXEC] userId=alice cmd=ls -la cwd=/workspace/alice
```

**适用场景**：
- 本地开发
- 单用户环境
- 快速原型

### 容器模式

**特点**：
- ✅ 完全隔离（独立容器）
- ✅ 资源限制（CPU、内存）
- ✅ 网络隔离
- ✅ 只读根文件系统
- ⚠️ 响应较慢（~50-100ms）
- ⚠️ 需要 Docker

**日志示例**：
```
[INFO][system/container] 创建用户容器: alice
[INFO][system/container] 用户容器创建成功: alice -> 2f5c321a0559
[INFO][system/container] 用户容器已存在并运行中: 2f5c321a0559
[INFO][system/security-audit] [SHELL_EXEC] userId=2f5c321a0559 cmd=ls -la cwd=/workspace
```

**适用场景**：
- 生产环境
- 多用户系统
- 高安全要求

---

## 🧪 测试容器隔离

### 测试 1：基本功能

```bash
cd server
npx tsx quick-test-container.ts
```

**预期结果**：
```
✅ 基本命令: Hello from container
✅ 当前用户: node
✅ 工作目录: /workspace
✅ 工作区内容: (用户文件)
✅ 系统信息: Alpine Linux
```

### 测试 2：安全限制

启用容器模式后，尝试执行危险命令：

```bash
# 在 X-Computer 中执行（应该被拒绝）
docker ps           # ❌ 被拒绝（黑名单）
rm -rf /            # ❌ 被拒绝（黑名单）
cat /etc/shadow     # ❌ 权限不足（非 root 用户）
```

### 测试 3：资源隔离

```bash
# 查看容器资源限制
docker inspect x-computer-user-alice | grep -A 5 "HostConfig"

# 预期输出
"Memory": 536870912,        # 512 MB
"NanoCpus": 1000000000,     # 1 CPU 核心
"PidsLimit": 100,           # 最多 100 个进程
```

---

## 📊 性能对比

| 操作 | 直接模式 | 容器模式 | 差异 |
|------|---------|---------|------|
| 命令执行 | ~10ms | ~50-100ms | 5-10x |
| 首次启动 | 即时 | ~1-3s | 容器创建 |
| 内存占用 | ~50MB | ~512MB/用户 | 10x |
| 并发用户 | 无限制 | 受内存限制 | — |

**建议**：
- 开发环境：直接模式（快速迭代）
- 生产环境：容器模式（安全隔离）

---

## 🛠️ 故障排查

### 问题 1：启用容器模式后看不到容器

**原因**：容器是按需创建的，只有执行 shell 命令时才会创建。

**解决**：
1. 在 X-Computer 中执行任意命令（如 `ls`）
2. 运行 `docker ps -a --filter "name=x-computer-user"`
3. 应该能看到对应用户的容器

### 问题 2：容器创建失败

**错误**：
```
Error: Cannot find image 'x-computer-sandbox:latest' locally
```

**解决**：
```bash
# 构建沙箱镜像
cd docker
./build-sandbox.sh
```

### 问题 3：权限不足

**错误**：
```
Error: Got permission denied while trying to connect to the Docker daemon socket
```

**解决**：
```bash
# macOS/Linux
sudo usermod -aG docker $USER
newgrp docker

# 或使用 sudo 运行
sudo npm run dev
```

### 问题 4：容器无法访问网络

**原因**：默认网络模式为 `none`（完全隔离）。

**解决**：
```bash
# 修改 server/src/app.ts
const containerManager = new UserContainerManager(workspaceRoot, {
  networkMode: 'bridge',  // 允许网络访问
});
```

---

## 🔧 高级配置

### 完整配置示例

编辑 `server/.x-config.json`：

```json
{
  "$schema": "https://x-computer.dev/config.json",
  "tool_loading_mode": "all",
  
  "llm_config": {
    "providers": [
      {
        "id": "bailian",
        "name": "阿里百炼",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "apiKey": "{env:BAILIAN_API_KEY}"
      }
    ]
  },
  
  "auth": {
    "allowRegister": true,
    "allowAnonymous": false
  },
  
  "container": {
    "enabled": true,
    "cpuLimit": 0.5,
    "memoryLimit": "256m",
    "pidsLimit": 100,
    "networkMode": "none",
    "idleTimeout": 300000,
    "maxIdleTime": 86400000
  }
}
```

### 配置字段说明

#### `container.enabled`
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：是否启用容器隔离

#### `container.cpuLimit`
- **类型**：`number`
- **默认值**：`1`
- **说明**：CPU 核心数限制（0.5 = 50% 单核）

#### `container.memoryLimit`
- **类型**：`string`
- **默认值**：`"512m"`
- **说明**：内存限制（支持 m/g 单位）

#### `container.pidsLimit`
- **类型**：`number`
- **默认值**：`100`
- **说明**：最大进程数限制

#### `container.networkMode`
- **类型**：`"none" | "bridge" | "host"`
- **默认值**：`"none"`
- **说明**：
  - `none`：无网络访问（最安全）
  - `bridge`：桥接网络（允许外网访问）
  - `host`：主机网络（与宿主机共享）

#### `container.idleTimeout`
- **类型**：`number`
- **默认值**：`300000`（5 分钟）
- **说明**：容器空闲超时（毫秒），超时后自动停止（TODO: 待实现）

#### `container.maxIdleTime`
- **类型**：`number`
- **默认值**：`86400000`（24 小时）
- **说明**：容器最大空闲时间（毫秒），超时后自动删除（TODO: 待实现）

### 环境变量配置（兼容）

创建 `server/.env`：

```bash
# 容器隔离
USE_CONTAINER_ISOLATION=true

# 资源限制
CONTAINER_CPU_LIMIT=0.5
CONTAINER_MEMORY_LIMIT=256m
CONTAINER_PIDS_LIMIT=50
CONTAINER_NETWORK_MODE=none
```

### 多环境配置

```bash
# 开发环境（默认）
cp server/.x-config.json server/.x-config.dev.json

# 生产环境
cp server/.x-config.production.json server/.x-config.json

# 或使用环境变量切换
X_COMPUTER_CONFIG_PATH=server/.x-config.production.json npm start
```

---

## 📚 相关文档

- [安全容器使用指南](./SECURITY_CONTAINER_USAGE.md) - 详细的容器安全配置
- [用户隔离分析](./USER_ISOLATION_ANALYSIS.md) - 四层隔离机制详解
- [性能分析](./PERFORMANCE_ANALYSIS.md) - 性能优化与并发扩展
- [生产环境就绪](./PRODUCTION_READINESS.md) - 生产部署清单

---

## 🎯 快速决策

**我应该启用容器模式吗？**

```
是否为生产环境？
├─ 是 → ✅ 启用容器模式（安全第一）
└─ 否 → 是否有多个用户？
    ├─ 是 → ✅ 启用容器模式（隔离用户）
    └─ 否 → ❌ 使用直接模式（开发快速）
```

**总结**：
- 🏠 **开发环境**：直接模式（默认）
- 🚀 **生产环境**：容器模式（必须）
- 👥 **多用户**：容器模式（推荐）
- 🔒 **高安全要求**：容器模式（必须）
