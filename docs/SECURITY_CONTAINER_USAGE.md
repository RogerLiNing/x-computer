# 容器隔离使用指南

本文档说明如何启用和使用 X-Computer 的容器隔离功能（R060 安全加固）。

---

## 📋 前提条件

### 1. Docker 环境
确保已安装 Docker：
```bash
docker --version
# Docker version 20.10.0 或更高
```

### 2. 构建沙箱镜像
```bash
cd /path/to/x-computer

# 方式 1：使用脚本（推荐）
chmod +x docker/build-sandbox.sh
./docker/build-sandbox.sh

# 方式 2：手动构建
docker build -f docker/sandbox.Dockerfile -t x-computer-sandbox:latest .
```

### 3. 验证镜像
```bash
docker images | grep x-computer-sandbox
# 应该看到 x-computer-sandbox:latest
```

---

## 🚀 启用容器隔离

### 方式 1：环境变量（推荐）

```bash
# 在 .env 文件中添加
USE_CONTAINER_ISOLATION=true

# 或在启动命令中设置
USE_CONTAINER_ISOLATION=true npm run dev
```

### 方式 2：代码配置

```typescript
import { createApp } from './app.js';

const { app } = await createApp({
  useContainerIsolation: true,
});
```

---

## 🧪 测试容器隔离

### 运行测试脚本

```bash
cd server

# 先构建
npm run build

# 运行测试
node dist/container/test-container.js
```

### 预期输出

```
🧪 开始测试容器隔离...

1️⃣  检查沙箱镜像...
✅ 镜像存在

2️⃣  创建测试用户容器...
✅ 容器已创建: abc123def456

3️⃣  测试基本命令...
  查看当前用户:
    stdout: xuser
    exitCode: 0

  查看工作目录:
    stdout: /workspace
    exitCode: 0

4️⃣  测试安全限制（应该失败或受限）...
  尝试访问 /etc/passwd:
    stderr: cat: can't open '/etc/passwd': Read-only file system
    exitCode: 1
    ✅ 命令被阻止或失败（符合预期）

  尝试访问 Docker Socket:
    stderr: ls: /var/run/docker.sock: No such file or directory
    exitCode: 1
    ✅ 命令被阻止或失败（符合预期）

5️⃣  测试文件操作...
  写入并读取文件:
    Hello from container
  ✅ 文件操作正常

6️⃣  清理测试容器...
✅ 容器已删除

🎉 所有测试完成！
```

---

## 🔒 安全特性

### 1. 完全隔离
- ✅ 每个用户独立容器
- ✅ 无法访问其他用户数据
- ✅ 无法访问宿主机文件

### 2. 资源限制
- ✅ CPU 限制（默认 1 核）
- ✅ 内存限制（默认 512MB）
- ✅ 进程数限制（最多 100 个）

### 3. 网络隔离
- ✅ 默认无网络访问
- ✅ 可配置受限网络

### 4. 权限限制
- ✅ 非特权用户运行（uid 1000）
- ✅ 只读根文件系统
- ✅ 无法提升权限
- ✅ 无法访问 Docker Socket

### 5. 环境变量清洁
- ✅ 不传递宿主机环境变量
- ✅ 无法获取 API Keys
- ✅ 无法获取数据库密码

---

## 📊 性能影响

### 容器创建
- **首次创建**: ~2-5 秒
- **后续复用**: ~50-100ms

### 命令执行
- **额外开销**: +10-20ms（vs 直接执行）

### 内存占用
- **每个容器**: ~50-100MB

### 优化建议
1. **容器复用**: 同一用户会话复用容器
2. **自动清理**: 闲置 30 分钟后自动停止
3. **容器池**: 预创建容器减少延迟

---

## 🛠️ 故障排查

### 问题 1: 镜像不存在

```
❌ 沙箱镜像不存在: x-computer-sandbox:latest
```

**解决方案**:
```bash
./docker/build-sandbox.sh
```

### 问题 2: Docker Socket 权限

```
❌ Error: connect EACCES /var/run/docker.sock
```

**解决方案**:
```bash
# macOS/Linux
sudo chmod 666 /var/run/docker.sock

# 或将用户添加到 docker 组
sudo usermod -aG docker $USER
```

### 问题 3: 容器启动失败

```
❌ 创建用户容器失败: ...
```

**检查步骤**:
1. 确认 Docker 服务运行中: `docker ps`
2. 检查磁盘空间: `df -h`
3. 查看 Docker 日志: `docker logs <container-id>`

---

## 🔄 容器管理

### 查看运行中的容器

```bash
docker ps | grep x-computer-user
```

### 手动停止容器

```bash
docker stop x-computer-user-<userId>
```

### 手动删除容器

```bash
docker rm x-computer-user-<userId>
```

### 清理所有测试容器

```bash
docker ps -a | grep x-computer-user | awk '{print $1}' | xargs docker rm -f
```

---

## 📝 配置选项

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `USE_CONTAINER_ISOLATION` | 是否启用容器隔离 | `false` |
| `CONTAINER_CPU_LIMIT` | CPU 核心数限制 | `1` |
| `CONTAINER_MEMORY_LIMIT` | 内存限制 | `512m` |
| `CONTAINER_NETWORK_MODE` | 网络模式 | `none` |

### 代码配置

```typescript
const containerManager = new UserContainerManager(workspaceRoot);

await containerManager.getOrCreateContainer({
  userId: 'user-123',
  cpuLimit: 2,           // 2 核 CPU
  memoryLimit: '1g',     // 1GB 内存
  networkMode: 'bridge', // 允许网络访问
});
```

---

## 🚨 生产环境建议

### 1. 必须启用容器隔离
```bash
USE_CONTAINER_ISOLATION=true
```

### 2. 配置资源限制
根据订阅套餐设置不同的资源限制：
- 试用版: 512MB / 0.5 核
- 个人版: 1GB / 1 核
- 专业版: 2GB / 2 核
- 企业版: 4GB / 4 核

### 3. 监控容器状态
定期检查容器健康状态和资源使用情况。

### 4. 自动清理
实施容器自动清理策略，避免资源泄露。

---

## 📚 相关文档

- [安全加固方案](./SECURITY_HARDENING_PLAN.md)
- [多用户架构](./INFRASTRUCTURE_MULTIUSER_CLOUD.md)
- [订阅系统](./R057_SUBSCRIPTION_IMPLEMENTATION.md)

---

**安全第一！** 🔒 生产环境必须启用容器隔离。
