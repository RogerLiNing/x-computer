/**
 * 默认配置加载器：仅从 server/.x-config.json 读取默认 LLM、API Key 等。
 *
 * 配置查找顺序：
 * 1. X_COMPUTER_CONFIG_PATH - 显式指定配置文件路径（环境变量）
 * 2. process.cwd()/server/.x-config.json - 项目 server 目录（默认）
 *
 * 用户不可配置默认值，仅专业版用户可覆盖配置。
 * API Key 支持占位符 {env:VAR_NAME}，从环境变量读取。
 */

import fs from 'fs';
import path from 'path';

const CONFIG_FILENAME = '.x-config.json';

export interface XConfigProvider {
  id: string;
  name: string;
  baseUrl?: string;
  /** 支持 {env:VAR_NAME} 占位符，从环境变量解析 */
  apiKey?: string;
}

export interface XConfigDefaultByModality {
  providerId: string;
  modelId: string;
}

export interface XConfigLLM {
  providers: XConfigProvider[];
  defaultByModality?: Partial<Record<string, XConfigDefaultByModality>>;
}

/** 认证相关配置 */
export interface XConfigAuth {
  /** 是否允许注册新账号，默认 true；设为 false 可关闭注册（仅登录） */
  allowRegister?: boolean;
  /** 是否允许匿名访问，默认 true（开发模式）；生产环境建议设为 false */
  allowAnonymous?: boolean;
}

/** 容器隔离配置 */
export interface XConfigContainer {
  /** 是否启用容器隔离，默认 false（开发模式）；生产环境强烈建议设为 true */
  enabled?: boolean;
  /** CPU 核心数限制，默认 1 */
  cpuLimit?: number;
  /** 内存限制，默认 512m */
  memoryLimit?: string;
  /** 最大进程数限制，默认 100 */
  pidsLimit?: number;
  /** 网络模式：none（无网络）、bridge（桥接）、host（主机），默认 none */
  networkMode?: 'none' | 'bridge' | 'host';
  /** 容器空闲超时（毫秒），超时后自动停止容器，默认 300000（5分钟） */
  idleTimeout?: number;
  /** 容器最大空闲时间（毫秒），超时后自动删除容器，默认 86400000（24小时） */
  maxIdleTime?: number;
}

/** 数据库类型：sqlite（默认）或 mysql。MySQL 连接参数仍通过环境变量 MYSQL_HOST/PORT/USER/PASSWORD/DATABASE 配置 */
export interface XConfigDatabase {
  /** 数据库类型：sqlite（本地文件）或 mysql；默认 sqlite */
  type?: 'sqlite' | 'mysql';
}

/** 工具加载模式：all=每次都加载全部工具；on_demand=仅预置搜索/加载，按需加载工具 */
export type ToolLoadingMode = 'all' | 'on_demand';

/** 默认 MCP 服务器配置，用于联网搜索等；用户无 mcp_config 时生效 */
export interface XConfigMcpServer {
  id: string;
  url?: string;
  command?: string;
  args?: string[];
  name?: string;
  /** 支持 {env:VAR_NAME} 占位符 */
  headers?: Record<string, string>;
}

export interface XConfig {
  llm_config?: XConfigLLM;
  auth?: XConfigAuth;
  container?: XConfigContainer;
  /** 数据库类型：sqlite（默认）或 mysql；MySQL 需配置 MYSQL_* 环境变量 */
  database?: XConfigDatabase;
  /** 工具加载模式，默认 all；on_demand 可大幅减少系统提示 token */
  tool_loading_mode?: ToolLoadingMode;
  /** 默认 MCP 服务器（联网搜索等），用户无 mcp_config 时使用；格式同 mcp-servers.json 的 servers 或 mcpServers 对象 */
  mcp_servers?: XConfigMcpServer[] | Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/** 从配置或环境变量读取工具加载模式 */
export function getToolLoadingMode(): ToolLoadingMode {
  const env = process.env.X_COMPUTER_TOOL_LOADING_MODE?.toLowerCase().trim();
  if (env === 'on_demand' || env === 'all') return env;
  const cfg = loadDefaultConfig();
  const mode = (cfg?.tool_loading_mode as string)?.toLowerCase?.();
  if (mode === 'on_demand' || mode === 'all') return mode;
  return 'all';
}

function resolveEnvPlaceholders(text: string): string {
  return text.replace(/\{env:([^}]+)\}/g, (_, varName: string) => {
    return process.env[varName?.trim()] ?? '';
  });
}

function resolveRecursive(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return resolveEnvPlaceholders(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveRecursive);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = resolveRecursive(v);
    }
    return result;
  }
  return obj;
}

function getConfigCandidates(): string[] {
  const explicit = process.env.X_COMPUTER_CONFIG_PATH?.trim();
  if (explicit) {
    return [path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit)];
  }
  const cwd = process.cwd();
  return [
    path.join(cwd, CONFIG_FILENAME),
    path.join(cwd, 'server', CONFIG_FILENAME),
  ];
}

let cachedConfig: XConfig | null | undefined = undefined;

/**
 * 加载默认配置，若存在 .x-config.json 则返回解析后的对象（含 env 占位符解析），否则返回 {}。
 */
export function loadDefaultConfig(): XConfig {
  if (cachedConfig !== undefined) {
    return cachedConfig ?? {};
  }
  const candidates = getConfigCandidates();
  for (const filepath of candidates) {
    try {
      const raw = fs.readFileSync(filepath, 'utf-8');
      const parsed = JSON.parse(raw) as XConfig;
      cachedConfig = resolveRecursive(parsed) as XConfig;
      return cachedConfig;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      console.warn(`[x-computer] Failed to load config from ${filepath}:`, e);
    }
  }
  cachedConfig = null;
  return {};
}

/**
 * 清除缓存（用于测试或热重载）。
 */
export function clearDefaultConfigCache(): void {
  cachedConfig = undefined;
}
