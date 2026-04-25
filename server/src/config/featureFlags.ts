/**
 * Feature Flag 渐进式功能管理系统
 *
 * 参考 Claude Code Best 的 Feature Flag 系统，支持：
 * - 环境变量控制：X_FEATURE_XXX=true|false
 * - 运行时覆盖：通过 API 临时覆盖（不持久化）
 * - 配置中心：管理员可通过配置统一管理
 * - 用户感知：前端可查询当前启用的功能
 *
 * 使用方式：
 *   if (featureFlags().pageindex) { ... }
 *   if (await featureFlags().oauth('google')) { ... }
 */

import { serverLogger } from '../observability/ServerLogger.js';

// ── 已定义的 Feature Flags ─────────────────────────────────────────

export interface FeatureFlagDefinition {
  /** 功能唯一标识 */
  key: string;
  /** 功能名称（中文） */
  name: string;
  /** 功能描述 */
  description: string;
  /** 默认值 */
  defaultValue: boolean;
  /** 功能分类 */
  category: 'core' | 'experimental' | 'admin' | 'integrations';
  /** 关联的环境变量名 */
  envVar: string;
  /** 关联的配置文件路径（如 oauth.google.clientId） */
  configPath?: string;
}

export const FEATURE_FLAG_DEFINITIONS: FeatureFlagDefinition[] = [
  {
    key: 'oauth_google',
    name: 'Google OAuth 登录',
    description: '启用 Google 账号一键登录',
    defaultValue: false,
    category: 'integrations',
    envVar: 'X_FEATURE_OAUTH_GOOGLE',
    configPath: 'oauth.google.clientId',
  },
  {
    key: 'oauth_github',
    name: 'GitHub OAuth 登录',
    description: '启用 GitHub 账号一键登录',
    defaultValue: false,
    category: 'integrations',
    envVar: 'X_FEATURE_OAUTH_GITHUB',
    configPath: 'oauth.github.clientId',
  },
  {
    key: 'heartbeat',
    name: 'X 主脑主动通知',
    description: 'X 主脑定期主动检查并通知用户（配额告警、任务状态等）',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_HEARTBEAT',
  },
  {
    key: 'pageindex',
    name: 'PageIndex 智能检索',
    description: '基于 PageIndex 的 RAG 检索增强（联网搜索、代码检索）',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_PAGEINDEX',
  },
  {
    key: 'container_isolation',
    name: 'Docker 容器隔离',
    description: '使用 Docker 容器隔离用户操作（生产环境推荐开启）',
    defaultValue: false,
    category: 'admin',
    envVar: 'X_FEATURE_CONTAINER_ISOLATION',
  },
  {
    key: 'stripe_payments',
    name: 'Stripe 支付',
    description: '启用 Stripe 订阅支付功能',
    defaultValue: false,
    category: 'integrations',
    envVar: 'X_FEATURE_STRIPE_PAYMENTS',
    configPath: 'stripe.enabled',
  },
  {
    key: 'multiuser',
    name: '多用户模式',
    description: '允许多个用户同时使用系统（需配合容器隔离）',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_MULTIUSER',
  },
  {
    key: 'x_proactive',
    name: 'X 主脑主动消息',
    description: 'X 主脑可主动向用户发送消息（在 X 主脑入口展示）',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_X_PROACTIVE',
  },
  {
    key: 'scheduled_tasks',
    name: '定时任务',
    description: '支持用户创建定时任务，由 X 主脑按时执行',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_SCHEDULED_TASKS',
  },
  {
    key: 'mcp_servers',
    name: 'MCP 服务器',
    description: '支持配置 MCP 服务器扩展 X 主脑工具能力',
    defaultValue: true,
    category: 'integrations',
    envVar: 'X_FEATURE_MCP_SERVERS',
  },
  {
    key: 'skills',
    name: 'Skills 技能系统',
    description: '支持安装和管理 Skills 扩展 X 主脑技能',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_SKILLS',
  },
  {
    key: 'websocket',
    name: 'WebSocket 实时通信',
    description: '启用 WebSocket 实时推送（任务状态、通知等）',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_WEBSOCKET',
  },
  {
    key: 'audit_log',
    name: '审计日志',
    description: '记录所有操作日志供管理员审查',
    defaultValue: true,
    category: 'admin',
    envVar: 'X_FEATURE_AUDIT_LOG',
  },
  {
    key: 'image_generation',
    name: '图片生成',
    description: '启用图片生成工具（DALL-E、FLUX 等）',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_IMAGE_GENERATION',
  },
  {
    key: 'video_generation',
    name: '视频生成',
    description: '启用视频生成工具',
    defaultValue: true,
    category: 'experimental',
    envVar: 'X_FEATURE_VIDEO_GENERATION',
  },
  {
    key: 'speech_synthesis',
    name: '语音合成',
    description: '启用语音合成工具',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_SPEECH_SYNTHESIS',
  },
  {
    key: 'email_integration',
    name: '邮件集成',
    description: '支持配置 IMAP/SMTP 收发邮件',
    defaultValue: true,
    category: 'integrations',
    envVar: 'X_FEATURE_EMAIL_INTEGRATION',
  },
  {
    key: 'x_apps',
    name: 'X-Apps 小程序',
    description: '支持运行小程序和轻量应用',
    defaultValue: true,
    category: 'experimental',
    envVar: 'X_FEATURE_X_APPS',
  },
  {
    key: 'board_tools',
    name: '看板工具',
    description: 'X 主脑可使用的看板管理工具',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_BOARD_TOOLS',
  },
  {
    key: 'agent_tools',
    name: 'Agent 工具集',
    description: 'X 主脑可使用的 Agent 协作工具',
    defaultValue: true,
    category: 'core',
    envVar: 'X_FEATURE_AGENT_TOOLS',
  },
];

// ── Feature Flag 服务 ────────────────────────────────────────────────

interface FeatureFlagState {
  /** 当前所有功能状态（key → enabled） */
  flags: Record<string, boolean>;
  /** 上次刷新时间 */
  lastRefreshed: number;
}

let state: FeatureFlagState = {
  flags: {},
  lastRefreshed: 0,
};

const REFRESH_INTERVAL_MS = 60_000; // 每分钟刷新一次

/** 从环境变量读取布尔值（支持 true/false/1/0） */
function parseEnvBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const lower = value.toLowerCase().trim();
  if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') return true;
  if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') return false;
  return defaultValue;
}

/** 初始化：从环境变量加载所有 feature flags */
export function initFeatureFlags(): void {
  const flags: Record<string, boolean> = {};

  for (const def of FEATURE_FLAG_DEFINITIONS) {
    const envValue = process.env[def.envVar];
    flags[def.key] = parseEnvBool(envValue, def.defaultValue);
  }

  state = { flags, lastRefreshed: Date.now() };
  serverLogger.info('feature-flags', 'Feature flags 已初始化', JSON.stringify(flags));
}

/** 刷新：从环境变量重新加载（通常在 SIGHUP 或配置热重载时调用） */
export function refreshFeatureFlags(): void {
  const before = { ...state.flags };
  initFeatureFlags();
  const after = state.flags;
  const changed: string[] = [];
  for (const [key, value] of Object.entries(after)) {
    if (before[key] !== value) changed.push(`${key}: ${before[key]} → ${value}`);
  }
  if (changed.length > 0) {
    serverLogger.info('feature-flags', 'Feature flags 已刷新，变更', changed.join(', '));
  }
}

/** 检查功能是否启用 */
export function isFeatureEnabled(key: string): boolean {
  const def = FEATURE_FLAG_DEFINITIONS.find((d) => d.key === key);
  if (!def) {
    serverLogger.warn('feature-flags', `未知的功能标识: ${key}`);
    return false;
  }
  return state.flags[key] ?? def.defaultValue;
}

/** 获取所有功能状态 */
export function getAllFeatureFlags(): Record<string, boolean> {
  return { ...state.flags };
}

/** 获取功能元信息（供管理界面使用） */
export function getFeatureFlagDefinitions(): FeatureFlagDefinition[] {
  return FEATURE_FLAG_DEFINITIONS.map((def) => ({
    ...def,
    // 运行时注入当前状态
    enabled: state.flags[def.key] ?? def.defaultValue,
  }));
}

/** 获取特定分类的所有功能 */
export function getFeatureFlagsByCategory(category: FeatureFlagDefinition['category']): FeatureFlagDefinition[] {
  return FEATURE_FLAG_DEFINITIONS
    .filter((d) => d.category === category)
    .map((def) => ({
      ...def,
      enabled: state.flags[def.key] ?? def.defaultValue,
    }));
}

/** 运行时覆盖功能状态（不持久化，仅当前进程有效） */
export function overrideFeatureFlag(key: string, enabled: boolean): void {
  if (!FEATURE_FLAG_DEFINITIONS.find((d) => d.key === key)) {
    throw new Error(`未知的功能标识: ${key}`);
  }
  state.flags[key] = enabled;
  serverLogger.info('feature-flags', `运行时覆盖`, `key=${key} enabled=${enabled}`);
}

/** 批量运行时覆盖（用于测试） */
export function overrideFeatureFlags(overrides: Record<string, boolean>): void {
  for (const [key, enabled] of Object.entries(overrides)) {
    overrideFeatureFlag(key, enabled);
  }
}

/** 重置所有运行时覆盖（恢复到环境变量配置） */
export function resetFeatureFlags(): void {
  initFeatureFlags();
}

/** 获取功能统计（用于管理界面） */
export function getFeatureFlagStats(): {
  total: number;
  enabled: number;
  disabled: number;
  byCategory: Record<string, { total: number; enabled: number }>;
} {
  const stats = {
    total: FEATURE_FLAG_DEFINITIONS.length,
    enabled: 0,
    disabled: 0,
    byCategory: {} as Record<string, { total: number; enabled: number }>,
  };

  for (const def of FEATURE_FLAG_DEFINITIONS) {
    const enabled = state.flags[def.key] ?? def.defaultValue;
    if (enabled) stats.enabled++;
    else stats.disabled++;

    if (!stats.byCategory[def.category]) {
      stats.byCategory[def.category] = { total: 0, enabled: 0 };
    }
    stats.byCategory[def.category].total++;
    if (enabled) stats.byCategory[def.category].enabled++;
  }

  return stats;
}

// 初始化
initFeatureFlags();
