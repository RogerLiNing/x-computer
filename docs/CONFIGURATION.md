# X-Computer 配置指南

## 📋 概述

X-Computer 使用 `.x-config.json` 文件进行统一配置管理，支持：

- ✅ LLM 提供商和模型配置
- ✅ 认证和授权配置
- ✅ 容器隔离和资源限制
- ✅ 工具加载模式
- ✅ 环境变量占位符
- ✅ JSON Schema 自动补全

---

## 📁 配置文件位置

配置文件查找顺序（优先级从高到低）：

1. **`X_COMPUTER_CONFIG_PATH`** - 环境变量显式指定
2. **`$X_COMPUTER_WORKSPACE/.x-config.json`** - 工作区根目录
3. **`~/.x-computer/.x-config.json`** - 用户主目录
4. **`process.cwd()/.x-config.json`** - 当前工作目录
5. **`process.cwd()/server/.x-config.json`** - server 子目录

**推荐位置**：
- 开发环境：`server/.x-config.json`
- 生产环境：`~/.x-computer/.x-config.json` 或环境变量指定

---

## 🚀 快速开始

### 1. 创建配置文件

```bash
# 开发环境（默认）
cat > server/.x-config.json << 'EOF'
{
  "$schema": "./config.schema.json",
  "tool_loading_mode": "all",
  "llm_config": {
    "providers": [
      {
        "id": "bailian",
        "name": "阿里百炼",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "apiKey": "{env:BAILIAN_API_KEY}"
      }
    ],
    "defaultByModality": {
      "chat": { "providerId": "bailian", "modelId": "qwen3.5-plus" }
    }
  },
  "auth": {
    "allowRegister": true,
    "allowAnonymous": true
  },
  "container": {
    "enabled": false
  }
}
EOF
```

### 2. 设置环境变量

```bash
# 创建 .env 文件
cat > server/.env << 'EOF'
BAILIAN_API_KEY=sk-your-api-key-here
EOF
```

### 3. 启动服务器

```bash
npm run dev
```

---

## 📚 配置字段详解

### `tool_loading_mode`

**类型**：`"all" | "on_demand"`  
**默认值**：`"all"`

工具加载模式：
- `all`：每次都加载全部工具（完整功能）
- `on_demand`：仅预置搜索/加载，按需加载工具（减少 token）

**示例**：
```json
{
  "tool_loading_mode": "on_demand"
}
```

---

### `llm_config`

LLM 提供商和模型配置。

#### `llm_config.providers`

**类型**：`Array<Provider>`

提供商列表，每个提供商包含：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | ✅ | 提供商唯一标识 |
| `name` | `string` | ✅ | 提供商显示名称 |
| `baseUrl` | `string` | ❌ | API 基础 URL |
| `apiKey` | `string` | ❌ | API Key，支持 `{env:VAR_NAME}` 占位符 |

**示例**：
```json
{
  "llm_config": {
    "providers": [
      {
        "id": "bailian",
        "name": "阿里百炼",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "apiKey": "{env:BAILIAN_API_KEY}"
      },
      {
        "id": "openai",
        "name": "OpenAI",
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "{env:OPENAI_API_KEY}"
      }
    ]
  }
}
```

#### `llm_config.defaultByModality`

**类型**：`Record<string, { providerId: string; modelId: string }>`

按模态类型的默认模型配置。

**支持的模态类型**：
- `chat`：聊天对话
- `text`：文本生成
- `video`：视频理解
- `image`：图像理解
- `image_edit`：图像编辑
- `vector`：向量嵌入

**示例**：
```json
{
  "llm_config": {
    "defaultByModality": {
      "chat": { "providerId": "bailian", "modelId": "qwen3.5-plus" },
      "text": { "providerId": "bailian", "modelId": "qwen3.5-plus" },
      "image": { "providerId": "bailian", "modelId": "qwen3.5-plus" },
      "image_edit": { "providerId": "bailian", "modelId": "qwen-image-plus-2026-01-09" },
      "vector": { "providerId": "bailian", "modelId": "text-embedding-v4" }
    }
  }
}
```

---

### `auth`

认证和授权配置。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `allowRegister` | `boolean` | `true` | 是否允许注册新账号 |
| `allowAnonymous` | `boolean` | `true` | 是否允许匿名访问 |

**示例**：
```json
{
  "auth": {
    "allowRegister": true,
    "allowAnonymous": false
  }
}
```

**使用场景**：
- 开发环境：`allowAnonymous: true`（快速测试）
- 生产环境：`allowAnonymous: false`（强制登录）
- 私有部署：`allowRegister: false`（仅管理员添加用户）

---

### `database`

数据库类型配置。连接参数通过环境变量配置。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `type` | `"sqlite" \| "mysql"` | `"sqlite"` | 数据库类型 |

#### SQLite（默认）

本地文件存储，无需额外配置。

```json
{
  "database": {
    "type": "sqlite"
  }
}
```

数据文件位于工作区：`{workspace}/x-computer.db`。

#### MySQL

需配置环境变量（连接参数不写入配置文件，避免密码泄露）：

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `MYSQL_HOST` | 主机地址 | `localhost` |
| `MYSQL_PORT` | 端口 | `3306` |
| `MYSQL_USER` | 用户名 | `root` |
| `MYSQL_PASSWORD` | 密码 | （必填） |
| `MYSQL_DATABASE` | 数据库名 | `x_computer` |

**示例**：`.x-config.json` 中启用 MySQL：

```json
{
  "database": {
    "type": "mysql"
  }
}
```

**环境变量**（`server/.env` 或启动前设置）：

```bash
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-password
MYSQL_DATABASE=x_computer
```

**自动启动容器**：若 `MYSQL_HOST` 为 `localhost` 且连接失败，会检查并启动 Docker 容器 `x-computer-mysql`。需确保 3306 端口未被占用，或设置 `MYSQL_PORT=3307` 等空闲端口。

---

### `container`

容器隔离和资源限制配置。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | `boolean` | `false` | 是否启用容器隔离 |
| `cpuLimit` | `number` | `1` | CPU 核心数限制 |
| `memoryLimit` | `string` | `"512m"` | 内存限制 |
| `pidsLimit` | `number` | `100` | 最大进程数限制 |
| `networkMode` | `string` | `"none"` | 网络模式 |
| `idleTimeout` | `number` | `300000` | 容器空闲超时（毫秒） |
| `maxIdleTime` | `number` | `86400000` | 容器最大空闲时间（毫秒） |

**示例**：
```json
{
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

#### `container.enabled`

**类型**：`boolean`  
**默认值**：`false`

是否启用容器隔离。

- `false`：直接模式（宿主机执行，快速）
- `true`：容器模式（Docker 隔离，安全）

**建议**：
- 开发环境：`false`
- 生产环境：`true`

#### `container.cpuLimit`

**类型**：`number`  
**默认值**：`1`  
**范围**：`0.1 - 16`

CPU 核心数限制。

- `0.5`：50% 单核
- `1`：1 个完整核心
- `2`：2 个完整核心

**建议**：
- 轻量任务：`0.5`
- 一般任务：`1`
- 计算密集：`2`

#### `container.memoryLimit`

**类型**：`string`  
**默认值**：`"512m"`  
**格式**：`数字 + 单位（m/g）`

内存限制。

**示例**：
- `"256m"`：256 MB
- `"512m"`：512 MB
- `"1g"`：1 GB

**建议**：
- 轻量任务：`256m`
- 一般任务：`512m`
- 内存密集：`1g`

#### `container.pidsLimit`

**类型**：`number`  
**默认值**：`100`  
**范围**：`10 - 1000`

最大进程数限制（防止 fork 炸弹）。

**建议**：
- 一般场景：`100`
- 限制严格：`50`
- 宽松限制：`200`

#### `container.networkMode`

**类型**：`"none" | "bridge" | "host"`  
**默认值**：`"none"`

网络模式。

| 模式 | 说明 | 安全性 | 适用场景 |
|------|------|--------|----------|
| `none` | 无网络访问 | 最高 | 纯计算任务 |
| `bridge` | 桥接网络（允许外网） | 中等 | 需要下载资源 |
| `host` | 主机网络（与宿主机共享） | 最低 | 特殊需求 |

**建议**：
- 默认：`none`（最安全，沙箱内 curl/wget 等无法访问外网）
- 需要网络：`bridge`（允许沙箱内 curl、pip install、npm install 等访问外网）
- 避免使用：`host`

**注意**：修改 `networkMode` 后，需删除已有用户容器并重启服务，新容器才会生效：
```bash
docker ps -a --filter "name=x-computer-user" -q | xargs -r docker rm -f
# 然后重启 npm run dev
```

#### `container.idleTimeout`

**类型**：`number`  
**默认值**：`300000`（5 分钟）  
**单位**：毫秒

容器空闲超时，超时后自动停止容器（节省资源）。

**注意**：此功能尚未实现（TODO）。

#### `container.maxIdleTime`

**类型**：`number`  
**默认值**：`86400000`（24 小时）  
**单位**：毫秒

容器最大空闲时间，超时后自动删除容器（释放资源）。

**注意**：此功能尚未实现（TODO）。

---

## 🔧 高级用法

### 环境变量占位符

配置中可以使用 `{env:VAR_NAME}` 占位符从环境变量读取值。

**示例**：
```json
{
  "llm_config": {
    "providers": [
      {
        "id": "bailian",
        "apiKey": "{env:BAILIAN_API_KEY}"
      }
    ]
  }
}
```

**环境变量**：
```bash
export BAILIAN_API_KEY=sk-your-api-key-here
```

**解析结果**：
```json
{
  "llm_config": {
    "providers": [
      {
        "id": "bailian",
        "apiKey": "sk-your-api-key-here"
      }
    ]
  }
}
```

---

### 多环境配置

#### 方式 1：多个配置文件

```bash
# 开发环境
server/.x-config.json

# 生产环境
server/.x-config.production.json

# 测试环境
server/.x-config.test.json
```

**切换环境**：
```bash
# 使用生产配置
X_COMPUTER_CONFIG_PATH=server/.x-config.production.json npm start

# 使用测试配置
X_COMPUTER_CONFIG_PATH=server/.x-config.test.json npm test
```

#### 方式 2：环境变量覆盖

```bash
# 开发环境（默认）
npm run dev

# 生产环境（容器隔离）
USE_CONTAINER_ISOLATION=true npm start

# 测试环境（匿名访问）
ALLOW_ANONYMOUS=true npm test
```

---

### 配置优先级

配置加载优先级（从高到低）：

```
代码 options > .x-config.json > 环境变量 > 默认值
```

**示例**：

1. **代码 options**（最高优先级）：
   ```typescript
   createApp({
     useContainerIsolation: true,
     allowAnonymous: false,
   });
   ```

2. **`.x-config.json`**：
   ```json
   {
     "container": { "enabled": true },
     "auth": { "allowAnonymous": false }
   }
   ```

3. **环境变量**：
   ```bash
   USE_CONTAINER_ISOLATION=true
   ALLOW_ANONYMOUS=false
   ```

4. **默认值**：
   ```typescript
   {
     useContainerIsolation: false,
     allowAnonymous: true,
   }
   ```

---

## 📝 配置示例

### 开发环境

```json
{
  "$schema": "./config.schema.json",
  "tool_loading_mode": "all",
  "llm_config": {
    "providers": [
      {
        "id": "bailian",
        "name": "阿里百炼",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "apiKey": "sk-your-dev-key"
      }
    ],
    "defaultByModality": {
      "chat": { "providerId": "bailian", "modelId": "qwen3.5-plus" }
    }
  },
  "auth": {
    "allowRegister": true,
    "allowAnonymous": true
  },
  "container": {
    "enabled": false
  }
}
```

### 生产环境

```json
{
  "$schema": "./config.schema.json",
  "tool_loading_mode": "all",
  "llm_config": {
    "providers": [
      {
        "id": "bailian",
        "name": "阿里百炼",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "apiKey": "{env:BAILIAN_API_KEY}"
      }
    ],
    "defaultByModality": {
      "chat": { "providerId": "bailian", "modelId": "qwen3.5-plus" }
    }
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
    "networkMode": "none"
  }
}
```

### 私有部署

```json
{
  "$schema": "./config.schema.json",
  "tool_loading_mode": "all",
  "llm_config": {
    "providers": [
      {
        "id": "local-llm",
        "name": "本地 LLM",
        "baseUrl": "http://localhost:11434/v1",
        "apiKey": "not-needed"
      }
    ],
    "defaultByModality": {
      "chat": { "providerId": "local-llm", "modelId": "qwen2.5:14b" }
    }
  },
  "auth": {
    "allowRegister": false,
    "allowAnonymous": false
  },
  "container": {
    "enabled": true,
    "cpuLimit": 1,
    "memoryLimit": "512m",
    "pidsLimit": 100,
    "networkMode": "bridge"
  }
}
```

---

## 🛠️ 故障排查

### 问题 1：配置未生效

**症状**：修改配置后，服务器行为未改变。

**原因**：配置缓存未清除。

**解决**：
```bash
# 重启服务器
npm run dev
```

### 问题 2：环境变量占位符未解析

**症状**：`apiKey` 显示为 `{env:VAR_NAME}`。

**原因**：环境变量未设置。

**解决**：
```bash
# 检查环境变量
echo $BAILIAN_API_KEY

# 设置环境变量
export BAILIAN_API_KEY=sk-your-key

# 或使用 .env 文件
echo "BAILIAN_API_KEY=sk-your-key" > server/.env
```

### 问题 3：找不到配置文件

**症状**：服务器使用默认配置。

**原因**：配置文件位置错误。

**解决**：
```bash
# 检查配置文件位置
ls -la server/.x-config.json
ls -la ~/.x-computer/.x-config.json

# 或显式指定配置文件
X_COMPUTER_CONFIG_PATH=/path/to/config.json npm run dev
```

### 问题 4：JSON 格式错误

**症状**：启动时报错 `Failed to load config`。

**原因**：JSON 格式不正确。

**解决**：
```bash
# 验证 JSON 格式
cat server/.x-config.json | jq .

# 或使用在线工具
# https://jsonlint.com/
```

---

## 📚 相关文档

- [容器隔离启用指南](./HOW_TO_ENABLE_CONTAINER_ISOLATION.md) - 详细的容器配置说明
- [用户隔离分析](./USER_ISOLATION_ANALYSIS.md) - 四层隔离机制详解
- [安全容器使用指南](./SECURITY_CONTAINER_USAGE.md) - 容器安全最佳实践
- [生产环境就绪](./PRODUCTION_READINESS.md) - 生产部署清单

---

## 🎯 最佳实践

### 1. 敏感信息管理

❌ **不要**：
```json
{
  "llm_config": {
    "providers": [
      {
        "apiKey": "sk-your-secret-key-here"
      }
    ]
  }
}
```

✅ **推荐**：
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

### 2. 环境隔离

- 开发环境：`server/.x-config.json`（Git 忽略）
- 生产环境：`~/.x-computer/.x-config.json`（系统级）
- CI/CD：环境变量（安全）

### 3. 版本控制

```bash
# .gitignore
server/.x-config.json
server/.env

# 提交模板配置
server/.x-config.example.json
```

### 4. 配置验证

```bash
# 启动前验证配置
cat server/.x-config.json | jq .

# 检查必需的环境变量
env | grep -E "(BAILIAN|OPENAI|STRIPE)"
```

---

## 📖 JSON Schema 支持

配置文件支持 JSON Schema，提供 IDE 自动补全和验证。

**VS Code**：
```json
{
  "$schema": "./config.schema.json"
}
```

**效果**：
- ✅ 字段自动补全
- ✅ 类型检查
- ✅ 内联文档
- ✅ 错误提示
