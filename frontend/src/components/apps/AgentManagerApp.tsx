/**
 * 智能体管理：查看、新建、编辑、删除由 X 创建的智能体、团队与群组。
 * 与 x.create_agent / x.list_agents、x.create_team / x.list_teams、x.create_group / x.list_groups 共用同一存储。
 */

import { useState, useEffect, useCallback } from 'react';
import { Bot, Plus, Pencil, Trash2, ChevronDown, ChevronRight, Users, MessageCircle } from 'lucide-react';
import { api } from '@/utils/api';
import { DISPLAY_TIMEZONE } from '@/constants/datetime';

interface AgentItem {
  id: string;
  name: string;
  role?: string;
  systemPrompt: string;
  toolNames: string[];
  goalTemplate?: string;
  outputDescription?: string;
  createdAt: number;
  updatedAt: number;
}

interface TeamItem {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

interface GroupItem {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

interface GroupRunRecord {
  id: string;
  groupId: string;
  groupName: string;
  goal: string;
  results: Array<{ agentId: string; agentName: string; content: string }>;
  cancelled?: boolean;
  createdAt: number;
}

type TabId = 'agents' | 'teams' | 'groups';

interface Props {
  windowId: string;
}

export function AgentManagerApp({ windowId }: Props) {
  const [tab, setTab] = useState<TabId>('agents');
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTeamsGroups, setLoadingTeamsGroups] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    system_prompt: '',
    tool_names: '',
    role: '',
    goal_template: '',
    output_description: '',
  });
  const [teamForm, setTeamForm] = useState({ name: '', agent_ids: '' });
  const [groupForm, setGroupForm] = useState({ name: '', agent_ids: '' });
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [deleteConfirmTeamId, setDeleteConfirmTeamId] = useState<string | null>(null);
  const [deleteConfirmGroupId, setDeleteConfirmGroupId] = useState<string | null>(null);
  const [groupRunHistory, setGroupRunHistory] = useState<GroupRunRecord[]>([]);
  const [loadingRunHistory, setLoadingRunHistory] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listAgents();
      setAgents(res?.agents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTeams = useCallback(async () => {
    setLoadingTeamsGroups(true);
    try {
      const res = await api.listTeams();
      setTeams(res?.teams ?? []);
    } catch {
      setTeams([]);
    } finally {
      setLoadingTeamsGroups(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setLoadingTeamsGroups(true);
    try {
      const res = await api.listGroups();
      setGroups(res?.groups ?? []);
    } catch {
      setGroups([]);
    } finally {
      setLoadingTeamsGroups(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (tab === 'teams') loadTeams();
  }, [tab, loadTeams]);

  useEffect(() => {
    if (tab === 'groups') loadGroups();
  }, [tab, loadGroups]);

  const loadGroupRunHistory = useCallback(async () => {
    setLoadingRunHistory(true);
    try {
      const res = await api.getGroupRunHistory({ limit: 30 });
      setGroupRunHistory(res?.runs ?? []);
    } catch {
      setGroupRunHistory([]);
    } finally {
      setLoadingRunHistory(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'groups') loadGroupRunHistory();
  }, [tab, loadGroupRunHistory]);

  const agentNameMap = Object.fromEntries(agents.map((a) => [a.id, a.name]));
  const resolveAgentIds = (ids: string[]) => ids.map((id) => agentNameMap[id] ?? id).join('、') || '—';

  const resetForm = useCallback(() => {
    setForm({
      name: '',
      system_prompt: '',
      tool_names: '',
      role: '',
      goal_template: '',
      output_description: '',
    });
    setEditingId(null);
    setShowForm(false);
  }, []);

  const fillForm = useCallback((a: AgentItem) => {
    setForm({
      name: a.name,
      system_prompt: a.systemPrompt,
      tool_names: (a.toolNames ?? []).join(', '),
      role: a.role ?? '',
      goal_template: a.goalTemplate ?? '',
      output_description: a.outputDescription ?? '',
    });
    setEditingId(a.id);
    setShowForm(true);
  }, []);

  const handleCreate = async () => {
    const name = form.name.trim();
    const system_prompt = form.system_prompt.trim();
    if (!name || !system_prompt) {
      setError('名称与系统提示词必填');
      return;
    }
    setSaveLoading(true);
    setError(null);
    try {
      await api.createAgent({
        name,
        system_prompt,
        tool_names: form.tool_names.trim() ? form.tool_names.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        role: form.role.trim() || undefined,
        goal_template: form.goal_template.trim() || undefined,
        output_description: form.output_description.trim() || undefined,
      });
      resetForm();
      await loadAgents();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    const name = form.name.trim();
    const system_prompt = form.system_prompt.trim();
    if (!name || !system_prompt) {
      setError('名称与系统提示词必填');
      return;
    }
    setSaveLoading(true);
    setError(null);
    try {
      await api.updateAgent(editingId, {
        name,
        system_prompt,
        tool_names: form.tool_names.trim() ? form.tool_names.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        role: form.role.trim() || undefined,
        goal_template: form.goal_template.trim() || undefined,
        output_description: form.output_description.trim() || undefined,
      });
      resetForm();
      await loadAgents();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaveLoading(true);
    setError(null);
    try {
      await api.removeAgent(id);
      setDeleteConfirmId(null);
      await loadAgents();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const parseAgentIds = (s: string) => s.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);

  const handleCreateTeam = async () => {
    const name = teamForm.name.trim();
    if (!name) {
      setError('团队名称必填');
      return;
    }
    const agentIds = parseAgentIds(teamForm.agent_ids);
    if (agentIds.length === 0) {
      setError('团队至少包含一个智能体（填写智能体 id，逗号分隔）');
      return;
    }
    setSaveLoading(true);
    setError(null);
    try {
      await api.createTeam({ name, agent_ids: agentIds });
      setTeamForm({ name: '', agent_ids: '' });
      setShowTeamForm(false);
      await loadTeams();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleUpdateTeam = async () => {
    if (!editingTeamId) return;
    const name = teamForm.name.trim();
    if (!name) {
      setError('团队名称必填');
      return;
    }
    const agentIds = parseAgentIds(teamForm.agent_ids);
    setSaveLoading(true);
    setError(null);
    try {
      await api.updateTeam(editingTeamId, { name, agent_ids: agentIds });
      setEditingTeamId(null);
      setTeamForm({ name: '', agent_ids: '' });
      setShowTeamForm(false);
      await loadTeams();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteTeam = async (id: string) => {
    setSaveLoading(true);
    setError(null);
    try {
      await api.removeTeam(id);
      setDeleteConfirmTeamId(null);
      await loadTeams();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleCreateGroup = async () => {
    const name = groupForm.name.trim();
    if (!name) {
      setError('群组名称必填');
      return;
    }
    const agentIds = parseAgentIds(groupForm.agent_ids);
    setSaveLoading(true);
    setError(null);
    try {
      await api.createGroup({ name, agent_ids: agentIds.length ? agentIds : undefined });
      setGroupForm({ name: '', agent_ids: '' });
      setShowGroupForm(false);
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleUpdateGroup = async () => {
    if (!editingGroupId) return;
    const name = groupForm.name.trim();
    if (!name) {
      setError('群组名称必填');
      return;
    }
    const agentIds = parseAgentIds(groupForm.agent_ids);
    setSaveLoading(true);
    setError(null);
    try {
      await api.updateGroup(editingGroupId, { name, agent_ids: agentIds });
      setEditingGroupId(null);
      setGroupForm({ name: '', agent_ids: '' });
      setShowGroupForm(false);
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    setSaveLoading(true);
    setError(null);
    try {
      await api.removeGroup(id);
      setDeleteConfirmGroupId(null);
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleString('zh-CN', {
      timeZone: DISPLAY_TIMEZONE,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-desktop-muted text-sm">
        加载中…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-desktop-bg">
      <div className="flex flex-col border-b border-white/10 shrink-0">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-medium text-desktop-text flex items-center gap-2">
            <Bot size={18} />
            智能体管理
          </h2>
          {tab === 'agents' && !showForm && (
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-desktop-accent text-desktop-text hover:brightness-110"
              onClick={() => {
                resetForm();
                setForm({ name: '', system_prompt: '', tool_names: '', role: '', goal_template: '', output_description: '' });
                setShowForm(true);
              }}
            >
              <Plus size={14} />
              新建智能体
            </button>
          )}
          {tab === 'teams' && !showTeamForm && (
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-desktop-accent text-desktop-text hover:brightness-110"
              onClick={() => {
                setTeamForm({ name: '', agent_ids: '' });
                setEditingTeamId(null);
                setShowTeamForm(true);
              }}
            >
              <Plus size={14} />
              新建团队
            </button>
          )}
          {tab === 'groups' && !showGroupForm && (
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-desktop-accent text-desktop-text hover:brightness-110"
              onClick={() => {
                setGroupForm({ name: '', agent_ids: '' });
                setEditingGroupId(null);
                setShowGroupForm(true);
              }}
            >
              <Plus size={14} />
              新建群组
            </button>
          )}
        </div>
        <div className="flex gap-0 px-4 border-t border-white/5">
          <button
            type="button"
            className={`px-3 py-2 text-xs border-b-2 transition-colors ${tab === 'agents' ? 'border-desktop-accent text-desktop-accent' : 'border-transparent text-desktop-muted hover:text-desktop-text'}`}
            onClick={() => setTab('agents')}
          >
            <Bot size={12} className="inline mr-1 align-middle" />
            智能体
          </button>
          <button
            type="button"
            className={`px-3 py-2 text-xs border-b-2 transition-colors ${tab === 'teams' ? 'border-desktop-accent text-desktop-accent' : 'border-transparent text-desktop-muted hover:text-desktop-text'}`}
            onClick={() => setTab('teams')}
          >
            <Users size={12} className="inline mr-1 align-middle" />
            团队
          </button>
          <button
            type="button"
            className={`px-3 py-2 text-xs border-b-2 transition-colors ${tab === 'groups' ? 'border-desktop-accent text-desktop-accent' : 'border-transparent text-desktop-muted hover:text-desktop-text'}`}
            onClick={() => setTab('groups')}
          >
            <MessageCircle size={12} className="inline mr-1 align-middle" />
            群组
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>
        )}

        {tab === 'agents' && showForm && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <h3 className="text-xs font-medium text-desktop-text">{editingId ? '编辑智能体' : '新建智能体'}</h3>
            <div>
              <label className="block text-[10px] text-desktop-muted mb-1">名称</label>
              <input
                type="text"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
                placeholder="例如：周报助手"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[10px] text-desktop-muted mb-1">系统提示词（角色、能力、约束）</label>
              <textarea
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent min-h-[80px]"
                placeholder="该智能体的身份与能力说明…"
                value={form.system_prompt}
                onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[10px] text-desktop-muted mb-1">工具列表（逗号分隔，空则用全部）</label>
              <input
                type="text"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
                placeholder="file.read, file.write, shell.run"
                value={form.tool_names}
                onChange={(e) => setForm((f) => ({ ...f, tool_names: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[10px] text-desktop-muted mb-1">角色（可选，如写手、审核、数据分析师）</label>
              <input
                type="text"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
                placeholder="便于组队与派活"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[10px] text-desktop-muted mb-1">目标模板（可选）</label>
              <input
                type="text"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
                placeholder="派发任务时可作为 goal 填入"
                value={form.goal_template}
                onChange={(e) => setForm((f) => ({ ...f, goal_template: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[10px] text-desktop-muted mb-1">期望输出说明（可选）</label>
              <input
                type="text"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
                placeholder="该智能体产出什么"
                value={form.output_description}
                onChange={(e) => setForm((f) => ({ ...f, output_description: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs bg-desktop-accent text-desktop-text disabled:opacity-50"
                disabled={saveLoading}
                onClick={editingId ? handleUpdate : handleCreate}
              >
                {saveLoading ? '保存中…' : editingId ? '保存' : '创建'}
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15"
                onClick={resetForm}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {tab === 'teams' && showTeamForm && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <h3 className="text-xs font-medium text-desktop-text">{editingTeamId ? '编辑团队' : '新建团队'}</h3>
            <div>
              <label className="block text-[10px] text-desktop-muted mb-1">名称</label>
              <input
                type="text"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
                placeholder="例如：周报流水线"
                value={teamForm.name}
                onChange={(e) => setTeamForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[10px] text-desktop-muted mb-1">智能体 id（逗号分隔，顺序即执行顺序）</label>
              <input
                type="text"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent font-mono"
                placeholder="从上方智能体列表复制 id"
                value={teamForm.agent_ids}
                onChange={(e) => setTeamForm((f) => ({ ...f, agent_ids: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-desktop-accent text-desktop-text disabled:opacity-50" disabled={saveLoading} onClick={editingTeamId ? handleUpdateTeam : handleCreateTeam}>
                {saveLoading ? '保存中…' : editingTeamId ? '保存' : '创建'}
              </button>
              <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15" onClick={() => { setShowTeamForm(false); setEditingTeamId(null); }}>
                取消
              </button>
            </div>
          </div>
        )}

        {tab === 'groups' && showGroupForm && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <h3 className="text-xs font-medium text-desktop-text">{editingGroupId ? '编辑群组' : '新建群组'}</h3>
            <div>
              <label className="block text-[10px] text-desktop-muted mb-1">名称</label>
              <input
                type="text"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
                placeholder="例如：头脑风暴组"
                value={groupForm.name}
                onChange={(e) => setGroupForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[10px] text-desktop-muted mb-1">成员智能体 id（逗号分隔，可选，也可建空群后由 X 加人）</label>
              <input
                type="text"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent font-mono"
                placeholder="从智能体列表复制 id"
                value={groupForm.agent_ids}
                onChange={(e) => setGroupForm((f) => ({ ...f, agent_ids: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-desktop-accent text-desktop-text disabled:opacity-50" disabled={saveLoading} onClick={editingGroupId ? handleUpdateGroup : handleCreateGroup}>
                {saveLoading ? '保存中…' : editingGroupId ? '保存' : '创建'}
              </button>
              <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15" onClick={() => { setShowGroupForm(false); setEditingGroupId(null); }}>
                取消
              </button>
            </div>
          </div>
        )}

        {tab === 'agents' && (
          <>
        <p className="text-[10px] text-desktop-muted">
          以下智能体由 X 主脑或本页创建，X 可通过 x.list_agents、x.run_agent 等工具派发任务。共 {agents.length} 个。
        </p>

        {agents.length === 0 ? (
          <div className="text-center py-8 text-desktop-muted text-xs">
            暂无智能体。点击「新建智能体」或让 X 主脑通过 x.create_agent 创建。
          </div>
        ) : (
          <div className="space-y-2">
            {agents.map((a) => (
              <div
                key={a.id}
                className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden"
              >
                <div
                  className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-white/[0.03]"
                  onClick={() => setExpandedId((id) => (id === a.id ? null : a.id))}
                >
                  {expandedId === a.id ? (
                    <ChevronDown size={14} className="text-desktop-muted shrink-0" />
                  ) : (
                    <ChevronRight size={14} className="text-desktop-muted shrink-0" />
                  )}
                  <span className="text-xs font-medium text-desktop-text truncate flex-1">{a.name}</span>
                  {a.role && (
                    <span className="text-[10px] text-desktop-muted shrink-0 px-1.5 py-0.5 rounded bg-white/5">{a.role}</span>
                  )}
                  <span className="text-[10px] text-desktop-muted/70 shrink-0">{a.id.slice(0, 12)}…</span>
                  <span className="text-[10px] text-desktop-muted shrink-0">{formatTime(a.updatedAt)}</span>
                  <button
                    type="button"
                    className="p-1.5 rounded hover:bg-white/10 text-desktop-muted hover:text-desktop-text"
                    title="编辑"
                    onClick={(e) => {
                      e.stopPropagation();
                      fillForm(a);
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  {deleteConfirmId === a.id ? (
                    <>
                      <span className="text-[10px] text-amber-400">确认删除？</span>
                      <button
                        type="button"
                        className="px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(a.id);
                        }}
                      >
                        删除
                      </button>
                      <button
                        type="button"
                        className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-desktop-text"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(null);
                        }}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="p-1.5 rounded hover:bg-red-500/10 text-desktop-muted hover:text-red-400"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(a.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {expandedId === a.id && (
                  <div className="px-3 pb-3 pt-0 border-t border-white/5 space-y-2">
                    {a.role && (
                      <div>
                        <span className="text-[10px] text-desktop-muted">角色</span>
                        <p className="text-[10px] text-desktop-text/80 mt-0.5">{a.role}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-[10px] text-desktop-muted">系统提示词</span>
                      <p className="text-xs text-desktop-text/90 whitespace-pre-wrap mt-0.5 bg-black/20 rounded px-2 py-1.5 max-h-24 overflow-y-auto">
                        {a.systemPrompt}
                      </p>
                    </div>
                    {a.toolNames.length > 0 && (
                      <div>
                        <span className="text-[10px] text-desktop-muted">工具</span>
                        <p className="text-[10px] text-desktop-text/80 mt-0.5">{a.toolNames.join(', ')}</p>
                      </div>
                    )}
                    {(a.goalTemplate || a.outputDescription) && (
                      <div className="flex gap-4">
                        {a.goalTemplate && (
                          <div>
                            <span className="text-[10px] text-desktop-muted">目标模板</span>
                            <p className="text-[10px] text-desktop-text/80 mt-0.5">{a.goalTemplate}</p>
                          </div>
                        )}
                        {a.outputDescription && (
                          <div>
                            <span className="text-[10px] text-desktop-muted">输出说明</span>
                            <p className="text-[10px] text-desktop-text/80 mt-0.5">{a.outputDescription}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
          </>
        )}

        {tab === 'teams' && (
          <>
            <p className="text-[10px] text-desktop-muted">
              团队按顺序执行智能体（流水线），X 用 x.run_team 派发任务。共 {teams.length} 个。
            </p>
            {loadingTeamsGroups ? (
              <div className="text-center py-6 text-desktop-muted text-xs">加载中…</div>
            ) : teams.length === 0 ? (
              <div className="text-center py-8 text-desktop-muted text-xs">暂无团队。点击「新建团队」或让 X 用 x.create_team 创建。</div>
            ) : (
              <div className="space-y-2">
                {teams.map((t) => (
                  <div key={t.id} className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <span className="text-xs font-medium text-desktop-text truncate flex-1">{t.name}</span>
                      <span className="text-[10px] text-desktop-muted shrink-0">{t.agentIds.length} 人</span>
                      <span className="text-[10px] text-desktop-muted/70 truncate max-w-[120px]">{resolveAgentIds(t.agentIds)}</span>
                      <button type="button" className="p-1.5 rounded hover:bg-white/10 text-desktop-muted hover:text-desktop-text" title="编辑" onClick={() => { setTeamForm({ name: t.name, agent_ids: t.agentIds.join(', ') }); setEditingTeamId(t.id); setShowTeamForm(true); }}>
                        <Pencil size={12} />
                      </button>
                      {deleteConfirmTeamId === t.id ? (
                        <>
                          <span className="text-[10px] text-amber-400">确认删除？</span>
                          <button type="button" className="px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30" onClick={() => handleDeleteTeam(t.id)}>删除</button>
                          <button type="button" className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-desktop-text" onClick={() => setDeleteConfirmTeamId(null)}>取消</button>
                        </>
                      ) : (
                        <button type="button" className="p-1.5 rounded hover:bg-red-500/10 text-desktop-muted hover:text-red-400" title="删除" onClick={() => setDeleteConfirmTeamId(t.id)}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'groups' && (
          <>
            <p className="text-[10px] text-desktop-muted">
              群组内成员对同一任务分别执行，X 用 x.run_group 派发并收集结果；用户可在 X 主脑对话中看到协作过程并补充或打断。共 {groups.length} 个。
            </p>
            {loadingTeamsGroups ? (
              <div className="text-center py-6 text-desktop-muted text-xs">加载中…</div>
            ) : groups.length === 0 ? (
              <div className="text-center py-8 text-desktop-muted text-xs">暂无群组。点击「新建群组」或让 X 用 x.create_group 创建。</div>
            ) : (
              <div className="space-y-2">
                {groups.map((g) => (
                  <div key={g.id} className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <span className="text-xs font-medium text-desktop-text truncate flex-1">{g.name}</span>
                      <span className="text-[10px] text-desktop-muted shrink-0">{g.agentIds.length} 人</span>
                      <span className="text-[10px] text-desktop-muted/70 truncate max-w-[120px]">{resolveAgentIds(g.agentIds)}</span>
                      <button type="button" className="p-1.5 rounded hover:bg-white/10 text-desktop-muted hover:text-desktop-text" title="编辑" onClick={() => { setGroupForm({ name: g.name, agent_ids: g.agentIds.join(', ') }); setEditingGroupId(g.id); setShowGroupForm(true); }}>
                        <Pencil size={12} />
                      </button>
                      {deleteConfirmGroupId === g.id ? (
                        <>
                          <span className="text-[10px] text-amber-400">确认删除？</span>
                          <button type="button" className="px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30" onClick={() => handleDeleteGroup(g.id)}>删除</button>
                          <button type="button" className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-desktop-text" onClick={() => setDeleteConfirmGroupId(null)}>取消</button>
                        </>
                      ) : (
                        <button type="button" className="p-1.5 rounded hover:bg-red-500/10 text-desktop-muted hover:text-red-400" title="删除" onClick={() => setDeleteConfirmGroupId(g.id)}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-6 border-t border-white/10 pt-4">
              <p className="text-[10px] text-desktop-muted mb-2">执行记录（群组对话与工作过程，按时间倒序）</p>
              {loadingRunHistory ? (
                <div className="text-center py-4 text-desktop-muted text-xs">加载中…</div>
              ) : groupRunHistory.length === 0 ? (
                <div className="text-center py-4 text-desktop-muted text-xs">暂无执行记录。X 使用 x.run_group 派发任务后会自动记录。</div>
              ) : (
                <div className="space-y-2">
                  {groupRunHistory.map((run) => (
                    <div key={run.id} className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/[0.03]"
                        onClick={() => setExpandedRunId((id) => (id === run.id ? null : run.id))}
                      >
                        {expandedRunId === run.id ? (
                          <ChevronDown size={14} className="text-desktop-muted shrink-0" />
                        ) : (
                          <ChevronRight size={14} className="text-desktop-muted shrink-0" />
                        )}
                        <span className="text-xs font-medium text-desktop-text truncate flex-1">{run.groupName}</span>
                        {run.cancelled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 shrink-0">已停止</span>}
                        <span className="text-[10px] text-desktop-muted shrink-0">{run.results.length} 条回复</span>
                        <span className="text-[10px] text-desktop-muted shrink-0">{formatTime(run.createdAt)}</span>
                      </button>
                      {expandedRunId === run.id && (
                        <div className="px-3 pb-3 pt-0 border-t border-white/5 space-y-3">
                          <div>
                            <span className="text-[10px] text-desktop-muted">目标</span>
                            <p className="text-xs text-desktop-text/90 mt-0.5 whitespace-pre-wrap bg-black/20 rounded px-2 py-1.5">{run.goal}</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-desktop-muted">工作过程（各成员产出）</span>
                            <div className="mt-1.5 space-y-2">
                              {run.results.map((r, i) => (
                                <div key={i} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
                                  <span className="text-[10px] font-medium text-desktop-accent">{r.agentName}</span>
                                  <p className="text-[10px] text-desktop-text/90 mt-0.5 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{r.content}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
