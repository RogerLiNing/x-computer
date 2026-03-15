# SaaS 线上版本默认配置指南

作为 SaaS 线上部署时，需要为所有用户提供开箱即用的内置工具、MCP 和大模型配置，使用户无需自行配置即可开始使用。

## 1. 默认大模型配置

### 1.1 通过 .x-config.json

在 `server/.x-config.json` 或 `server/.x-config.production.json` 中配置 `llm_config`：

```json
{
  "llm_config": {
    "providers": [
      {
        "id": "openai",
        "name": "OpenAI",
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "{env:OPENAI_API_KEY}"
      },
      {
        "id": "bailian",
        "name": "阿里百炼",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "apiKey": "{env:BAILIAN_API_KEY}"
      }
    ],
    "defaultByModality": {
      "chat": { "providerId": "openai", "modelId": "gpt-4o-mini" },
      "text": { "providerId": "openai", "modelId": "gpt-4o" },
      "image": { "providerId": "openai", "modelId": "dall-e-3" },
      "vector": { "providerId": "openai", "modelId": "text-embedding-3-small" }
    }
  }
}
```

- `{env:VAR_NAME}` 占位符会从环境变量读取
- 首次登录用户会从 `GET /api/users/me/config` 合并默认配置
- 用户可在设置中覆盖或添加自己的提供商

### 1.2 推荐 SaaS 提供商组合

| 用途 | 推荐提供商 | 说明 |
|------|------------|------|
| 通用对话 | OpenAI / 阿里百炼 / DeepSeek | 按目标市场选择 |
| 长文本 | Claude / Kimi | 支持长上下文 |
| 图像生成 | fal.ai / DALL·E | 需配置 fal API Key |
| 向量嵌入 | OpenAI / 百炼 | 记忆检索用 |

## 2. 默认 MCP 服务器

### 2.1 全局 MCP（服务端配置）

通过环境变量或配置文件加载，对所有用户生效：

**方式 A：环境变量**

```bash
export X_COMPUTER_MCP_SERVERS='[
  {"id":"web-search","name":"Web Search","url":"https://your-mcp-host/search","headers":{"Authorization":"Bearer ${MCP_API_KEY}"}},
  {"id":"filesystem","name":"Filesystem","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/path/to/allowed"]}
]'
```

**方式 B：配置文件**

在项目根或 `server/` 下创建 `mcp-servers.json`：

```json
{
  "servers": [
    {
      "id": "web-search",
      "name": "Web Search",
      "url": "https://your-mcp-host/search",
      "headers": {
        "Authorization": "Bearer {env:MCP_SEARCH_API_KEY}"
      }
    },
    {
      "id": "fetch",
      "name": "Web Fetch",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch"]
    }
  ]
}
```

### 2.2 推荐 SaaS MCP 组合

| MCP | 用途 | 说明 |
|-----|------|------|
| fetch | 网页抓取 | `@modelcontextprotocol/server-fetch`，无需 Key |
| web-search | 网络搜索 | 需自建或使用第三方搜索 API |
| bing-cn-mcp | 必应搜索 | 需 BING_API_KEY |
| filesystem | 文件系统 | 沙箱内已有，可选扩展 |

### 2.3 用户级 MCP

用户可在设置 → MCP 扩展 中添加自己的 MCP，配置保存在 `db.config` 的 `mcp_config` 中。

## 3. 内置工具

X-Computer 内置工具由 `ToolExecutor` 注册，无需额外配置：

| 类别 | 工具示例 | 说明 |
|------|----------|------|
| 文件 | file.read, file.write, file.list | 沙箱内文件操作 |
| Shell | shell.run | 沙箱内命令执行 |
| 办公 | office.create_docx, office.read_xlsx | Word/Excel/PPT |
| 多媒体 | llm.generate_image, llm.generate_music | 需配置 fal/OpenAI |
| 记忆 | memory_search, memory_embed_add | 需配置向量模型 |
| 搜索 | search.web | 委托已注入的 MCP |
| X 主脑 | x.notify_user, x.schedule_run | 系统能力 |

**试用版限制**：仅开放基础工具（file、shell、基础 chat）。MCP 工具、高级办公、多媒体、记忆等需专业版及以上。

## 4. 套餐与功能对应

| 套餐 | AI 调用 | 存储 | 并发任务 | MCP | 高级工具 | 多媒体 |
|------|---------|------|----------|-----|----------|--------|
| trial | 100 | 100MB | 1 | ❌ | ❌ | ❌ |
| personal | 1,000 | 1GB | 3 | 最多 2 个 | 部分 | 基础 |
| pro | 5,000 | 10GB | 10 | 无限制 | 全部 | 全部 |
| enterprise | 无限制 | 无限制 | 无限制 | 无限制 | 全部 | 全部 |

## 5. 部署检查清单

- [ ] 配置 `llm_config` 默认提供商与模型
- [ ] 设置 `OPENAI_API_KEY` 或 `BAILIAN_API_KEY` 等环境变量
- [ ] 配置 `X_COMPUTER_MCP_SERVERS` 或 `mcp-servers.json`（可选）
- [ ] 配置 `auth.allowRegister`、`auth.allowAnonymous`
- [ ] 配置 Stripe 价格 ID（见 STRIPE_SETUP.md）
- [ ] 配置 `container.enabled: true` 用于生产隔离

## 6. 相关文档

- [STRIPE_SETUP.md](./STRIPE_SETUP.md) - 支付与订阅配置
- [CONFIGURATION.md](./CONFIGURATION.md) - 完整配置说明
- [MCP_CONFIG.md](./MCP_CONFIG.md) - MCP 配置详解（若存在）
