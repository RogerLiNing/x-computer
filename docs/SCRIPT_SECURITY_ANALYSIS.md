# X 编写脚本的安全风险分析与防护

## 🚨 安全威胁场景

### 场景 1：Python 脚本突破容器

X 可能编写如下 Python 脚本：

```python
# 恶意脚本示例 1：尝试访问宿主机
import subprocess
import os

# 尝试逃逸容器
subprocess.run(['docker', 'ps'], capture_output=True)  # ❌ 被黑名单拦截

# 尝试访问敏感文件
with open('/etc/passwd', 'r') as f:  # ❌ 容器内只读根文件系统
    print(f.read())

# 尝试网络攻击
import socket
s = socket.socket()
s.connect(('evil.com', 80))  # ❌ 容器无网络访问（networkMode: none）
```

### 场景 2：Node.js 脚本执行命令

```javascript
// 恶意脚本示例 2：Node.js
const { exec } = require('child_process');

// 尝试执行宿主机命令
exec('docker ps', (err, stdout) => {  // ❌ 被黑名单拦截
    console.log(stdout);
});

// 尝试删除系统文件
exec('rm -rf /', (err) => {  // ❌ 被黑名单拦截
    console.log('Done');
});
```

### 场景 3：Shell 脚本注入

```bash
#!/bin/bash
# 恶意脚本示例 3：Shell

# 尝试访问 Docker
docker run -it ubuntu bash  # ❌ 被黑名单拦截

# 尝试提权
sudo su  # ❌ 被黑名单拦截

# 尝试修改系统
chmod 777 /etc/passwd  # ❌ 只读根文件系统
```

---

## 🛡️ 当前防护措施

### 第 1 层：命令黑名单（SandboxShell）

**文件**：`server/src/tooling/SandboxShell.ts`

```typescript
const BLOCKED_PATTERNS = [
  /sudo/i,
  /su\s/i,                              // 禁止切换用户
  /rm\s+-rf\s+\//,                      // rm -rf /
  /mkfs/i,
  /dd\s+if=/i,
  /chmod\s+777/,
  />\s*\/dev\/(?!null|zero\b)[a-z0-9]+/i,
  /shutdown|reboot|halt/i,
  /\/etc\/passwd|\/etc\/shadow/i,       // 禁止访问敏感系统文件
  /\.\.\//,                             // 禁止 ../ 路径遍历
  /~\//,                                // 禁止访问用户主目录
  /\/proc\//i,                          // 禁止访问进程信息
  /\/sys\//i,                           // 禁止访问系统信息
  /docker/i,                            // 禁止 docker 命令
  /kubectl/i,                           // 禁止 k8s 命令
  /systemctl/i,                         // 禁止系统服务管理
];
```

**问题**：
- ❌ 只能拦截直接的 shell 命令
- ❌ 无法拦截脚本内部的命令（Python、Node.js 等）
- ❌ 容易被绕过（如 `doc``ker` 或 `\docker`）

### 第 2 层：Docker 容器隔离

**文件**：`server/src/container/UserContainerManager.ts`

```typescript
HostConfig: {
  // 资源限制
  Memory: this.parseMemoryLimit(memoryLimit),
  NanoCpus: cpuLimit * 1e9,
  PidsLimit: this.defaultPidsLimit,
  
  // 安全选项
  ReadonlyRootfs: true,           // ✅ 只读根文件系统
  NetworkMode: networkMode,       // ✅ 默认无网络（none）
  
  // 挂载工作区
  Binds: [`${workspacePath}:/workspace`],
  
  // 不挂载 Docker Socket
  // ✅ 容器内无法访问宿主机 Docker
}

// 非特权用户
User: 'node',  // ✅ 非 root 用户
```

**防护效果**：
- ✅ 只读根文件系统：无法修改系统文件
- ✅ 无网络访问：无法连接外部服务器
- ✅ 无 Docker Socket：无法控制宿主机 Docker
- ✅ 非 root 用户：权限受限
- ✅ 资源限制：防止资源耗尽攻击

**问题**：
- ⚠️ 工作区 `/workspace` 可读写
- ⚠️ 脚本可以在工作区内执行任意操作
- ⚠️ 如果启用网络（`networkMode: bridge`），可以访问外部

### 第 3 层：文件系统隔离（SandboxFS）

**文件**：`server/src/tooling/SandboxFS.ts`

```typescript
private resolve(filePath: string): string {
  const normalized = path.normalize(filePath);
  const resolved = path.join(this.root, normalized);
  
  // 防止路径遍历
  if (!resolved.startsWith(this.root)) {
    throw new Error('Path traversal detected');
  }
  
  return resolved;
}
```

**防护效果**：
- ✅ 路径遍历防护：无法访问工作区外的文件
- ✅ 用户隔离：每个用户独立目录

**问题**：
- ❌ 只防护 `file.*` 工具
- ❌ 不防护脚本内的文件操作

---

## 🔴 当前风险评估

### 高风险场景

| 场景 | 风险等级 | 当前防护 | 是否可行 |
|------|---------|---------|---------|
| **脚本内执行 Docker 命令** | 🔴 高 | 容器内无 Docker | ✅ 已防护 |
| **脚本内访问 `/etc/passwd`** | 🟡 中 | 只读根文件系统 | ✅ 已防护 |
| **脚本内网络攻击** | 🔴 高 | 无网络（none） | ✅ 已防护 |
| **脚本内删除工作区文件** | 🟡 中 | 无防护 | ❌ 可行 |
| **脚本内无限循环/Fork 炸弹** | 🟡 中 | PidsLimit | ⚠️ 部分防护 |
| **脚本内读取其他用户文件** | 🔴 高 | 容器隔离 | ✅ 已防护 |
| **脚本内占用大量磁盘** | 🟡 中 | 存储配额 | ⚠️ 部分防护 |
| **脚本内占用大量内存** | 🟡 中 | Memory limit | ✅ 已防护 |

### 风险矩阵

```
影响 ↑
高 │ [网络攻击]     [Docker逃逸]    [读其他用户]
   │     ✅              ✅              ✅
中 │ [删除文件]     [系统文件]      [资源耗尽]
   │     ❌              ✅              ⚠️
低 │ [日志污染]     [临时文件]      [性能下降]
   │     ❌              ✅              ⚠️
   └────────────────────────────────────→ 可能性
      低            中            高
```

---

## 🛡️ 增强防护方案

### 方案 1：脚本内容静态分析（推荐）⭐

在执行脚本前，分析脚本内容，检测危险模式。

#### 实现

**文件**：`server/src/security/ScriptAnalyzer.ts`（新建）

```typescript
export class ScriptAnalyzer {
  // Python 危险模式
  private static PYTHON_DANGEROUS_PATTERNS = [
    /import\s+subprocess/,
    /import\s+os/,
    /from\s+subprocess\s+import/,
    /from\s+os\s+import/,
    /exec\s*\(/,
    /eval\s*\(/,
    /__import__\s*\(/,
    /compile\s*\(/,
    /open\s*\([^)]*['"]\/etc\//,  // 访问系统文件
    /socket\./,                    // 网络操作
    /urllib/,
    /requests\./,
  ];
  
  // Node.js 危险模式
  private static NODE_DANGEROUS_PATTERNS = [
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /require\s*\(\s*['"]fs['"]\s*\)/,
    /require\s*\(\s*['"]net['"]\s*\)/,
    /require\s*\(\s*['"]http['"]\s*\)/,
    /require\s*\(\s*['"]https['"]\s*\)/,
    /\.exec\s*\(/,
    /\.spawn\s*\(/,
    /\.fork\s*\(/,
    /eval\s*\(/,
    /Function\s*\(/,
  ];
  
  // Shell 危险模式
  private static SHELL_DANGEROUS_PATTERNS = [
    /docker/i,
    /kubectl/i,
    /sudo/i,
    /su\s/i,
    /curl\s/i,
    /wget\s/i,
    /nc\s/i,
    /netcat/i,
    /\/dev\/tcp/i,
  ];
  
  static analyzePython(code: string): { safe: boolean; reasons: string[] } {
    const reasons: string[] = [];
    
    for (const pattern of this.PYTHON_DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        reasons.push(`检测到危险模式: ${pattern.source}`);
      }
    }
    
    return {
      safe: reasons.length === 0,
      reasons,
    };
  }
  
  static analyzeNodeJS(code: string): { safe: boolean; reasons: string[] } {
    const reasons: string[] = [];
    
    for (const pattern of this.NODE_DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        reasons.push(`检测到危险模式: ${pattern.source}`);
      }
    }
    
    return {
      safe: reasons.length === 0,
      reasons,
    };
  }
  
  static analyzeShell(code: string): { safe: boolean; reasons: string[] } {
    const reasons: string[] = [];
    
    for (const pattern of this.SHELL_DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        reasons.push(`检测到危险模式: ${pattern.source}`);
      }
    }
    
    return {
      safe: reasons.length === 0,
      reasons,
    };
  }
  
  static analyze(filename: string, code: string): { safe: boolean; reasons: string[] } {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    switch (ext) {
      case 'py':
        return this.analyzePython(code);
      case 'js':
      case 'ts':
        return this.analyzeNodeJS(code);
      case 'sh':
      case 'bash':
        return this.analyzeShell(code);
      default:
        return { safe: true, reasons: [] };
    }
  }
}
```

#### 集成到 file.write

**文件**：`server/src/orchestrator/tools/file/write.ts`

```typescript
import { ScriptAnalyzer } from '../../../security/ScriptAnalyzer.js';

export function createFileWriteHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    // ... 现有代码 ...
    
    // 安全检查：分析脚本内容
    const isScript = /\.(py|js|ts|sh|bash)$/i.test(path);
    if (isScript) {
      const analysis = ScriptAnalyzer.analyze(path, content);
      if (!analysis.safe) {
        return {
          ok: false,
          error: `脚本包含危险操作，已被拦截：\n${analysis.reasons.join('\n')}`,
        };
      }
    }
    
    // ... 写入文件 ...
  };
}
```

**优点**：
- ✅ 在执行前拦截
- ✅ 明确告知用户原因
- ✅ 可配置规则

**缺点**：
- ⚠️ 可能误报（合法代码被拦截）
- ⚠️ 可能漏报（混淆代码绕过）

---

### 方案 2：沙箱内禁用危险模块（推荐）⭐⭐

修改容器镜像，移除或限制危险模块。

#### Python 限制

**文件**：`docker/sandbox.Dockerfile`

```dockerfile
FROM node:20-alpine

# 安装 Python（受限版本）
RUN apk add --no-cache python3 py3-pip

# 创建受限的 Python 环境
RUN python3 -m venv /opt/restricted-python

# 只安装安全的包
RUN /opt/restricted-python/bin/pip install --no-cache-dir \
    numpy pandas matplotlib

# 移除危险模块
RUN rm -rf /opt/restricted-python/lib/python*/subprocess.py \
           /opt/restricted-python/lib/python*/socket.py \
           /opt/restricted-python/lib/python*/urllib/ \
           /opt/restricted-python/lib/python*/http/

# 创建 python3 别名
RUN ln -s /opt/restricted-python/bin/python3 /usr/local/bin/python3-safe

# 默认使用受限 Python
ENV PATH="/opt/restricted-python/bin:$PATH"
```

#### Node.js 限制

**方法 1**：使用 `--experimental-policy`

```json
// policy.json
{
  "resources": {
    "file:///workspace/**": {
      "integrity": true,
      "dependencies": {
        "child_process": false,
        "fs": true,
        "net": false,
        "http": false,
        "https": false
      }
    }
  }
}
```

**方法 2**：使用 `vm2` 沙箱

```typescript
import { VM } from 'vm2';

const vm = new VM({
  timeout: 5000,
  sandbox: {
    console,
    // 不提供 require
  },
});

vm.run(userCode);
```

**优点**：
- ✅ 从根本上防止危险操作
- ✅ 无法绕过

**缺点**：
- ⚠️ 限制了合法功能
- ⚠️ 需要维护白名单

---

### 方案 3：运行时监控（辅助）

使用 `seccomp` 或 `AppArmor` 限制系统调用。

#### Seccomp Profile

**文件**：`docker/seccomp-profile.json`

```json
{
  "defaultAction": "SCMP_ACT_ALLOW",
  "syscalls": [
    {
      "names": [
        "socket",
        "connect",
        "bind",
        "listen",
        "accept"
      ],
      "action": "SCMP_ACT_ERRNO"
    }
  ]
}
```

**应用**：

```typescript
// server/src/container/UserContainerManager.ts
HostConfig: {
  SecurityOpt: [
    'seccomp=/path/to/seccomp-profile.json'
  ],
}
```

**优点**：
- ✅ 内核级防护
- ✅ 性能开销小

**缺点**：
- ⚠️ 配置复杂
- ⚠️ 可能影响正常功能

---

### 方案 4：用户确认机制（推荐）⭐⭐⭐

在执行脚本前，向用户显示脚本内容并请求确认。

#### 实现

**文件**：`server/src/orchestrator/tools/shell/run.ts`

```typescript
export function createShellRunHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const command = String(input.command ?? '').trim();
    
    // 检测是否执行脚本文件
    const isScriptExecution = /^(python3?|node|bash|sh)\s+/.test(command);
    
    if (isScriptExecution && ctx?.requireApproval) {
      // 读取脚本内容
      const scriptPath = command.split(/\s+/)[1];
      const fs = await deps.resolveFS(ctx);
      const scriptContent = await fs.read(scriptPath);
      
      // 分析脚本
      const analysis = ScriptAnalyzer.analyze(scriptPath, scriptContent);
      
      // 请求用户确认
      return {
        ok: false,
        requiresApproval: true,
        approvalMessage: `即将执行脚本: ${scriptPath}\n\n` +
          `脚本内容:\n\`\`\`\n${scriptContent}\n\`\`\`\n\n` +
          (analysis.safe 
            ? '✅ 未检测到明显的危险操作' 
            : `⚠️ 检测到潜在风险:\n${analysis.reasons.join('\n')}`),
      };
    }
    
    // 正常执行
    // ...
  };
}
```

**优点**：
- ✅ 用户完全知情
- ✅ 灵活性高
- ✅ 不影响合法操作

**缺点**：
- ⚠️ 增加用户负担
- ⚠️ 用户可能不理解风险

---

## 📋 推荐实施方案

### 阶段 1：立即实施（P0）

1. **✅ 已实施**：
   - Docker 容器隔离
   - 只读根文件系统
   - 无网络访问（默认）
   - 命令黑名单

2. **🔴 待实施**：
   - **脚本内容静态分析**（方案 1）
   - **用户确认机制**（方案 4）

### 阶段 2：中期加固（P1）

3. **🟡 待实施**：
   - **沙箱内禁用危险模块**（方案 2）
   - **Seccomp 限制**（方案 3）

### 阶段 3：长期优化（P2）

4. **🟢 待实施**：
   - 运行时行为监控
   - 异常检测与告警
   - 审计日志增强

---

## 🎯 结论

### 当前安全状况

**容器模式下**：
- ✅ 基本安全：容器隔离 + 只读根文件系统 + 无网络
- ⚠️ 中等风险：脚本可以在工作区内执行任意操作
- ❌ 高风险：如果启用网络（`networkMode: bridge`）

**直接模式下**：
- 🔴 高风险：脚本在宿主机执行，只有命令黑名单防护

### 建议

1. **生产环境必须启用容器模式**
2. **实施脚本内容静态分析**
3. **添加用户确认机制**
4. **定期审查审计日志**
5. **教育用户安全意识**

---

**文档版本**：v1.0  
**最后更新**：2026-03-01  
**状态**：✅ 分析完成，待实施加固方案
