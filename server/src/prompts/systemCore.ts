/**
 * X-Computer 主脑：主系统提示词与场景片段
 * 统一身份、使命、能力边界；各场景在此基础之上追加片段。
 * @see docs/SUPER_AI_PROMPT_AND_EVOLUTION_PLAN.md
 */

const TZ_ASIA_SHANGHAI = 'Asia/Shanghai';

import { CORE_SYSTEM_PROMPT, MINIMAL_CORE_PROMPT, WELCOME_MESSAGE } from './systemCore/corePrompt.js';
import { TOOL_USE_MANDATE, SCHEDULED_RUN_MANDATE, CAPABILITIES_ON_DEMAND, MEMORY_TOOL_MANDATE } from './systemCore/mandates.js';
import { SCENE_FRAGMENTS } from './systemCore/scenes.js';
import type { SceneId } from './systemCore/scenes.js';
import { MEMORY_CONSIDER_SYSTEM_PROMPT, LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT } from './systemCore/memoryPrompts.js';

export {
  CORE_SYSTEM_PROMPT,
  MINIMAL_CORE_PROMPT,
  WELCOME_MESSAGE,
  TOOL_USE_MANDATE,
  MEMORY_TOOL_MANDATE,
  SCHEDULED_RUN_MANDATE,
  CAPABILITIES_ON_DEMAND,
  SCENE_FRAGMENTS,
  MEMORY_CONSIDER_SYSTEM_PROMPT,
  LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT,
};
export type { SceneId };

/** 判断时间段（东八区） */
function getTimePeriod(date: Date): string {
  const hour = parseInt(
    date.toLocaleTimeString('en-GB', { timeZone: TZ_ASIA_SHANGHAI, hour: '2-digit', hour12: false }),
    10
  );
  if (hour >= 5 && hour < 9)  return '清晨';
  if (hour >= 9 && hour < 12) return '上午';
  if (hour >= 12 && hour < 14) return '中午';
  if (hour >= 14 && hour < 18) return '下午';
  if (hour >= 18 && hour < 22) return '傍晚/晚间';
  return '深夜';
}

/** 判断一周中的位置 */
function getWeekContext(date: Date): string {
  const day = date.getDay(); // 0=Sun, 1=Mon, ...
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const weekNum = Math.ceil((date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7);
  const isWeekend = day === 0 || day === 6;
  return `${dayNames[day]}（${isWeekend ? '周末' : '工作日'}，本月第${weekNum}周）`;
}

/** 主脑应感知的「当前时间与运行环境」，人类自然会知道的内容（东八区） */
export function getCurrentAwareness(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', {
    timeZone: TZ_ASIA_SHANGHAI,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('zh-CN', {
    timeZone: TZ_ASIA_SHANGHAI,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const tz = TZ_ASIA_SHANGHAI;
  const period = getTimePeriod(now);
  const weekCtx = getWeekContext(now);
  const platformMap: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
  const platform =
    typeof process !== 'undefined' && process.platform
      ? platformMap[process.platform] ?? process.platform
      : '未知';
  const nodeVer = typeof process !== 'undefined' && process.version ? process.version : '';
  const lines = [
    `- 日期时间：${dateStr} ${timeStr}（${period}）`,
    `- ${weekCtx}（时区：${tz}）`,
    `- 运行环境：${platform}${nodeVer ? `，Node ${nodeVer}` : ''}`,
  ];
  return lines.join('\n');
}

/** 占位符：后续阶段注入能力列表、整机状态、任务摘要、记忆等 */
export const PLACEHOLDER_CAPABILITIES = '{{CAPABILITIES}}';
export const PLACEHOLDER_COMPUTER_CONTEXT = '{{COMPUTER_CONTEXT}}';
export const PLACEHOLDER_TASK_SUMMARY = '{{TASK_SUMMARY}}';
export const PLACEHOLDER_MEMORY = '{{MEMORY}}';

/**
 * 从数据库拉取并格式化用户时间线上下文（日历事件 + 定时任务）
 * 由调用方在组装系统提示词前调用，结果传入 AssembleOptions.timeline
 *
 * 支持同步（SQLite）和异步（MySQL）两种数据库实现。
 */
export async function buildTimelineContext(
  db: {
    listCalendarEvents: (userId: string, opts: { startTime: number; endTime: number }) => unknown[] | Promise<unknown[]>;
    listScheduledJobsByUser: (userId: string) => { next_run: number | null; name: string; cron: string | null; enabled: number }[] | Promise<{ next_run: number | null; name: string; cron: string | null; enabled: number }[]>;
  } | null | undefined,
  userId: string | undefined,
): Promise<string> {
  if (!db || !userId) return '';
  const now = Date.now();
  const dayEnd = now + 7 * 24 * 60 * 60 * 1000; // 未来7天

  const lines: string[] = [];

  // 日历事件（未来7天）- 兼容 sync/async
  const eventsRaw = await db.listCalendarEvents(userId, { startTime: now, endTime: dayEnd });
  const events = eventsRaw as Array<{
    title?: string; start_time?: number; end_time?: number; all_day?: number;
  }>;
  if (events.length > 0) {
    const fmtEvent = (e: { title?: string; start_time?: number; end_time?: number; all_day?: number }) => {
      const t = new Date(e.start_time ?? 0);
      const dateStr = t.toLocaleDateString('zh-CN', { timeZone: TZ_ASIA_SHANGHAI, month: 'numeric', day: 'numeric' });
      const timeStr = e.all_day ? '全天' : t.toLocaleTimeString('zh-CN', { timeZone: TZ_ASIA_SHANGHAI, hour: '2-digit', minute: '2-digit', hour12: false });
      return `- ${dateStr} ${timeStr}：${e.title ?? '（无标题）'}`;
    };
    lines.push('**即将到来的日历事件**');
    events.slice(0, 10).forEach(e => lines.push(fmtEvent(e)));
  }

  // 定时任务（未来7天内）- 兼容 sync/async
  const jobsRaw = await db.listScheduledJobsByUser(userId);
  const jobs = jobsRaw.filter((j: { next_run: number | null; enabled: number }) => j.enabled && j.next_run && j.next_run < dayEnd);
  if (jobs.length > 0) {
    const fmtJob = (j: { next_run: number | null; name: string; cron: string | null }) => {
      const t = new Date(j.next_run ?? 0);
      const dateStr = t.toLocaleDateString('zh-CN', { timeZone: TZ_ASIA_SHANGHAI, month: 'numeric', day: 'numeric' });
      const timeStr = t.toLocaleTimeString('zh-CN', { timeZone: TZ_ASIA_SHANGHAI, hour: '2-digit', minute: '2-digit', hour12: false });
      const cronHint = j.cron ? ` [${j.cron}]` : '';
      return `- ${dateStr} ${timeStr}：${j.name ?? '定时任务'}${cronHint}`;
    };
    lines.push('**即将执行的定时任务**');
    jobs.slice(0, 10).forEach(j => lines.push(fmtJob(j)));
  }

  return lines.length > 0 ? lines.join('\n') : '';
}

export interface AssembleOptions {
  scene?: SceneId;
  /** 提示词模式：full 为完整主脑提示；minimal 为轻量提示（子智能体/后台任务） */
  promptMode?: 'full' | 'minimal';
  /** 主脑可完全替换的「基础系统提示词」（身份、使命、人设）；有则替代 CORE_SYSTEM_PROMPT */
  basePrompt?: string;
  /** 按需加载模式：true 时使用 CAPABILITIES_ON_DEMAND，忽略 capabilities */
  toolLoadingModeOnDemand?: boolean;
  /** 阶段二起：注入能力列表摘要 */
  capabilities?: string;
  /** 阶段二起：注入整机状态 */
  computerContext?: string;
  /** 阶段二起：注入任务摘要 */
  taskSummary?: string;
  /** 阶段三起：注入相关记忆 */
  memory?: string;
  /** 从对话中学习到的规则与偏好（随对话不断丰富，非写死） */
  learnedPrompt?: string;
  /** 长期记忆的有效条目与主题笔记目录（MemoryService.promptMemory） */
  memoryIndex?: string;
  /** AI 自我进化的核心提示词片段（主脑通过 evolve_system_prompt 追加，系统组装时注入） */
  evolvedCorePrompt?: string;
  /** AI 助手专用说明（由 X 主脑根据用户与助手对话优化，仅注入到 AI 助手场景） */
  assistantPrompt?: string;
  /** 时间线上下文：即将到来的日历事件、定时任务等（由调用方从 DB 拉取后传入） */
  timeline?: string;
}

/**
 * 组装主脑系统提示：主提示 + 占位符替换 + 场景片段
 */
/** 将工具定义列表格式化为供主脑阅读的能力摘要（一行一条，完整描述，token 较多） */
export function formatCapabilitiesSummary(tools: Array<{ name: string; description?: string }>): string {
  if (!tools?.length) return '（暂无已注册工具）';
  return tools.map((t) => `- ${t.name}: ${t.description ?? ''}`).join('\n');
}

/**
 * 精简版能力列表：按域分组仅列工具名，用于减少系统提示 token 消耗。
 * LLM API 会下发完整 tool schema，此处只需简要提示「有哪些工具」。
 */
export function formatCapabilitiesSummaryCondensed(tools: Array<{ name: string }>): string {
  if (!tools?.length) return '（暂无已注册工具）';
  const byPrefix = new Map<string, string[]>();
  for (const t of tools) {
    const dot = t.name.indexOf('.');
    const prefix = dot > 0 ? t.name.slice(0, dot) : '_';
    const suffix = dot > 0 ? t.name.slice(dot + 1) : t.name;
    const arr = byPrefix.get(prefix) ?? [];
    arr.push(suffix);
    byPrefix.set(prefix, arr);
  }
  const parts: string[] = [];
  const order = ['file', 'llm', 'x', 'memory', 'skill', 'workflow', 'backend', 'signal', 'mcp', 'grep', 'shell', 'python', 'http', 'video', 'audio', '_'];
  for (const p of order) {
    const arr = byPrefix.get(p);
    if (!arr?.length) continue;
    const sorted = [...new Set(arr)].sort();
    const label = p === '_' ? '其他' : p;
    parts.push(`${label}: ${sorted.join(', ')}`);
  }
  const rest = [...byPrefix.keys()].filter((k) => !order.includes(k));
  for (const p of rest) {
    const arr = byPrefix.get(p)!;
    parts.push(`${p}: ${[...new Set(arr)].sort().join(', ')}`);
  }
  return '按域: ' + parts.join(' | ');
}

/**
 * 将已发现的 Skills 格式化为系统提示中的「Skills」块。
 * brief=true 时使用精简指令以节省 token。
 */
export function formatSkillsSummary(skills: Array<{ name: string; description: string }>, brief = false): string {
  if (!skills?.length) return '';
  const list = skills.map((s) => `- ${s.name}: ${(s.description ?? '').slice(0, 80)}${(s.description ?? '').length > 80 ? '…' : ''}`).join('\n');
  if (brief) {
    return [
      '\n# Skills',
      '可通过 skill.load(name) 加载。搜索/查资料请用内置 web_search 工具，无需加载 Skill。',
      '<available_skills>',
      list,
      '</available_skills>',
    ].join('\n');
  }
  return [
    '\n# Skills（必须遵守）',
    '以下为已发现的 Skill，可通过 skill.load(name) 加载完整说明与工作流。',
    '',
    '<available_skills>',
    list,
    '</available_skills>',
    '',
    '**搜索 SkillHub**：用户问「SkillHub 上有什么」「搜索 xxx 相关技能」「找加密货币/日历/搜索类 Skill」时，先调用 **skill.list_remote**（query: 关键词），获取可安装的 slug 列表，再按需用 **skill.install** 安装。',
    '**搜索 MCP 市场**：用户问「MCP 市场有什么」「搜索 xxx 相关 MCP」「找搜索/文件/日历类 MCP」时，先调用 **mcp.list_remote**（query: 关键词），获取可添加的 MCP 列表，再按需用 **x.add_mcp_server** 添加。',
    '',
    '**安装新 Skill**：已知 slug 时调用 **skill.install**，source 格式：`skillhub:<slug>`（如 `skillhub:serpapi-search`）或 `url:<baseUrl>`。安装后用 **skill.load** 加载；若该 Skill 需要 API Key，工具会返回提示，此时用 **x.notify_user** 告知用户「请到 设置 → Skills 中为 xxx 填写 API Key」。',
    '',
    '**删除 Skill**：用户要求删除某 Skill 时，调用 **skill.uninstall**，传入 name_or_dir（Skill 名称或目录名，如 Summarize、summarize、serpapi-search）。',
    '',
    '**当用户提出搜索、查资料、联网、检索等需求时**：',
    '1. 直接调用 **web_search(query)** 工具（内置，无需加载）。**不要使用 MCP 搜索工具**（如 MiniMax MCP）。',
    '2. 若 web_search 返回「需要 API Key」，用 **x.notify_user** 告知用户到 **设置 → 搜索** 中选择 Provider 并填写 API Key。',
    '3. 若无匹配 Provider 或用户未配置，再考虑用 **capability.search** + **capability.load** 加载 Skill。',
    '',
  ].join('\n');
}

export function getAssembledSystemPrompt(options: AssembleOptions = {}): string {
  const {
    scene = 'none',
    promptMode = 'full',
    basePrompt = '',
    toolLoadingModeOnDemand = false,
    capabilities = '',
    computerContext = '',
    taskSummary = '',
    memory = '',
    learnedPrompt = '',
    memoryIndex = '',
    evolvedCorePrompt = '',
    assistantPrompt = '',
    timeline = '',
  } = options;

  const base = (basePrompt && basePrompt.trim()) ? basePrompt.trim() : CORE_SYSTEM_PROMPT;
  let out = promptMode === 'minimal' ? MINIMAL_CORE_PROMPT : base;

  // AI 自我进化的提示片段：主脑自己追加的规则，紧接在基础身份/使命之后生效
  if (promptMode === 'full' && evolvedCorePrompt && evolvedCorePrompt.trim()) {
    out += '\n\n# 自我约定（由主脑进化生成）\n' + evolvedCorePrompt.trim();
  }

  // AI 助手专用说明：X 主脑根据用户与助手对话优化，使助手更好服务用户
  if (promptMode === 'full' && assistantPrompt && assistantPrompt.trim()) {
    out += '\n\n# AI 助手专用说明（由 X 主脑优化）\n' + assistantPrompt.trim();
  }

  // 时间与系统感知：主脑应像人类一样知道「现在几点、什么环境」
  const currentAwareness = getCurrentAwareness();
  if (currentAwareness || capabilities || computerContext || taskSummary || memory || learnedPrompt || memoryIndex || timeline) {
    const parts: string[] = [];
    if (currentAwareness) parts.push(`# 当前感知\n${currentAwareness}`);
    if (timeline) parts.push(`# 时间线\n${timeline}`);
    if (promptMode === 'full' && learnedPrompt) parts.push(`# 从对话中学习到的规则与偏好\n${learnedPrompt.trim()}`);
    if (memoryIndex) parts.push(`# 长期记忆\n${memoryIndex.trim()}\n\n记忆规则：用户说出值得长期记住的事实、偏好或决定时用 memory_remember 记下（有时效的加 until）；用户更正旧说法时用 memory_supersede；问题涉及某个主题时先 memory_topic_read。`);
    const capsText = toolLoadingModeOnDemand ? CAPABILITIES_ON_DEMAND : capabilities;
    if (capsText) parts.push(`# 当前可用能力\n${capsText}`);
    if (computerContext) parts.push(`# 当前整机状态\n${computerContext}`);
    if (taskSummary) parts.push(`# 任务摘要\n${taskSummary}`);
    if (memory && promptMode === 'full') parts.push(`# 相关记忆\n${memory}`);
    out += '\n\n' + parts.join('\n\n');
  }

  const fragment = SCENE_FRAGMENTS[scene];
  if (fragment) out += '\n\n' + fragment;

  return out.trim();
}
