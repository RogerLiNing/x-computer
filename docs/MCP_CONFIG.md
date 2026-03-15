# MCP 配置说明

网络搜索等能力通过 **MCP（Model Context Protocol）** 接入，由你提供 MCP 服务器配置后，主脑即可在对话与任务中调用这些工具。

## 如何让 AI 使用 MCP

1. **配置 MCP 服务器**（任选其一）  
   - **推荐**：打开 **设置 → MCP 扩展**，用表单添加或粘贴 JSON（支持 `mcpServers` / `servers` 格式），点击「保存并重载」。  
   - 或在工作区根目录放置 `mcp-servers.json`（格式见下文），重启后端。

2. **生效方式**  
   配置保存并重载后，MCP 工具会注册为 `mcp.{服务器id}.{工具名}`（如 `mcp.web-search.web_search`），并自动加入「当前可用能力」注入到主脑系统提示。**无需额外配置**：普通对话走 Agent 循环，后端会把所有工具（含 MCP）传给大模型，AI 在需要时会自动选择并调用。

3. **使用方式**  
   - 在**聊天**里直接提问（如「搜一下今天的新闻」「用必应查 XXX」），AI 会按需调用 MCP 工具并基于结果回答。  
   - 在**任务**中创建涉及搜索、网页、Context7 等的需求时，规划与执行阶段同样会使用已加载的 MCP 工具。

4. **确认是否生效**  
   - 设置 → MCP 扩展：查看「已加载: N 个工具」。  
   - 或请求 **GET /api/mcp/status**、**GET /api/capabilities**，检查是否有 `mcp.xxx.*` 能力。

## 界面配置（推荐）

在 **设置 → MCP 扩展** 中可：

- **添加服务器**：表单添加（HTTP/Stdio）或 **导入 JSON** 粘贴 mcpServers / servers 格式
- **测试连接**：验证服务器是否可达并列举工具
- **保存并重载**：将配置写入文件并立即生效

连接方式说明：

- **HTTP**：URL 为 MCP 的 JSON-RPC POST 端点，如 `https://mcp.exa.ai/mcp`；需认证时在 headers 中配置 `Authorization: Bearer YOUR_KEY`
- **Stdio**：本地进程，如 `npx bing-cn-mcp`

## 配置方式（文件 / 环境变量）

### 1. 配置文件

在项目根目录或工作区根目录创建 `mcp-servers.json`，支持两种格式：

**格式 A：servers 数组**

```json
{
  "servers": [
    {
      "id": "search",
      "url": "https://mcp.exa.ai/mcp",
      "name": "网络搜索",
      "headers": {
        "Authorization": "Bearer YOUR_EXA_API_KEY"
      }
    },
    {
      "id": "my-mcp",
      "url": "http://localhost:3001/mcp",
      "name": "自定义 MCP"
    }
  ]
}
```

**格式 B：mcpServers 对象**（与 Cursor / Claude 等格式兼容）

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": { "CONTEXT7_API_KEY": "YOUR_API_KEY" }
    },
    "bingcn": {
      "command": "npx",
      "args": ["bing-cn-mcp"]
    }
  }
}
```

字段说明：

- **id**：唯一标识，工具注册为 `mcp.{id}.{工具名}`，如 `mcp.search.web_search_exa`
- **url**：HTTP 传输，MCP 服务器 JSON-RPC 端点（POST）；支持 `${VAR}` 占位符，从 **env** 或 `process.env` 替换
- **command** + **args**：Stdio 传输，本地进程，如 `npx bing-cn-mcp`（command: `npx`，args: `["bing-cn-mcp"]`）
- **name**：可选，显示名称
- **headers**：HTTP 传输可选，请求头（如 API Key）；值支持 `${VAR}` 替换
- **env**：（Cursor 兼容）环境变量对象，用于 URL/headers 中的 `${VAR}` 替换；可在此写 API Key，避免把密钥写在 URL 里

### API Key 与 Cursor 兼容写法

若服务商要求「URL 中带 Authorization」且你不想把密钥写死在 URL：

1. **用占位符 + env**：URL 写 `https://.../mcp?Authorization=${ZHIPU_API_KEY}`，同条配置下增加 `"env": { "ZHIPU_API_KEY": "你的真实密钥" }`，请求时会替换后再发（鉴权参数会同时放到请求头）。
2. **或直接写 headers**：`"headers": { "Authorization": "Bearer 你的密钥" }`。
3. **或系统环境变量**：URL 仍用 `?Authorization=${ZHIPU_API_KEY}`，在运行进程的环境里设置 `ZHIPU_API_KEY`，不写 env 也会从 `process.env` 替换。

配置文件查找顺序：

1. `process.env.X_COMPUTER_MCP_CONFIG` 指定路径
2. 工作区根目录 `mcp-servers.json`（若启动时指定了 `X_COMPUTER_WORKSPACE`）
3. 进程当前工作目录 `mcp-servers.json`

### 2. 环境变量

通过 `X_COMPUTER_MCP_SERVERS` 直接传入 JSON 数组（或单个服务器对象）：

```bash
export X_COMPUTER_MCP_SERVERS='[{"id":"search","url":"https://mcp.exa.ai/mcp","headers":{"Authorization":"Bearer YOUR_KEY"}}]'
```

## 协议约定

- 服务端需支持 JSON-RPC 2.0：`tools/list`（列举工具）、`tools/call`（调用工具）。
- 规范见 [Model Context Protocol - Tools](https://modelcontextprotocol.io/specification/2024-11-05/server/tools)。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/mcp/status | 已加载的服务器与工具数 |
| GET | /api/mcp/config | 当前配置（servers, configPath, fromEnv） |
| POST | /api/mcp/config | 保存配置并重载。Body: `{ servers: [...] }` 或 `{ mcpServers: { id: cfg } }` |
| POST | /api/mcp/test | 测试单个服务器。Body: McpServerConfig |
| POST | /api/mcp/reload | 从文件/环境变量重新加载（不保存） |

## 与能力列表

MCP 注册的工具会出现在 **GET /api/capabilities** 与主脑系统提示的「当前可用能力」中，名称带 `[mcp]` 前缀；聊天 Agent 循环与任务执行时均可调用。

## 常见 MCP 示例

| 用途     | 类型 | 配置要点 |
|----------|------|----------|
| 智谱 web-search | HTTP | URL 写 `?Authorization=${ZHIPU_API_KEY}` 并配 `"env": { "ZHIPU_API_KEY": "你的密钥" }`（或设系统环境变量）；或直接在 URL/headers 里写 Bearer 密钥。服务端可能返回 SSE，已支持解析。 |
| Context7 | HTTP | `url` + `headers: { "CONTEXT7_API_KEY": "..." }`；需 Accept 含 `application/json, text/event-stream`（已默认）。 |
| Bing CN (bing-cn-mcp) | Stdio | `command: "npx"`, `args: ["-y", "bing-cn-mcp"]`。 |
| 自定义 HTTP MCP | HTTP | `url` 为 JSON-RPC 端点，可选 `headers`（如 API Key）。 |
