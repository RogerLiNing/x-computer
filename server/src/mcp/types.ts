/**
 * MCP（Model Context Protocol）配置与类型
 * 用户可通过配置文件或环境变量提供 MCP 服务器列表，网络搜索等能力由 MCP 提供。
 * @see https://modelcontextprotocol.io/specification/2024-11-05/server/tools
 */

export interface McpServerConfig {
  /** 唯一标识，用于命名工具前缀 mcp.{id}.{toolName} */
  id: string;
  /** HTTP 传输：MCP 服务器 URL（JSON-RPC POST 端点）；支持 ${VAR} 从 env 或 process.env 替换 */
  url?: string;
  /** Stdio 传输：启动命令，如 npx、node */
  command?: string;
  /** Stdio 传输：命令参数，如 ["bing-cn-mcp"] */
  args?: string[];
  /** 可选显示名称 */
  name?: string;
  /** HTTP 传输：可选请求头（如 API Key）；值支持 ${VAR} 替换 */
  headers?: Record<string, string>;
  /**
   * 环境变量（Cursor 兼容）：用于 URL/headers 中的 ${VAR} 替换。
   * 优先使用此处，其次 process.env；便于在配置中写 API Key 而不暴露在 URL。
   */
  env?: Record<string, string>;
}

/** 是否为 HTTP 传输（有 url） */
export function isMcpHttpTransport(c: McpServerConfig): boolean {
  return typeof c.url === 'string' && c.url.length > 0;
}

/** 是否为 Stdio 传输（有 command） */
export function isMcpStdioTransport(c: McpServerConfig): boolean {
  return typeof c.command === 'string' && c.command.length > 0;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

/** MCP tools/list 返回的单个工具 */
export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

/** MCP tools/call 的 result.content 项 */
export interface McpContentItem {
  type: 'text' | 'image';
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface McpCallResult {
  content: McpContentItem[];
  isError?: boolean;
}
