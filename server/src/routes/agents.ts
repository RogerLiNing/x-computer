import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { AppDatabase } from '../db/database.js';
import type { AgentDefinition, AgentTeam, AgentGroup } from '../../../shared/src/index.js';
import { parseAgentIds } from '../utils/agentIds.js';

export const X_AGENTS_CONFIG_KEY = 'x_agents';
export const X_AGENT_TEAMS_CONFIG_KEY = 'x_agent_teams';

export async function loadAgentsFromDb(db: AppDatabase | undefined, uid: string): Promise<AgentDefinition[]> {
  if (!db) return [];
  const raw = await db.getConfig(uid, X_AGENTS_CONFIG_KEY);
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

export async function saveAgentsToDb(db: AppDatabase | undefined, uid: string, list: AgentDefinition[]): Promise<void> {
  if (!db) return;
  await db.ensureUser(uid);
  await db.setConfig(uid, X_AGENTS_CONFIG_KEY, JSON.stringify(list));
}

export function createAgentsRouter(orchestrator: AgentOrchestrator, db?: AppDatabase): Router {
  const router = Router();

  // ── X 智能体管理（与 x.create_agent / x.list_agents 等工具共用 user_config.x_agents）────

  router.get('/agents', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const list = await loadAgentsFromDb(db, userId);
      res.json({ agents: list });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  router.post('/agents', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const body = req.body as {
        name?: string;
        system_prompt?: string;
        tool_names?: string[];
        role?: string;
        goal_template?: string;
        output_description?: string;
        llm_provider_id?: string;
        llm_model_id?: string;
      };
      const name = String(body?.name ?? '').trim();
      const systemPrompt = String(body?.system_prompt ?? '').trim();
      if (!name || !systemPrompt) {
        return res.status(400).json({ error: 'name 与 system_prompt 必填' });
      }
      const toolNames = Array.isArray(body?.tool_names) ? body.tool_names.map((t) => String(t).trim()).filter(Boolean) : [];
      const role = body?.role != null ? String(body.role).trim() || undefined : undefined;
      const goalTemplate = body?.goal_template != null ? String(body.goal_template).trim() || undefined : undefined;
      const outputDescription = body?.output_description != null ? String(body.output_description).trim() || undefined : undefined;
      const llmProviderId = body?.llm_provider_id != null ? String(body.llm_provider_id).trim() || undefined : undefined;
      const llmModelId = body?.llm_model_id != null ? String(body.llm_model_id).trim() || undefined : undefined;
      const list = await loadAgentsFromDb(db, userId);
      const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = Date.now();
      const agent: AgentDefinition = {
        id,
        name,
        systemPrompt,
        toolNames,
        role,
        goalTemplate,
        outputDescription,
        llmProviderId,
        llmModelId,
        createdAt: now,
        updatedAt: now,
      };
      list.push(agent);
      await saveAgentsToDb(db, userId, list);
      res.status(201).json({ agent, message: `已创建智能体「${name}」` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '创建失败' });
    }
  });

  router.put('/agents/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const body = req.body as {
        name?: string;
        system_prompt?: string;
        tool_names?: string[];
        role?: string;
        goal_template?: string;
        output_description?: string;
        llm_provider_id?: string;
        llm_model_id?: string;
      };
      const list = await loadAgentsFromDb(db, userId);
      const idx = list.findIndex((a) => a.id === id);
      if (idx < 0) return res.status(404).json({ error: '未找到该智能体' });
      const cur = list[idx]!;
      if (body?.name != null) cur.name = String(body.name).trim() || cur.name;
      if (body?.system_prompt != null) cur.systemPrompt = String(body.system_prompt).trim() || cur.systemPrompt;
      if (body?.tool_names !== undefined) {
        cur.toolNames = Array.isArray(body.tool_names) ? body.tool_names.map((t) => String(t).trim()).filter(Boolean) : cur.toolNames;
      }
      if (body?.role != null) cur.role = String(body.role).trim() || undefined;
      if (body?.goal_template != null) cur.goalTemplate = String(body.goal_template).trim() || undefined;
      if (body?.output_description != null) cur.outputDescription = String(body.output_description).trim() || undefined;
      if (body?.llm_provider_id !== undefined) cur.llmProviderId = String(body.llm_provider_id).trim() || undefined;
      if (body?.llm_model_id !== undefined) cur.llmModelId = String(body.llm_model_id).trim() || undefined;
      cur.updatedAt = Date.now();
      await saveAgentsToDb(db, userId, list);
      res.json({ agent: cur, message: '已更新智能体' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '更新失败' });
    }
  });

  router.delete('/agents/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const list = await loadAgentsFromDb(db, userId);
      const next = list.filter((a) => a.id !== id);
      if (next.length === list.length) return res.status(404).json({ error: '未找到该智能体' });
      await saveAgentsToDb(db, userId, next);
      res.json({ message: '已删除智能体' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '删除失败' });
    }
  });

  async function loadTeamsFromDb(uid: string): Promise<AgentTeam[]> {
    if (!db) return [];
    const raw = await db.getConfig(uid, X_AGENT_TEAMS_CONFIG_KEY);
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
  async function saveTeamsToDb(uid: string, list: AgentTeam[]): Promise<void> {
    if (!db) return;
    await db.ensureUser(uid);
    await db.setConfig(uid, X_AGENT_TEAMS_CONFIG_KEY, JSON.stringify(list));
  }

  router.get('/teams', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      res.json({ teams: await loadTeamsFromDb(userId) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  router.post('/teams', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const body = req.body as { name?: string; agent_ids?: string[] };
      const name = String(body?.name ?? '').trim();
      if (!name) return res.status(400).json({ error: 'name 必填' });
      const agentIds = parseAgentIds(body?.agent_ids);
      if (agentIds.length === 0) return res.status(400).json({ error: 'agent_ids 至少包含一个智能体 id' });
      const list = await loadTeamsFromDb(userId);
      const id = `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = Date.now();
      const team: AgentTeam = { id, name, agentIds, createdAt: now, updatedAt: now };
      list.push(team);
      await saveTeamsToDb(userId, list);
      res.status(201).json({ team, message: `已创建团队「${name}」` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '创建失败' });
    }
  });

  router.put('/teams/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const body = req.body as { name?: string; agent_ids?: string[] };
      const list = await loadTeamsFromDb(userId);
      const idx = list.findIndex((t) => t.id === id);
      if (idx < 0) return res.status(404).json({ error: '未找到该团队' });
      const cur = list[idx]!;
      if (body?.name != null) cur.name = String(body.name).trim() || cur.name;
      if (body?.agent_ids !== undefined) {
        cur.agentIds = parseAgentIds(body.agent_ids).length > 0 ? parseAgentIds(body.agent_ids) : cur.agentIds;
      }
      cur.updatedAt = Date.now();
      await saveTeamsToDb(userId, list);
      res.json({ team: cur, message: '已更新团队' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '更新失败' });
    }
  });

  router.delete('/teams/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const list = await loadTeamsFromDb(userId);
      const next = list.filter((t) => t.id !== id);
      if (next.length === list.length) return res.status(404).json({ error: '未找到该团队' });
      await saveTeamsToDb(userId, next);
      res.json({ message: '已删除团队' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '删除失败' });
    }
  });

  const X_AGENT_GROUPS_CONFIG_KEY = 'x_agent_groups';
  async function loadGroupsFromDb(uid: string): Promise<AgentGroup[]> {
    if (!db) return [];
    const raw = await db.getConfig(uid, X_AGENT_GROUPS_CONFIG_KEY);
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
  async function saveGroupsToDb(uid: string, list: AgentGroup[]): Promise<void> {
    if (!db) return;
    await db.ensureUser(uid);
    await db.setConfig(uid, X_AGENT_GROUPS_CONFIG_KEY, JSON.stringify(list));
  }

  router.get('/groups', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      res.json({ groups: await loadGroupsFromDb(userId) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  router.post('/groups', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const body = req.body as { name?: string; agent_ids?: string[] };
      const name = String(body?.name ?? '').trim();
      if (!name) return res.status(400).json({ error: 'name 必填' });
      const agentIds = parseAgentIds(body?.agent_ids);
      const list = await loadGroupsFromDb(userId);
      const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = Date.now();
      const group: AgentGroup = { id, name, agentIds, createdAt: now, updatedAt: now };
      list.push(group);
      await saveGroupsToDb(userId, list);
      res.status(201).json({ group, message: `已创建群组「${name}」` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '创建失败' });
    }
  });

  router.put('/groups/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const body = req.body as { name?: string; agent_ids?: string[] };
      const list = await loadGroupsFromDb(userId);
      const idx = list.findIndex((g) => g.id === id);
      if (idx < 0) return res.status(404).json({ error: '未找到该群组' });
      const cur = list[idx]!;
      if (body?.name != null) cur.name = String(body.name).trim() || cur.name;
      if (body?.agent_ids !== undefined) {
        cur.agentIds = parseAgentIds(body.agent_ids).length > 0 ? parseAgentIds(body.agent_ids) : cur.agentIds;
      }
      cur.updatedAt = Date.now();
      await saveGroupsToDb(userId, list);
      res.json({ group: cur, message: '已更新群组' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '更新失败' });
    }
  });

  router.delete('/groups/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const list = await loadGroupsFromDb(userId);
      const next = list.filter((g) => g.id !== id);
      if (next.length === list.length) return res.status(404).json({ error: '未找到该群组' });
      await saveGroupsToDb(userId, next);
      res.json({ message: '已删除群组' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '删除失败' });
    }
  });

  return router;
}
