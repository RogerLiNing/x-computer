import type { PluginManifest } from '../../../shared/src/index.js';

export type RuntimeProfile = 'lightweight' | 'balanced' | 'full';

export type ServerPluginId =
  | 'autonomy'
  | 'automation'
  | 'messaging'
  | 'productivity'
  | 'mcp'
  | 'heartbeat'
  | 'billing'
  | 'admin'
  | 'page-index';

export interface ServerPluginManifest extends PluginManifest {
  id: ServerPluginId;
}

const MANIFESTS: ServerPluginManifest[] = [
  {
    id: 'autonomy',
    name: '自主主脑',
    version: '1.0.0',
    description: '主动任务、智能体和事件驱动执行',
    permissions: ['llm', 'tools.execute', 'scheduler'],
    startupPolicy: 'on-demand',
    resourceBudget: { memoryMb: 160, cpuPercent: 25, backgroundTasks: 2 },
    backend: { routes: ['/api/agents', '/api/x/*'], tools: ['agent.*'] },
  },
  {
    id: 'automation',
    name: '自动化与调度',
    version: '1.0.0',
    description: '定时任务、Webhook 和工作流触发',
    permissions: ['scheduler', 'network'],
    startupPolicy: 'manual',
    resourceBudget: { memoryMb: 96, cpuPercent: 15, backgroundTasks: 2 },
    backend: { routes: ['/api/scheduler', '/api/scheduled-jobs', '/webhook'] },
  },
  {
    id: 'messaging',
    name: '消息渠道',
    version: '1.0.0',
    description: '邮件、QQ、Slack、Discord、Telegram 与 WhatsApp',
    permissions: ['network', 'messaging.receive', 'messaging.send'],
    startupPolicy: 'manual',
    resourceBudget: { memoryMb: 192, cpuPercent: 20, backgroundTasks: 6 },
    backend: { routes: ['/api/email', '/api/messaging/*'] },
  },
  {
    id: 'productivity',
    name: '生产力数据',
    version: '1.0.0',
    description: '笔记、日历、书签、计划和日志',
    permissions: ['database.read', 'database.write'],
    startupPolicy: 'on-demand',
    resourceBudget: { memoryMb: 64, cpuPercent: 10, backgroundTasks: 0 },
    backend: { routes: ['/api/calendar', '/api/notes', '/api/bookmarks'] },
  },
  {
    id: 'mcp',
    name: 'MCP 扩展',
    version: '1.0.0',
    description: '连接外部 MCP 服务并注册工具',
    permissions: ['network', 'tools.register'],
    startupPolicy: 'manual',
    resourceBudget: { memoryMb: 192, cpuPercent: 20, backgroundTasks: 4 },
    backend: { routes: ['/api/mcp'], tools: ['mcp.*'] },
  },
  {
    id: 'heartbeat',
    name: '主动心跳',
    version: '1.0.0',
    description: '周期检查、主动提醒与每日摘要',
    permissions: ['scheduler', 'notifications.send', 'llm'],
    startupPolicy: 'manual',
    resourceBudget: { memoryMb: 96, cpuPercent: 10, backgroundTasks: 1 },
    backend: { routes: ['/api/heartbeat'] },
  },
  {
    id: 'billing',
    name: '订阅计费',
    version: '1.0.0',
    description: '套餐、额度与支付',
    permissions: ['account.manage', 'network'],
    startupPolicy: 'on-demand',
    resourceBudget: { memoryMb: 64, cpuPercent: 10, backgroundTasks: 0 },
    backend: { routes: ['/api/subscriptions'] },
  },
  {
    id: 'admin',
    name: '管理后台',
    version: '1.0.0',
    description: '用户、内容、功能开关和系统运营',
    permissions: ['admin', 'database.read', 'database.write'],
    startupPolicy: 'on-demand',
    resourceBudget: { memoryMb: 96, cpuPercent: 15, backgroundTasks: 0 },
    backend: { routes: ['/api/admin/*'] },
  },
  {
    id: 'page-index',
    name: '文档索引',
    version: '1.0.0',
    description: '大文档索引、检索和解析',
    permissions: ['filesystem.read', 'filesystem.write', 'llm'],
    startupPolicy: 'on-demand',
    resourceBudget: { memoryMb: 256, cpuPercent: 30, backgroundTasks: 1 },
    backend: { routes: ['/api/pageindex'], tools: ['pageindex.*'] },
  },
];

const PROFILE_PLUGINS: Record<RuntimeProfile, ServerPluginId[]> = {
  lightweight: ['billing'],
  balanced: ['autonomy', 'automation', 'productivity', 'heartbeat', 'billing', 'page-index'],
  full: MANIFESTS.map((manifest) => manifest.id),
};

function parseProfile(value: unknown): RuntimeProfile {
  if (value === 'balanced' || value === 'full') return value;
  return 'lightweight';
}

function parsePluginList(value: string | undefined): ServerPluginId[] {
  if (!value) return [];
  const known = new Set(MANIFESTS.map((manifest) => manifest.id));
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id): id is ServerPluginId => known.has(id as ServerPluginId));
}

export class PluginRegistry {
  readonly profile: RuntimeProfile;
  private readonly enabled: Set<ServerPluginId>;

  constructor(profile: RuntimeProfile, enabled: Iterable<ServerPluginId>) {
    this.profile = profile;
    this.enabled = new Set(enabled);
  }

  isEnabled(id: ServerPluginId): boolean {
    return this.enabled.has(id);
  }

  list(): Array<ServerPluginManifest & { enabled: boolean }> {
    return MANIFESTS.map((manifest) => ({
      ...manifest,
      enabled: this.isEnabled(manifest.id),
    }));
  }
}

export function createPluginRegistry(profileValue?: RuntimeProfile): PluginRegistry {
  const profile = parseProfile(
    profileValue
      ?? process.env.X_COMPUTER_PROFILE
      ?? process.env.X_COMPUTER_RUNTIME_PROFILE,
  );
  const enabled = new Set(PROFILE_PLUGINS[profile]);
  parsePluginList(process.env.X_COMPUTER_PLUGINS).forEach((id) => enabled.add(id));
  parsePluginList(process.env.X_COMPUTER_DISABLED_PLUGINS).forEach((id) => enabled.delete(id));
  return new PluginRegistry(profile, enabled);
}
