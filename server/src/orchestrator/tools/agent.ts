/**
 * Agent（智能体）管理工具：CRUD、团队（流水线）、群组（并行）。
 *
 * 从 ToolExecutor.ts 提取（lines 2864–3468 + helpers 434–537），
 * 减少主文件体积。
 */

import type { ToolDefinition } from '@x-computer/shared';
import type { AgentDefinition, AgentTeam, AgentGroup } from '@x-computer/shared';
import { parseAgentIds } from '../../utils/agentIds.js';

// ── Config keys ────────────────────────────────────────────────────────────────

const X_AGENTS_CONFIG_KEY = 'x_agents';
const X_AGENT_TEAMS_CONFIG_KEY = 'x_agent_teams';
const X_AGENT_GROUPS_CONFIG_KEY = 'x_agent_groups';
const X_GROUP_RUN_HISTORY_KEY = 'x_group_run_history';
const MAX_GROUP_RUN_HISTORY = 50;

// ── Shared types ───────────────────────────────────────────────────────────────

export interface GroupRunRecord {
  id: string;
  groupId: string;
  groupName: string;
  goal: string;
  results: Array<{ agentId: string; agentName: string; content: string }>;
  cancelled?: boolean;
  createdAt: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function resolveGetConfig(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
  key: string,
): Promise<string | undefined> {
  const raw = getConfig(userId, key);
  return raw instanceof Promise ? await raw : raw;
}

async function getConfigValue(
  getConfig: ((userId: string, key: string) => string | undefined | Promise<string | undefined>) | undefined,
  userId: string,
  key: string,
): Promise<string | undefined> {
  if (!getConfig) return undefined;
  const r = getConfig(userId, key);
  const resolved = r instanceof Promise ? await r : r;
  return resolved ?? undefined;
}

async function loadAgents(getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>, userId: string): Promise<AgentDefinition[]> {
  const raw = await resolveGetConfig(getConfig, userId, X_AGENTS_CONFIG_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown[];
    return Array.isArray(arr)
      ? arr.filter((x): x is AgentDefinition => {
          if (!x || typeof x !== 'object') return false;
          const a = x as Record<string, unknown>;
          return typeof a.id === 'string' && typeof a.name === 'string';
        })
      : [];
  } catch {
    return [];
  }
}

function saveAgents(setConfig: (userId: string, key: string, value: string) => void, userId: string, list: AgentDefinition[]): void {
  setConfig(userId, X_AGENTS_CONFIG_KEY, JSON.stringify(list));
}

async function loadTeams(getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>, userId: string): Promise<AgentTeam[]> {
  const raw = await resolveGetConfig(getConfig, userId, X_AGENT_TEAMS_CONFIG_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown[];
    return Array.isArray(arr)
      ? arr.filter((x): x is AgentTeam => {
          if (!x || typeof x !== 'object') return false;
          const t = x as Record<string, unknown>;
          return typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.agentIds);
        })
      : [];
  } catch {
    return [];
  }
}

function saveTeams(setConfig: (userId: string, key: string, value: string) => void, userId: string, list: AgentTeam[]): void {
  setConfig(userId, X_AGENT_TEAMS_CONFIG_KEY, JSON.stringify(list));
}

async function loadGroups(getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>, userId: string): Promise<AgentGroup[]> {
  const raw = await resolveGetConfig(getConfig, userId, X_AGENT_GROUPS_CONFIG_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown[];
    return Array.isArray(arr)
      ? arr.filter((x): x is AgentGroup => {
          if (!x || typeof x !== 'object') return false;
          const g = x as Record<string, unknown>;
          return typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.agentIds);
        })
      : [];
  } catch {
    return [];
  }
}

function saveGroups(setConfig: (userId: string, key: string, value: string) => void, userId: string, list: AgentGroup[]): void {
  setConfig(userId, X_AGENT_GROUPS_CONFIG_KEY, JSON.stringify(list));
}

async function appendGroupRunHistory(
  getConfig: ((userId: string, key: string) => string | undefined | Promise<string | undefined>) | undefined,
  setConfig: ((userId: string, key: string, value: string) => void | Promise<void>) | undefined,
  userId: string,
  record: Omit<GroupRunRecord, 'id' | 'createdAt'>,
): Promise<void> {
  if (!getConfig || !setConfig) return;
  const raw = await getConfigValue(getConfig, userId, X_GROUP_RUN_HISTORY_KEY);
  let list: GroupRunRecord[];
  try {
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    list = Array.isArray(arr)
      ? arr.filter((x): x is GroupRunRecord => Boolean(x && typeof x === 'object' && typeof (x as GroupRunRecord).createdAt === 'number'))
      : [];
  } catch {
    list = [];
  }
  const full: GroupRunRecord = {
    ...record,
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  list.unshift(full);
  list = list.slice(0, MAX_GROUP_RUN_HISTORY);
  const setResult = setConfig(userId, X_GROUP_RUN_HISTORY_KEY, JSON.stringify(list));
  if (setResult instanceof Promise) await setResult;
}

// ── Tool Definitions ────────────────────────────────────────────────────────

export const createAgentDef: ToolDefinition = {
  name: 'x.create_agent',
  displayName: '创建智能体',
  description: '创建一个由 X 管理的智能体。你是管理者，智能体是执行者。可指定：name（名称）、system_prompt（该智能体的系统提示词：角色、能力、约束）、tool_names（该智能体可用的工具名列表，如 file.read,file.write,shell.run；空数组表示使用全部工具）、可选 role（角色标签，如写手、审核、数据分析师，便于组队）、goal_template、output_description。可选 llm_provider_id、llm_model_id 指定该智能体执行时使用的大模型（由 llm.* 工具管理）；未指定则使用用户默认模型。创建后可用 x.run_agent 派发任务或加入团队。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'name', type: 'string', description: '智能体名称', required: true },
    { name: 'system_prompt', type: 'string', description: '该智能体的系统提示词（角色、能力、约束）', required: true },
    { name: 'tool_names', type: 'array', description: '该智能体可调用的工具名列表，如 ["file.read","file.write"]；空则用全部', required: false },
    { name: 'role', type: 'string', description: '角色标签（如写手、审核、数据分析师），便于组队与派活', required: false },
    { name: 'goal_template', type: 'string', description: '目标描述模板或说明（派发时可作为 goal 填入）', required: false },
    { name: 'output_description', type: 'string', description: '期望输出内容说明', required: false },
    { name: 'llm_provider_id', type: 'string', description: '可选：该智能体使用的大模型提供商 ID（llm.list_providers 返回的 id）', required: false },
    { name: 'llm_model_id', type: 'string', description: '可选：该智能体使用的大模型 ID（llm.list_models 返回的 id）', required: false },
  ],
  requiredPermissions: [],
};

export const listAgentsDef: ToolDefinition = {
  name: 'x.list_agents',
  displayName: '列出智能体',
  description: '列出当前用户下由 X 创建的所有智能体（id、name、toolNames、goal_template、output_description）。派发任务前可先查看可用智能体。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: [],
};

export const runAgentDef: ToolDefinition = {
  name: 'x.run_agent',
  displayName: '运行智能体',
  description: '派发任务给已创建的智能体执行。你是管理者，智能体是执行者。传入 agent_id（x.list_agents 返回的 id）、goal（本次要完成的目标或用户消息）。智能体会用自己的提示词和工具完成任务并返回结果。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'agent_id', type: 'string', description: '智能体 ID（从 x.list_agents 获取）', required: true },
    { name: 'goal', type: 'string', description: '本次要完成的目标或交给智能体的用户消息', required: true },
  ],
  requiredPermissions: [],
};

export const updateAgentDef: ToolDefinition = {
  name: 'x.update_agent',
  displayName: '更新智能体',
  description: '更新已创建的智能体。传入 agent_id 及要修改的字段（name、system_prompt、tool_names、role、goal_template、output_description、llm_provider_id、llm_model_id），未传的字段保持不变。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'agent_id', type: 'string', description: '智能体 ID', required: true },
    { name: 'name', type: 'string', description: '新名称', required: false },
    { name: 'system_prompt', type: 'string', description: '新系统提示词', required: false },
    { name: 'tool_names', type: 'array', description: '新工具名列表', required: false },
    { name: 'role', type: 'string', description: '角色标签（如写手、审核、数据分析师）', required: false },
    { name: 'goal_template', type: 'string', description: '新目标模板', required: false },
    { name: 'output_description', type: 'string', description: '新输出说明', required: false },
    { name: 'llm_provider_id', type: 'string', description: '可选：该智能体使用的大模型提供商 ID', required: false },
    { name: 'llm_model_id', type: 'string', description: '可选：该智能体使用的大模型 ID', required: false },
  ],
  requiredPermissions: [],
};

export const removeAgentDef: ToolDefinition = {
  name: 'x.remove_agent',
  displayName: '删除智能体',
  description: '删除一个已创建的智能体。传入 agent_id（从 x.list_agents 获取）。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [{ name: 'agent_id', type: 'string', description: '要删除的智能体 ID', required: true }],
  requiredPermissions: [],
};

export const createTeamDef: ToolDefinition = {
  name: 'x.create_team',
  displayName: '创建团队',
  description: '创建一个智能体团队。团队由多个智能体按顺序组成流水线（如收集→撰写→审核）。传入 name（团队名称）、agent_ids（智能体 id 数组，顺序即执行顺序，从 x.list_agents 获取）。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'name', type: 'string', description: '团队名称', required: true },
    { name: 'agent_ids', type: 'array', description: '智能体 id 数组，顺序即执行顺序', required: true },
  ],
  requiredPermissions: [],
};

export const listTeamsDef: ToolDefinition = {
  name: 'x.list_teams',
  displayName: '列出团队',
  description: '列出当前用户下所有智能体团队（id、name、agentIds）。用于 run_team 前查看或组队规划。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: [],
};

export const runTeamDef: ToolDefinition = {
  name: 'x.run_team',
  displayName: '运行团队',
  description: '按团队顺序依次执行智能体（流水线）。传入 team_id（从 x.list_teams 获取）、goal（本次团队要完成的目标）。第一个智能体以 goal 执行；后续每个智能体会收到「上一环节输出」加本次 goal 作为目标，适合收集→撰写→审核等办公流程。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'team_id', type: 'string', description: '团队 ID（从 x.list_teams 获取）', required: true },
    { name: 'goal', type: 'string', description: '本次团队要完成的目标', required: true },
  ],
  requiredPermissions: [],
};

export const updateTeamDef: ToolDefinition = {
  name: 'x.update_team',
  displayName: '更新团队',
  description: '更新团队。传入 team_id 及要修改的 name 或 agent_ids，未传的保持不变。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'team_id', type: 'string', description: '团队 ID', required: true },
    { name: 'name', type: 'string', description: '新名称', required: false },
    { name: 'agent_ids', type: 'array', description: '新的智能体 id 顺序', required: false },
  ],
  requiredPermissions: [],
};

export const removeTeamDef: ToolDefinition = {
  name: 'x.remove_team',
  displayName: '删除团队',
  description: '删除一个智能体团队。传入 team_id（从 x.list_teams 获取）。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [{ name: 'team_id', type: 'string', description: '要删除的团队 ID', required: true }],
  requiredPermissions: [],
};

export const createGroupDef: ToolDefinition = {
  name: 'x.create_group',
  displayName: '创建群组',
  description: '创建一个智能体群组（类似群聊）。可指定 name；可选 agent_ids 直接加入成员，也可先建空群再用 x.add_agents_to_group 加人。用于把多个智能体放进一个群，再通过 x.run_group 派发任务并收集各人结果。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'name', type: 'string', description: '群组名称', required: true },
    { name: 'agent_ids', type: 'array', description: '可选，初始成员智能体 id 列表', required: false },
  ],
  requiredPermissions: [],
};

export const listGroupsDef: ToolDefinition = {
  name: 'x.list_groups',
  displayName: '列出群组',
  description: '列出当前用户下所有智能体群组（id、name、agentIds）。用于 run_group 或管理成员前查看。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: [],
};

export const addAgentsToGroupDef: ToolDefinition = {
  name: 'x.add_agents_to_group',
  displayName: '添加成员到群组',
  description: '把已有智能体加入群组。传入 group_id（从 x.list_groups 获取）、agent_ids（要加入的智能体 id 列表）。可多次调用以陆续加人。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'group_id', type: 'string', description: '群组 ID', required: true },
    { name: 'agent_ids', type: 'array', description: '要加入的智能体 id 列表', required: true },
  ],
  requiredPermissions: [],
};

export const removeAgentsFromGroupDef: ToolDefinition = {
  name: 'x.remove_agents_from_group',
  displayName: '从群组移除成员',
  description: '从群组中移除部分智能体。传入 group_id、agent_ids（要移除的智能体 id 列表）。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'group_id', type: 'string', description: '群组 ID', required: true },
    { name: 'agent_ids', type: 'array', description: '要移除的智能体 id 列表', required: true },
  ],
  requiredPermissions: [],
};

export const runGroupDef: ToolDefinition = {
  name: 'x.run_group',
  displayName: '运行群组',
  description: '向群组派发任务并收集结果。传入 group_id、goal（本次要大家完成的目标或话题）。群内每个智能体会用同一 goal 执行一轮，你作为主脑会收到所有人的输出列表（results），可据此汇总或再引导。适合头脑风暴、多角色分别贡献、分工收集后由你汇总。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'group_id', type: 'string', description: '群组 ID（从 x.list_groups 获取）', required: true },
    { name: 'goal', type: 'string', description: '本次派发给群组的目标或话题', required: true },
  ],
  requiredPermissions: [],
};

export const updateGroupDef: ToolDefinition = {
  name: 'x.update_group',
  displayName: '更新群组',
  description: '更新群组。传入 group_id 及要修改的 name，未传的保持不变。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'group_id', type: 'string', description: '群组 ID', required: true },
    { name: 'name', type: 'string', description: '新名称', required: false },
  ],
  requiredPermissions: [],
};

export const removeGroupDef: ToolDefinition = {
  name: 'x.remove_group',
  displayName: '删除群组',
  description: '删除一个智能体群组。传入 group_id（从 x.list_groups 获取）。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [{ name: 'group_id', type: 'string', description: '要删除的群组 ID', required: true }],
  requiredPermissions: [],
};

// ── Factory ─────────────────────────────────────────────────────────────────

export function createAgentHandlers(ctx: {
  resolveRunCustomAgentLoop: () => ((params: { agentDef: AgentDefinition; goal: string; userId: string }) => Promise<{ content: string }>) | undefined;
}) {
  const { resolveRunCustomAgentLoop } = ctx;

  // ── Agent CRUD ────────────────────────────────────────────────────────────

  const createAgentHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写智能体配置' };
    const name = String(input.name ?? '').trim();
    const systemPrompt = String(input.system_prompt ?? '').trim();
    if (!name || !systemPrompt) return { ok: false, error: 'name 与 system_prompt 必填' };
    const rawTools = input.tool_names;
    const toolNames = Array.isArray(rawTools) ? rawTools.map((t: any) => String(t).trim()).filter(Boolean) : [];
    const role = input.role != null ? String(input.role).trim() : undefined;
    const goalTemplate = input.goal_template != null ? String(input.goal_template).trim() : undefined;
    const outputDescription = input.output_description != null ? String(input.output_description).trim() : undefined;
    const llmProviderId = input.llm_provider_id != null ? String(input.llm_provider_id).trim() || undefined : undefined;
    const llmModelId = input.llm_model_id != null ? String(input.llm_model_id).trim() || undefined : undefined;
    const list = await loadAgents(getConfig, userId);
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const agent: AgentDefinition = {
      id, name, systemPrompt, toolNames,
      role: role || undefined,
      goalTemplate: goalTemplate || undefined,
      outputDescription: outputDescription || undefined,
      llmProviderId: llmProviderId || undefined,
      llmModelId: llmModelId || undefined,
      createdAt: now, updatedAt: now,
    };
    list.push(agent);
    saveAgents(setConfig, userId, list);
    return { ok: true, agentId: id, message: `已创建智能体「${name}」` };
  };

  const listAgentsHandler = async (_input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { agents: [], message: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    if (!getConfig) return { agents: [], message: '无法读取配置' };
    const list = await loadAgents(getConfig, userId);
    return { agents: list };
  };

  const runAgentHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', content: '' };
    const getConfig = ctx?.getConfig;
    if (!getConfig) return { ok: false, error: '无法读取配置', content: '' };
    const agentId = String(input.agent_id ?? '').trim();
    const goal = String(input.goal ?? '').trim();
    if (!agentId || !goal) return { ok: false, error: 'agent_id 与 goal 必填', content: '' };
    const list = await loadAgents(getConfig, userId);
    const agent = list.find((a) => a.id === agentId);
    if (!agent) return { ok: false, error: '未找到该智能体', content: '' };
    const runCustomAgentLoop = resolveRunCustomAgentLoop();
    if (!runCustomAgentLoop) return { ok: false, error: '服务未配置智能体执行', content: '' };
    try {
      const { content } = await runCustomAgentLoop({ agentDef: agent, goal, userId });
      return { ok: true, content };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg, content: '' };
    }
  };

  const updateAgentHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
    const agentId = String(input.agent_id ?? '').trim();
    if (!agentId) return { ok: false, error: 'agent_id 必填' };
    const list = await loadAgents(getConfig, userId);
    const idx = list.findIndex((a) => a.id === agentId);
    if (idx < 0) return { ok: false, error: '未找到该智能体' };
    const now = Date.now();
    const cur = list[idx]!;
    if (input.name != null) cur.name = String(input.name).trim() || cur.name;
    if (input.system_prompt != null) cur.systemPrompt = String(input.system_prompt).trim() || cur.systemPrompt;
    if (input.tool_names !== undefined)
      cur.toolNames = Array.isArray(input.tool_names) ? input.tool_names.map((t: any) => String(t).trim()).filter(Boolean) : cur.toolNames;
    if (input.role != null) cur.role = String(input.role).trim() || undefined;
    if (input.goal_template != null) cur.goalTemplate = String(input.goal_template).trim() || undefined;
    if (input.output_description != null) cur.outputDescription = String(input.output_description).trim() || undefined;
    if (input.llm_provider_id !== undefined) cur.llmProviderId = String(input.llm_provider_id).trim() || undefined;
    if (input.llm_model_id !== undefined) cur.llmModelId = String(input.llm_model_id).trim() || undefined;
    cur.updatedAt = now;
    saveAgents(setConfig, userId, list);
    return { ok: true, message: '已更新智能体' };
  };

  const removeAgentHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
    const agentId = String(input.agent_id ?? '').trim();
    if (!agentId) return { ok: false, error: 'agent_id 必填' };
    const original = await loadAgents(getConfig, userId);
    const list = original.filter((a) => a.id !== agentId);
    if (list.length === original.length) return { ok: false, error: '未找到该智能体' };
    saveAgents(setConfig, userId, list);
    return { ok: true, message: '已删除智能体' };
  };

  // ── Team ─────────────────────────────────────────────────────────────────

  const createTeamHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
    const name = String(input.name ?? '').trim();
    if (!name) return { ok: false, error: 'name 必填' };
    const agentIds = parseAgentIds(input.agent_ids);
    if (agentIds.length === 0) return { ok: false, error: 'agent_ids 至少包含一个智能体 id' };
    const teams = await loadTeams(getConfig, userId);
    const id = `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const team: AgentTeam = { id, name, agentIds, createdAt: now, updatedAt: now };
    teams.push(team);
    saveTeams(setConfig, userId, teams);
    return { ok: true, teamId: id, message: `已创建团队「${name}」` };
  };

  const listTeamsHandler = async (_input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { teams: [], message: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    if (!getConfig) return { teams: [], message: '无法读取配置' };
    const teams = await loadTeams(getConfig, userId);
    return { teams };
  };

  const runTeamHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', content: '' };
    const getConfig = ctx?.getConfig;
    if (!getConfig) return { ok: false, error: '无法读取配置', content: '' };
    const teamId = String(input.team_id ?? '').trim();
    const goal = String(input.goal ?? '').trim();
    if (!teamId || !goal) return { ok: false, error: 'team_id 与 goal 必填', content: '' };
    const teams = await loadTeams(getConfig, userId);
    const team = teams.find((t) => t.id === teamId);
    if (!team) return { ok: false, error: '未找到该团队', content: '' };
    const agents = await loadAgents(getConfig, userId);
    const runCustomAgentLoop = resolveRunCustomAgentLoop();
    if (!runCustomAgentLoop) return { ok: false, error: '服务未配置智能体执行', content: '' };
    let prevOutput = '';
    const steps: string[] = [];
    for (let i = 0; i < team.agentIds.length; i++) {
      const agentId = team.agentIds[i]!;
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return { ok: false, error: `团队中的智能体 ${agentId} 不存在`, content: prevOutput || '' };
      const stepGoal = i === 0 ? goal : `上一环节输出：\n${prevOutput}\n\n本次目标：${goal}`;
      try {
        const { content } = await runCustomAgentLoop({ agentDef: agent, goal: stepGoal, userId });
        prevOutput = content;
        steps.push(`[${agent.name}] ${content.slice(0, 200)}${content.length > 200 ? '…' : ''}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `团队执行到「${agent.name}」时失败：${msg}`, content: prevOutput || '' };
      }
    }
    return { ok: true, content: prevOutput, steps };
  };

  const updateTeamHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
    const teamId = String(input.team_id ?? '').trim();
    if (!teamId) return { ok: false, error: 'team_id 必填' };
    const teams = await loadTeams(getConfig, userId);
    const idx = teams.findIndex((t) => t.id === teamId);
    if (idx < 0) return { ok: false, error: '未找到该团队' };
    const cur = teams[idx]!;
    if (input.name != null) cur.name = String(input.name).trim() || cur.name;
    if (input.agent_ids !== undefined) {
      const next = parseAgentIds(input.agent_ids);
      cur.agentIds = next.length > 0 ? next : cur.agentIds;
    }
    cur.updatedAt = Date.now();
    saveTeams(setConfig, userId, teams);
    return { ok: true, message: '已更新团队' };
  };

  const removeTeamHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
    const teamId = String(input.team_id ?? '').trim();
    if (!teamId) return { ok: false, error: 'team_id 必填' };
    const list = await loadTeams(getConfig, userId);
    const next = list.filter((t) => t.id !== teamId);
    if (next.length === list.length) return { ok: false, error: '未找到该团队' };
    saveTeams(setConfig, userId, next);
    return { ok: true, message: '已删除团队' };
  };

  // ── Group ────────────────────────────────────────────────────────────────

  const createGroupHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
    const name = String(input.name ?? '').trim();
    if (!name) return { ok: false, error: 'name 必填' };
    const agentIds = parseAgentIds(input.agent_ids);
    const groups = await loadGroups(getConfig, userId);
    const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const group: AgentGroup = { id, name, agentIds, createdAt: now, updatedAt: now };
    groups.push(group);
    saveGroups(setConfig, userId, groups);
    return { ok: true, groupId: id, message: `已创建群组「${name}」` };
  };

  const listGroupsHandler = async (_input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { groups: [], message: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    if (!getConfig) return { groups: [], message: '无法读取配置' };
    const groups = await loadGroups(getConfig, userId);
    return { groups };
  };

  const addAgentsToGroupHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
    const groupId = String(input.group_id ?? '').trim();
    if (!groupId) return { ok: false, error: 'group_id 必填' };
    const toAdd = parseAgentIds(input.agent_ids);
    if (toAdd.length === 0) return { ok: false, error: 'agent_ids 至少包含一个 id' };
    const groups = await loadGroups(getConfig, userId);
    const g = groups.find((x) => x.id === groupId);
    if (!g) return { ok: false, error: '未找到该群组' };
    const existing = new Set(g.agentIds);
    for (const id of toAdd) { if (!existing.has(id)) { g.agentIds.push(id); existing.add(id); } }
    g.updatedAt = Date.now();
    saveGroups(setConfig, userId, groups);
    return { ok: true, message: `已向群组加入 ${toAdd.length} 个智能体` };
  };

  const removeAgentsFromGroupHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
    const groupId = String(input.group_id ?? '').trim();
    if (!groupId) return { ok: false, error: 'group_id 必填' };
    const toRemove = parseAgentIds(input.agent_ids);
    const groups = await loadGroups(getConfig, userId);
    const g = groups.find((x) => x.id === groupId);
    if (!g) return { ok: false, error: '未找到该群组' };
    const set = new Set(toRemove);
    g.agentIds = g.agentIds.filter((id: string) => !set.has(id));
    g.updatedAt = Date.now();
    saveGroups(setConfig, userId, groups);
    return { ok: true, message: '已从群组移除指定智能体' };
  };

  const runGroupHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', results: [] };
    const getConfig = ctx?.getConfig;
    if (!getConfig) return { ok: false, error: '无法读取配置', results: [] };
    const groupId = String(input.group_id ?? '').trim();
    const goal = String(input.goal ?? '').trim();
    if (!groupId || !goal) return { ok: false, error: 'group_id 与 goal 必填', results: [] };
    const groups = await loadGroups(getConfig, userId);
    const group = groups.find((g) => g.id === groupId);
    if (!group) return { ok: false, error: '未找到该群组', results: [] };
    if (group.agentIds.length === 0) return { ok: false, error: '群组内暂无成员，请先用 x.add_agents_to_group 加人', results: [] };
    const agents = await loadAgents(getConfig, userId);
    const runCustomAgentLoop = resolveRunCustomAgentLoop();
    if (!runCustomAgentLoop) return { ok: false, error: '服务未配置智能体执行', results: [] };
    if (ctx?.clearGroupRunCancel && userId) ctx.clearGroupRunCancel(userId);
    const results: Array<{ agentId: string; agentName: string; content: string }> = [];
    const total = group.agentIds.length;
    for (let i = 0; i < total; i++) {
      if (ctx?.isGroupRunCancelRequested?.(userId)) {
        if (ctx?.onGroupRunProgress && userId) ctx.onGroupRunProgress(userId, { groupId, goal, results, totalAgents: total, done: true, cancelled: true });
        if (ctx?.setConfig && ctx?.getConfig) void appendGroupRunHistory(ctx.getConfig, ctx.setConfig, userId, { groupId, groupName: group.name, goal, results, cancelled: true });
        return { ok: true, cancelled: true, results };
      }
      const agentId = group.agentIds[i]!;
      const agent = agents.find((a) => a.id === agentId);
      const nextAgent = i + 1 < total ? agents.find((a) => a.id === group.agentIds[i + 1]) : undefined;
      if (!agent) {
        results.push({ agentId, agentName: '(未知)', content: `[未找到智能体 ${agentId}]` });
        if (ctx?.onGroupRunProgress && userId) ctx.onGroupRunProgress(userId, { groupId, goal, results, totalAgents: total, currentAgentName: nextAgent?.name, done: false });
        continue;
      }
      try {
        const { content } = await runCustomAgentLoop({ agentDef: agent, goal, userId });
        results.push({ agentId: agent.id, agentName: agent.name, content });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ agentId: agent.id, agentName: agent.name, content: `[执行失败: ${msg}]` });
      }
      if (ctx?.onGroupRunProgress && userId) ctx.onGroupRunProgress(userId, { groupId, goal, results, totalAgents: total, currentAgentName: nextAgent?.name, done: i === total - 1 });
    }
    if (ctx?.onGroupRunProgress && userId) ctx.onGroupRunProgress(userId, { groupId, goal, results, totalAgents: total, done: true });
    if (ctx?.setConfig && ctx?.getConfig) void appendGroupRunHistory(ctx.getConfig, ctx.setConfig, userId, { groupId, groupName: group.name, goal, results });
    return { ok: true, results };
  };

  const updateGroupHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
    const groupId = String(input.group_id ?? '').trim();
    if (!groupId) return { ok: false, error: 'group_id 必填' };
    const groups = await loadGroups(getConfig, userId);
    const idx = groups.findIndex((g) => g.id === groupId);
    if (idx < 0) return { ok: false, error: '未找到该群组' };
    const cur = groups[idx]!;
    if (input.name != null) cur.name = String(input.name).trim() || cur.name;
    cur.updatedAt = Date.now();
    saveGroups(setConfig, userId, groups);
    return { ok: true, message: '已更新群组' };
  };

  const removeGroupHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
    const groupId = String(input.group_id ?? '').trim();
    if (!groupId) return { ok: false, error: 'group_id 必填' };
    const list = await loadGroups(getConfig, userId);
    const next = list.filter((g) => g.id !== groupId);
    if (next.length === list.length) return { ok: false, error: '未找到该群组' };
    saveGroups(setConfig, userId, next);
    return { ok: true, message: '已删除群组' };
  };

  return {
    createAgentHandler,
    listAgentsHandler,
    runAgentHandler,
    updateAgentHandler,
    removeAgentHandler,
    createTeamHandler,
    listTeamsHandler,
    runTeamHandler,
    updateTeamHandler,
    removeTeamHandler,
    createGroupHandler,
    listGroupsHandler,
    addAgentsToGroupHandler,
    removeAgentsFromGroupHandler,
    runGroupHandler,
    updateGroupHandler,
    removeGroupHandler,
  };
}
