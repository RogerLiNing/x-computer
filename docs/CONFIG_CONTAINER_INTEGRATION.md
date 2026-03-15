# 容器配置集成说明

## 📋 概述

已将容器隔离配置集成到 `.x-config.json` 统一配置系统中，实现：

✅ **统一配置管理**：所有配置项集中在一个文件  
✅ **JSON Schema 支持**：IDE 自动补全和验证  
✅ **多环境切换**：开发/生产配置轻松切换  
✅ **配置优先级**：代码 > 配置文件 > 环境变量 > 默认值  
✅ **向后兼容**：保留环境变量配置方式  

---

## 🎯 主要改进

### 1. 配置结构扩展

**文件**：`server/src/config/defaultConfig.ts`

新增 `XConfigContainer` 接口：

```typescript
export interface XConfigContainer {
  enabled?: boolean;          // 是否启用容器隔离
  cpuLimit?: number;          // CPU 核心数限制
  memoryLimit?: string;       // 内存限制
  pidsLimit?: number;         // 最大进程数限制
  networkMode?: 'none' | 'bridge' | 'host';  // 网络模式
  idleTimeout?: number;       // 容器空闲超时（毫秒）
  maxIdleTime?: number;       // 容器最大空闲时间（毫秒）
}
```

### 2. 容器管理器增强

**文件**：`server/src/container/UserContainerManager.ts`

新增 `UserContainerManagerOptions` 接口：

```typescript
export interface UserContainerManagerOptions {
  imageName?: string;
  cpuLimit?: number;
  memoryLimit?: string;
  pidsLimit?: number;
  networkMode?: 'none' | 'bridge' | 'host';
}
```

构造函数支持配置选项：

```typescript
constructor(
  workspaceBasePath: string, 
  options: UserContainerManagerOptions = {}
)
```

### 3. 应用启动集成

**文件**：`server/src/app.ts`

配置加载优先级：

```typescript
// 1. 加载配置文件
const config = loadDefaultConfig();

// 2. 容器隔离：options > config > env > 默认值
const useContainerIsolation = 
  options.useContainerIsolation ?? 
  config.container?.enabled ?? 
  (process.env.USE_CONTAINER_ISOLATION === 'true');

// 3. 资源限制：config > env > 默认值
const containerCpuLimit = 
  config.container?.cpuLimit ?? 
  (process.env.CONTAINER_CPU_LIMIT ? parseFloat(process.env.CONTAINER_CPU_LIMIT) : 1);

// 4. 创建容器管理器
const containerManager = new UserContainerManager(workspaceRoot, {
  cpuLimit: containerCpuLimit,
  memoryLimit: containerMemoryLimit,
  pidsLimit: containerPidsLimit,
  networkMode: containerNetworkMode,
});
```

### 4. JSON Schema

**文件**：`server/config.schema.json`

提供 IDE 自动补全和验证：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "container": {
      "type": "object",
      "properties": {
        "enabled": {
          "type": "boolean",
          "default": false,
          "description": "是否启用容器隔离"
        },
        "cpuLimit": {
          "type": "number",
          "default": 1,
          "minimum": 0.1,
          "maximum": 16
        }
        // ... 其他字段
      }
    }
  }
}
```

---

## 📝 配置示例

### 开发环境（默认）

**文件**：`server/.x-config.json`

```json
{
  "$schema": "./config.schema.json",
  "container": {
    "enabled": false,
    "cpuLimit": 0.5,
    "memoryLimit": "256m",
    "pidsLimit": 100,
    "networkMode": "none"
  }
}
```

### 生产环境

**文件**：`server/.x-config.production.json`

```json
{
  "$schema": "./config.schema.json",
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

---

## 🚀 使用方式

### 方式 1：配置文件（推荐）⭐

```bash
# 1. 编辑配置文件
vim server/.x-config.json

# 2. 修改容器配置
{
  "container": {
    "enabled": true
  }
}

# 3. 启动服务器
npm run dev
```

### 方式 2：环境变量（兼容）

```bash
# 环境变量优先级低于配置文件
USE_CONTAINER_ISOLATION=true npm run dev
```

### 方式 3：多环境切换

```bash
# 使用生产配置
X_COMPUTER_CONFIG_PATH=server/.x-config.production.json npm start

# 使用测试配置
X_COMPUTER_CONFIG_PATH=server/.x-config.test.json npm test
```

---

## 🧪 测试脚本

### 1. 测试配置加载

```bash
cd server
npx tsx test-config-loading.ts
```

**预期输出**：
```
✅ 配置加载成功

1. LLM 配置:
   提供商数量: 1
   [1] 阿里百炼 (bailian)

2. 认证配置:
   allowRegister: true
   allowAnonymous: true

3. 容器配置:
   enabled: false
   cpuLimit: 0.5
   memoryLimit: 256m
   pidsLimit: 100
   networkMode: none
```

### 2. 测试容器配置

```bash
cd server
npx tsx test-container-config.ts
```

**预期输出**（启用容器时）：
```
✅ 容器配置测试通过！

配置已正确应用:
- CPU 限制: 0.5 核心
- 内存限制: 256m
- 进程限制: 100
- 网络模式: none
```

### 3. 测试容器功能

```bash
cd server
npx tsx quick-test-container.ts
```

---

## 📊 配置优先级

```
┌─────────────────────────────────────────────┐
│ 1. 代码 options（最高优先级）                │
│    createApp({ useContainerIsolation: true })│
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ 2. .x-config.json                           │
│    { "container": { "enabled": true } }     │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ 3. 环境变量                                  │
│    USE_CONTAINER_ISOLATION=true             │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ 4. 默认值（最低优先级）                      │
│    false（开发模式）                         │
└─────────────────────────────────────────────┘
```

---

## 📚 相关文档

- [配置指南](./CONFIGURATION.md) - 完整的配置文档
- [容器隔离启用指南](./HOW_TO_ENABLE_CONTAINER_ISOLATION.md) - 详细的容器配置说明
- [用户隔离分析](./USER_ISOLATION_ANALYSIS.md) - 四层隔离机制详解
- [安全容器使用指南](./SECURITY_CONTAINER_USAGE.md) - 容器安全最佳实践

---

## ✅ 向后兼容性

所有现有的环境变量配置方式仍然有效：

```bash
# 旧方式（仍然支持）
USE_CONTAINER_ISOLATION=true
CONTAINER_CPU_LIMIT=0.5
CONTAINER_MEMORY_LIMIT=256m
CONTAINER_PIDS_LIMIT=100
CONTAINER_NETWORK_MODE=none

# 新方式（推荐）
# 在 .x-config.json 中配置
```

---

## 🎯 最佳实践

### 1. 开发环境

```json
{
  "container": {
    "enabled": false
  }
}
```

**原因**：
- ✅ 快速启动（无容器开销）
- ✅ 调试方便
- ✅ 适合单用户开发

### 2. 生产环境

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

**原因**：
- ✅ 完全隔离（安全）
- ✅ 资源限制（稳定）
- ✅ 多用户支持

### 3. 敏感信息

```json
{
  "llm_config": {
    "providers": [
      {
        "apiKey": "{env:BAILIAN_API_KEY}"
      }
    ]
  }
}
```

**原因**：
- ✅ 不在配置文件中硬编码 API Key
- ✅ 使用环境变量占位符
- ✅ 安全且灵活

---

## 🔄 迁移指南

### 从环境变量迁移到配置文件

**旧方式**（`.env` 文件）：
```bash
USE_CONTAINER_ISOLATION=true
CONTAINER_CPU_LIMIT=0.5
CONTAINER_MEMORY_LIMIT=256m
CONTAINER_PIDS_LIMIT=100
CONTAINER_NETWORK_MODE=none
```

**新方式**（`.x-config.json` 文件）：
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

**迁移步骤**：

1. 创建配置文件：
   ```bash
   cat > server/.x-config.json << 'EOF'
   {
     "$schema": "./config.schema.json",
     "container": {
       "enabled": true,
       "cpuLimit": 0.5,
       "memoryLimit": "256m",
       "pidsLimit": 100,
       "networkMode": "none"
     }
   }
   EOF
   ```

2. 删除环境变量（可选）：
   ```bash
   # 从 .env 文件中删除容器相关配置
   ```

3. 测试配置：
   ```bash
   npx tsx test-config-loading.ts
   ```

4. 启动服务器：
   ```bash
   npm run dev
   ```

---

## 🎉 总结

通过将容器配置集成到 `.x-config.json`，我们实现了：

✅ **统一配置管理**：所有配置项集中在一个文件  
✅ **更好的开发体验**：JSON Schema 提供自动补全  
✅ **灵活的环境切换**：轻松切换开发/生产配置  
✅ **清晰的优先级**：配置覆盖规则明确  
✅ **向后兼容**：保留环境变量支持  

**推荐使用配置文件方式**，获得更好的开发体验和配置管理能力！
