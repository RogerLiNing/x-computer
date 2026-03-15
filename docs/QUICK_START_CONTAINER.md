# 容器隔离快速入门

## 🚀 5 分钟启用容器隔离

### 1. 检查当前配置

```bash
cd server
npx tsx test-config-loading.ts
```

**输出**：
```
3. 容器配置:
   enabled: false  ← 当前未启用
```

---

### 2. 编辑配置文件

打开 `server/.x-config.json`：

```json
{
  "container": {
    "enabled": true,      ← 改为 true
    "cpuLimit": 0.5,
    "memoryLimit": "256m",
    "pidsLimit": 100,
    "networkMode": "none"
  }
}
```

---

### 3. 测试容器功能

```bash
npx tsx test-container-config.ts
```

**预期输出**：
```
✅ 容器配置测试通过！

配置已正确应用:
- CPU 限制: 0.5 核心
- 内存限制: 256m
- 进程限制: 100
- 网络模式: none
```

---

### 4. 启动服务器

```bash
cd ..
npm run dev
```

**日志**：
```
✅ 容器隔离已启用（安全模式）CPU=0.5 MEM=256m PIDS=100 NET=none
```

---

### 5. 验证容器运行

在 X-Computer 中执行任意命令（如 `ls`），然后查看容器：

```bash
docker ps -a --filter "name=x-computer-user"
```

**输出**：
```
NAMES                      STATUS         IMAGE
x-computer-user-alice      Up 2 minutes   x-computer-sandbox
```

---

## 🎯 常见场景

### 场景 1：开发环境（默认）

```json
{
  "container": {
    "enabled": false  // 快速、方便调试
  }
}
```

**特点**：
- ✅ 快速响应（~10ms）
- ✅ 无需 Docker
- ✅ 调试方便

---

### 场景 2：生产环境

```json
{
  "container": {
    "enabled": true,
    "cpuLimit": 0.5,
    "memoryLimit": "256m",
    "networkMode": "none"
  }
}
```

**特点**：
- ✅ 完全隔离
- ✅ 资源限制
- ✅ 高安全性

---

### 场景 3：需要网络访问

```json
{
  "container": {
    "enabled": true,
    "networkMode": "bridge"  // 允许外网访问
  }
}
```

**用途**：
- 下载资源
- API 调用
- 安装依赖

---

## 🛠️ 故障排查

### 问题 1：镜像不存在

**错误**：
```
Cannot find image 'x-computer-sandbox:latest'
```

**解决**：
```bash
cd docker
./build-sandbox.sh
```

---

### 问题 2：Docker 未运行

**错误**：
```
Cannot connect to the Docker daemon
```

**解决**：
```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
```

---

### 问题 3：权限不足

**错误**：
```
Got permission denied while trying to connect to Docker
```

**解决**：
```bash
sudo usermod -aG docker $USER
newgrp docker
```

---

## 📚 更多信息

- [完整配置指南](./CONFIGURATION.md)
- [容器启用详解](./HOW_TO_ENABLE_CONTAINER_ISOLATION.md)
- [用户隔离分析](./USER_ISOLATION_ANALYSIS.md)

---

## 💡 提示

**开发时**：保持 `enabled: false`（快速迭代）  
**部署前**：改为 `enabled: true`（安全隔离）  
**测试时**：使用 `test-container-config.ts` 验证
