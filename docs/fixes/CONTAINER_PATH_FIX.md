# 容器路径映射修复

## 🐛 问题描述

用户报告：在容器模式下，X 执行 `ps aux` 等命令时失败，错误信息：

```
/bin/sh: cd: line 0: can't cd to /var/folders/.../workspace: No such file or directory
```

## 🔍 问题分析

### 根本原因

**路径映射错误**：`SandboxShell` 在容器模式下，将宿主机的绝对路径直接传递给容器内的 `cd` 命令，但容器内没有宿主机的路径结构。

### 错误流程

1. **`shell.run` 工具**：计算宿主机路径
   ```typescript
   // server/src/orchestrator/tools/shell/run.ts:32
   const cwd = pathMod.resolve(root, workdir.replace(/^\//, ''));
   // 结果：/var/folders/.../workspace
   ```

2. **`SandboxShell.execute`**：传递宿主机路径
   ```typescript
   // server/src/tooling/SandboxShell.ts:42
   const result = await sandbox.sandboxShell.execute(command, cwd, timeoutMs);
   ```

3. **`SandboxShell.executeInContainer`**：直接使用宿主机路径
   ```typescript
   // 修复前
   const result = await this.containerManager!.execInContainer(
     this.userId!,
     command,
     {
       cwd: cwd || '/workspace',  // ❌ 宿主机路径
       timeout: timeoutMs,
     }
   );
   ```

4. **`UserContainerManager.execInContainer`**：在容器内执行 `cd`
   ```typescript
   // server/src/container/UserContainerManager.ts:212
   Cmd: ['/bin/sh', '-c', `cd ${cwd} && ${command}`]
   // ❌ cd /var/folders/.../workspace && ps aux
   // 容器内没有这个路径！
   ```

### 路径对比

| 位置 | 路径 | 说明 |
|------|------|------|
| **宿主机** | `/var/folders/.../workspace` | 用户工作区的实际路径 |
| **容器内** | `/workspace` | 挂载点（Volume） |
| **错误** | 容器内执行 `cd /var/folders/.../workspace` | ❌ 路径不存在 |
| **正确** | 容器内执行 `cd /workspace` | ✅ 正确的挂载点 |

---

## ✅ 解决方案

### 修复代码

**文件**：`server/src/tooling/SandboxShell.ts`

在 `executeInContainer` 方法中，将宿主机路径转换为容器内路径：

```typescript
private async executeInContainer(
  command: string,
  cwd: string | undefined,
  timeoutMs: number,
  startTime: number
): Promise<ShellResult> {
  try {
    // 容器内的工作目录：将宿主机路径转换为容器内路径
    // 宿主机：/var/folders/.../workspace/subdir -> 容器：/workspace/subdir
    let containerCwd = '/workspace';
    if (cwd && cwd.startsWith(this.workspaceRoot)) {
      const relativePath = path.relative(this.workspaceRoot, cwd);
      containerCwd = relativePath ? `/workspace/${relativePath}` : '/workspace';
    }

    const result = await this.containerManager!.execInContainer(
      this.userId!,
      command,
      {
        cwd: containerCwd,  // ✅ 容器内路径
        timeout: timeoutMs,
      }
    );

    return {
      ...result,
      command,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    // ... 错误处理
  }
}
```

### 路径转换逻辑

| 宿主机路径 | 容器内路径 | 说明 |
|-----------|-----------|------|
| `/var/folders/.../workspace` | `/workspace` | 根目录 |
| `/var/folders/.../workspace/scripts` | `/workspace/scripts` | 子目录 |
| `/var/folders/.../workspace/tmp` | `/workspace/tmp` | 子目录 |
| `/other/path` | `/workspace` | 非工作区路径，回退到根目录 |

---

## 🧪 测试验证

### 测试脚本

**文件**：`server/test-container-path-fix.ts`

```bash
cd server
npx tsx test-container-path-fix.ts
```

### 测试结果

```
✅ 所有测试通过！

测试: 基本命令（默认工作区）
   命令: pwd
   输出: /workspace

测试: 列出进程
   命令: ps aux | head -10
   输出: PID   USER     TIME  COMMAND
         1 node      0:00 tail -f /dev/null

测试: 查看当前用户
   命令: whoami
   输出: node
```

---

## 📊 修复前后对比

### 修复前

```
用户: 当前正在运行的进程有哪些

X: 运行命令(77ms)
输入: { "command": "ps aux" }
输出: {
  "exitCode": 2,
  "stderr": "/bin/sh: cd: line 0: can't cd to .../workspace: No such file or directory"
}
```

### 修复后

```
用户: 当前正在运行的进程有哪些

X: 运行命令(50ms)
输入: { "command": "ps aux" }
输出: {
  "exitCode": 0,
  "stdout": "PID   USER     TIME  COMMAND\n    1 node      0:00 tail -f /dev/null\n..."
}
```

---

## 🎯 影响范围

### 受影响的功能

- ✅ `shell.run` 工具（所有命令执行）
- ✅ `python.run` 工具（Python 脚本执行）
- ✅ 容器模式下的所有文件操作
- ✅ X 的自主任务执行

### 不受影响

- ✅ 直接模式（`enabled: false`）
- ✅ 文件读写（`file.read`、`file.write` 等）
- ✅ 容器创建和管理

---

## 📝 相关问题

### Q1: 为什么容器模式会启用？

**A**: 检查日志发现 `[SECURITY] [CONTAINER]`，说明系统确实在使用容器模式。可能原因：

1. 之前的测试启用了容器模式
2. 用户容器已存在且正在运行
3. `UserSandboxManager` 检测到容器管理器可用

### Q2: 为什么配置显示 `enabled: false`？

**A**: 配置文件中的 `enabled: false` 是**默认配置**，但实际运行时可能被覆盖：

```typescript
// server/src/app.ts
const useContainerIsolation = 
  options.useContainerIsolation ??  // 代码选项
  config.container?.enabled ??      // 配置文件
  (process.env.USE_CONTAINER_ISOLATION === 'true');  // 环境变量
```

### Q3: 如何确认当前是否使用容器模式？

**A**: 查看日志中的 `[SECURITY]` 标记：

```
[SECURITY] [CONTAINER] userId=xxx cmd=ps aux  ← 容器模式
[SECURITY] [DIRECT] userId=xxx cmd=ps aux     ← 直接模式
```

---

## 🚀 部署建议

### 1. 立即修复

```bash
# 1. 拉取最新代码
git pull

# 2. 编译
cd server
npm run build

# 3. 重启服务器
npm run dev
```

### 2. 验证修复

在 X-Computer 中执行：

```
当前正在运行的进程有哪些
```

**预期结果**：
- ✅ 命令成功执行
- ✅ 返回进程列表
- ✅ 无 "can't cd" 错误

### 3. 清理旧容器（可选）

```bash
# 停止所有 X-Computer 用户容器
docker ps -a --filter "name=x-computer-user" --format "{{.Names}}" | xargs -r docker stop

# 删除所有 X-Computer 用户容器
docker ps -a --filter "name=x-computer-user" --format "{{.Names}}" | xargs -r docker rm
```

---

## 📚 相关文档

- [容器隔离启用指南](./docs/HOW_TO_ENABLE_CONTAINER_ISOLATION.md)
- [用户隔离分析](./docs/USER_ISOLATION_ANALYSIS.md)
- [配置指南](./docs/CONFIGURATION.md)

---

## 🎉 总结

### 问题

容器模式下，命令执行失败，错误：`can't cd to .../workspace: No such file or directory`

### 原因

宿主机路径直接传递给容器内的 `cd` 命令，但容器内没有宿主机的路径结构。

### 修复

在 `SandboxShell.executeInContainer` 中，将宿主机路径转换为容器内相对路径：

```
宿主机: /var/folders/.../workspace/subdir
容器内: /workspace/subdir
```

### 验证

✅ `ps aux` 命令正常执行  
✅ 所有容器模式下的命令正常工作  
✅ 路径映射正确  

---

## 🐛 额外修复：容器名称冲突

### 问题

服务器重启后，容器管理器的内存缓存丢失，但 Docker 中的容器仍然存在，导致：

```
(HTTP code 409) unexpected - Conflict. The container name "/x-computer-user-xxx" is already in use
```

### 原因

`getOrCreateContainer` 只检查内存缓存 `this.containers`，没有检查 Docker 中是否已有同名容器。

### 修复

在 `getOrCreateContainer` 中添加 Docker 容器检查：

```typescript
// 2. 检查 Docker 中是否已有同名容器（服务器重启后缓存丢失的情况）
const containerName = `x-computer-user-${userId}`;
try {
  const containers = await this.docker.listContainers({ all: true });
  const existingContainer = containers.find(c => 
    c.Names.some(name => name === `/${containerName}`)
  );
  
  if (existingContainer) {
    serverLogger.info('container', `发现已存在的用户容器: ${userId}`);
    
    // 更新缓存
    this.containers.set(userId, existingContainer.Id);
    
    // 如果容器未运行，启动它
    if (existingContainer.State !== 'running') {
      const container = this.docker.getContainer(existingContainer.Id);
      await container.start();
    }
    
    return existingContainer.Id;
  }
} catch (error) {
  // 继续创建新容器
}
```

### 测试

**文件**：`server/test-container-reuse.ts`

```bash
npx tsx test-container-reuse.ts
```

**结果**：
```
✅ 成功复用同一个容器！
- 服务器重启后，容器管理器会检查 Docker 中已存在的容器
- 避免了 "container name already in use" 错误
- 自动复用已存在的容器，提高性能
```

---

**修复完成时间**：2026-03-01  
**修复版本**：v0.1.0  
**测试状态**：✅ 通过  
**额外修复**：✅ 容器复用
