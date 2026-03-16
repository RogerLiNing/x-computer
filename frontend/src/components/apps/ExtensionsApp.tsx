/**
 * 扩展管理：整合 Skills、MCP、工具列表
 */

import { useState, useEffect, useRef } from 'react';
import { Sparkles, Plug, Search, RefreshCw, ChevronDown, ChevronRight, CheckCircle, XCircle, Wrench, Plus, Trash2 } from 'lucide-react';
import { api, type McpServerConfig } from '@/utils/api';
import { getCloudConfigSnapshot } from '@/utils/applyUserConfig';

interface Props {
  windowId: string;
}

interface Tool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface McpStatus {
  servers: Array<{ id: string; name?: string; url?: string; command?: string; args?: string[]; toolsCount: number; error?: string }>;
  totalTools: number;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  dirName: string;
  configFields?: Array<{ key: string; label?: string; description?: string }>;
}

type SkillConfigValue = Record<string, string | undefined>;

// Skills 配置面板
function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillConfig, setSkillConfig] = useState<Record<string, SkillConfigValue>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const [deletingDir, setDeletingDir] = useState<string | null>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillSearchResults, setSkillSearchResults] = useState<Array<{ slug: string; version?: string; description: string }>>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    const snapshot = getCloudConfigSnapshot();
    const snapRaw = snapshot?.skill_config;
    if (typeof snapRaw === 'object' && snapRaw !== null && !Array.isArray(snapRaw)) {
      setSkillConfig(snapRaw as Record<string, SkillConfigValue>);
    }
    setLoading(true);
    setError(null);
    return Promise.all([
      api.getSkills(),
      api.getUserConfig(),
      api.getRecommendedSkills().catch(() => []),
    ])
      .then(([list, config]) => {
        setSkills(list);
        const raw = config?.skill_config;
        const obj = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, SkillConfigValue>) : {};
        setSkillConfig(obj);
      })
      .catch((e) => setError(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!loading && skillSearchQuery) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        api.searchSkills(skillSearchQuery).then((r) => setSkillSearchResults(r.skills ?? [])).catch(() => setSkillSearchResults([]));
      }, 300);
    } else {
      setSkillSearchResults([]);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [skillSearchQuery, loading]);

  const handleInstall = async (slug: string) => {
    try {
      await api.installSkill(slug);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '安装失败');
    }
  };

  const handleUninstall = async (dirName: string) => {
    setDeletingDir(dirName);
    try {
      await api.deleteSkill(dirName);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeletingDir(null);
    }
  };

  const handleConfigChange = (skillName: string, key: string, value: string) => {
    const newConfig = { ...skillConfig, [skillName]: { ...skillConfig[skillName], [key]: value } };
    setSkillConfig(newConfig);
    setTimeout(() => {
      api.setUserConfigKey('skill_config', newConfig)
        .then(() => { setSaveMessage('ok'); setTimeout(() => setSaveMessage(null), 2000); })
        .catch(() => { setSaveMessage('fail'); setTimeout(() => setSaveMessage(null), 2000); });
    }, 500);
  };

  const filteredSkills = skills.filter((s) => !skillSearchQuery || s.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) || s.description?.toLowerCase().includes(skillSearchQuery.toLowerCase()));

  return (
    <div className="space-y-3">
      {/* 搜索安装 Skills */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="搜索 SkillHub..."
          value={skillSearchQuery}
          onChange={(e) => setSkillSearchQuery(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 outline-none focus:ring-1 focus:ring-purple-400/50"
        />
        {skillSearchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#2a2a2a] border border-white/10 rounded-lg shadow-lg z-10 max-h-48 overflow-auto">
            {skillSearchResults.map((s) => (
              <div key={s.slug} className="flex items-center justify-between px-3 py-2 hover:bg-white/5">
                <div>
                  <div className="text-sm font-medium">{s.slug}</div>
                  <div className="text-xs text-gray-500">{s.description}</div>
                </div>
                <button
                  onClick={() => handleInstall(s.slug)}
                  className="px-2 py-1 text-xs bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/30"
                >
                  安装
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 已安装 Skills */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-4 text-gray-500"><RefreshCw size={16} className="animate-spin inline mr-2" />加载中</div>
        ) : filteredSkills.length === 0 ? (
          <div className="text-center py-4 text-gray-500">暂无 Skills</div>
        ) : (
          filteredSkills.map((skill) => (
            <div key={skill.id} className="rounded-lg bg-white/[0.03] border border-white/5 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-purple-400" />
                  <span className="font-medium text-sm">{skill.name}</span>
                </div>
                <button
                  onClick={() => handleUninstall(skill.dirName)}
                  disabled={deletingDir === skill.dirName}
                  className="p-1 text-gray-500 hover:text-red-400 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="px-3 pb-2 text-xs text-gray-400">{skill.description}</div>
              {skill.configFields && skill.configFields.length > 0 && (
                <div className="px-3 pb-3 border-t border-white/5 pt-2 space-y-2">
                  {skill.configFields.map((field) => (
                    <div key={field.key}>
                      <label className="text-xs text-gray-500 block mb-1">{field.label || field.key}</label>
                      <input
                        type="text"
                        value={skillConfig[skill.name]?.[field.key] ?? ''}
                        onChange={(e) => handleConfigChange(skill.name, field.key, e.target.value)}
                        placeholder={field.description}
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 placeholder:text-gray-600"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// MCP 配置面板
function McpPanel() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTransport, setNewTransport] = useState<'http' | 'stdio'>('http');
  const [newServer, setNewServer] = useState<{ id: string; name: string; url?: string; command?: string }>({ id: '', name: '' });
  const [error, setError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [expandedMcp, setExpandedMcp] = useState<string | null>(null);
  const [mcpSearchQuery, setMcpSearchQuery] = useState('');
  const [mcpSearchResults, setMcpSearchResults] = useState<Array<{ name: string; description?: string; config: { id: string; url?: string; command?: string; args?: string[] } }>>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.mcpGetConfig(), api.mcpStatus()])
      .then(([cfg, st]) => {
        const list = cfg && typeof cfg === 'object' ? Object.entries(cfg).map(([id, entry]) => ({ id, ...(entry as object) })) as McpServerConfig[] : [];
        setServers(list);
        setStatus(st);
      })
      .catch((e) => setError(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!mcpSearchQuery) { setMcpSearchResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.mcpRegistrySearch(mcpSearchQuery, 8).then((r) => { if (r?.ok && r.servers) setMcpSearchResults(r.servers); else setMcpSearchResults([]); }).catch(() => setMcpSearchResults([]));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [mcpSearchQuery]);

  const handleAdd = async () => {
    if (!newServer.id) return;
    setSaveLoading(true);
    try {
      const s: McpServerConfig = { id: newServer.id, name: newServer.name || newServer.id, url: newServer.url, command: newServer.command };
      await api.mcpSaveConfig({ servers: [...servers, s] });
      load();
      setShowAdd(false);
      setNewServer({ id: '', name: '' });
    } catch (e) { setError(e instanceof Error ? e.message : '添加失败'); } finally { setSaveLoading(false); }
  };

  const handleDelete = async (id: string) => {
    await api.mcpSaveConfig({ servers: servers.filter((s) => s.id !== id) });
    load();
  };

  const handleTest = async (server: McpServerConfig) => {
    setTestingId(server.id);
    setTestResult(null);
    try {
      const r = await api.mcpTest(server);
      if (r.ok) setTestResult(`成功，发现 ${r.toolsCount ?? r.tools?.length ?? 0} 个工具`);
      else setTestResult(`失败: ${r.error}`);
    } catch (e) { setTestResult(`失败: ${e instanceof Error ? e.message : '未知错误'}`); } finally { setTestingId(null); }
  };

  const filteredMcp = status?.servers.filter((s) => !mcpSearchQuery || s.id.toLowerCase().includes(mcpSearchQuery.toLowerCase()) || s.name?.toLowerCase().includes(mcpSearchQuery.toLowerCase()));

  return (
    <div className="space-y-3">
      {/* 搜索添加 MCP */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="搜索 MCP 市场..."
          value={mcpSearchQuery}
          onChange={(e) => setMcpSearchQuery(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 outline-none focus:ring-1 focus:ring-blue-400/50"
        />
        {mcpSearchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#2a2a2a] border border-white/10 rounded-lg shadow-lg z-10 max-h-48 overflow-auto">
            {mcpSearchResults.map((s) => (
              <div key={s.config.id} className="flex items-center justify-between px-3 py-2 hover:bg-white/5">
                <div>
                  <div className="text-sm font-medium">{s.name || s.config.id}</div>
                  <div className="text-xs text-gray-500">{s.description}</div>
                </div>
                <button
                  onClick={async () => {
                    const entry: McpServerConfig = { id: s.config.id, name: s.name ?? s.config.id, url: s.config.url, command: s.config.command, args: s.config.args };
                    await api.mcpSaveConfig({ servers: [...servers, entry] });
                    load();
                    setMcpSearchResults((prev) => prev.filter((x) => x.config.id !== s.config.id));
                  }}
                  className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30"
                >
                  添加
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 手动添加按钮 */}
      <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 text-sm text-blue-400 hover:underline">
        <Plus size={14} /> 手动添加
      </button>

      {/* 添加表单 */}
      {showAdd && (
        <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3 space-y-2">
          <div className="flex gap-2 mb-2">
            <button onClick={() => setNewTransport('http')} className={`px-2 py-1 text-xs rounded ${newTransport === 'http' ? 'bg-blue-500/30 text-blue-400' : 'bg-white/10 text-gray-400'}`}>HTTP</button>
            <button onClick={() => setNewTransport('stdio')} className={`px-2 py-1 text-xs rounded ${newTransport === 'stdio' ? 'bg-blue-500/30 text-blue-400' : 'bg-white/10 text-gray-400'}`}>Stdio</button>
          </div>
          <input type="text" placeholder="ID" value={newServer.id} onChange={(e) => setNewServer({ ...newServer, id: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs" />
          <input type="text" placeholder="名称（可选）" value={newServer.name} onChange={(e) => setNewServer({ ...newServer, name: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs" />
          {newTransport === 'http' ? (
            <input type="text" placeholder="URL" value={newServer.url ?? ''} onChange={(e) => setNewServer({ ...newServer, url: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs" />
          ) : (
            <input type="text" placeholder="Command" value={newServer.command ?? ''} onChange={(e) => setNewServer({ ...newServer, command: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs" />
          )}
          <button onClick={handleAdd} disabled={saveLoading || !newServer.id || (!newServer.url && !newServer.command)} className="w-full py-1 text-xs bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 disabled:opacity-50">
            {saveLoading ? '保存中...' : '添加'}
          </button>
        </div>
      )}

      {/* MCP 服务器列表 */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-4 text-gray-500"><RefreshCw size={16} className="animate-spin inline mr-2" />加载中</div>
        ) : filteredMcp?.length === 0 ? (
          <div className="text-center py-4 text-gray-500">暂无 MCP 服务器</div>
        ) : (
          filteredMcp?.map((server) => (
            <div key={server.id} className="rounded-lg bg-white/[0.03] border border-white/5 overflow-hidden">
              <button onClick={() => setExpandedMcp(expandedMcp === server.id ? null : server.id)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5">
                <div className="flex items-center gap-2">
                  {expandedMcp === server.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="font-medium text-sm">{server.name || server.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  {server.error ? <XCircle size={14} className="text-red-400" /> : <CheckCircle size={14} className="text-green-400" />}
                  <span className="text-xs bg-white/10 px-1.5 py-0.5 rounded">{server.toolsCount}</span>
                </div>
              </button>
              {expandedMcp === server.id && (
                <div className="px-3 pb-3 border-t border-white/5 pt-2 space-y-2">
                  <div className="text-xs"><span className="text-gray-500">ID: </span><span className="font-mono">{server.id}</span></div>
                  {server.url && <div className="text-xs"><span className="text-gray-500">URL: </span><span className="font-mono break-all">{server.url}</span></div>}
                  {server.command && <div className="text-xs"><span className="text-gray-500">Command: </span><span className="font-mono">{server.command} {server.args?.join(' ')}</span></div>}
                  {server.error && <div className="text-xs text-red-400 bg-red-400/10 p-2 rounded">{server.error}</div>}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => handleTest(servers.find((s) => s.id === server.id)!)} disabled={testingId === server.id} className="px-2 py-1 text-xs bg-white/10 rounded hover:bg-white/20 disabled:opacity-50">
                      {testingId === server.id ? '测试中...' : '测试'}
                    </button>
                    <button onClick={() => handleDelete(server.id)} className="px-2 py-1 text-xs text-red-400 hover:underline">删除</button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// 工具列表面板
function ToolsPanel() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  useEffect(() => {
    api.getTools().then(setTools).finally(() => setLoading(false));
  }, []);

  const filteredTools = tools.filter((t) => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.description?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="搜索工具..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 outline-none focus:ring-1 focus:ring-green-400/50"
        />
      </div>
      {loading ? (
        <div className="text-center py-4 text-gray-500"><RefreshCw size={16} className="animate-spin inline mr-2" />加载中</div>
      ) : filteredTools.length === 0 ? (
        <div className="text-center py-4 text-gray-500">暂无工具</div>
      ) : (
        filteredTools.map((tool) => (
          <div key={tool.name} className="rounded-lg bg-white/[0.03] border border-white/5 overflow-hidden">
            <button onClick={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5">
              <div className="flex items-center gap-2 min-w-0">
                {expandedTool === tool.name ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="font-mono text-sm text-green-300 truncate">{tool.name}</span>
              </div>
              <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
            </button>
            {expandedTool === tool.name && (
              <div className="px-3 pb-3 border-t border-white/5 pt-2">
                <p className="text-xs text-gray-400 mb-2">{tool.description || '无描述'}</p>
                {tool.parameters && (
                  <pre className="text-xs font-mono bg-black/30 p-2 rounded overflow-x-auto">{JSON.stringify(tool.parameters, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// 主组件
export function ExtensionsApp({ windowId }: Props) {
  const [activeTab, setActiveTab] = useState<'skills' | 'mcp' | 'tools'>('skills');

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-gray-200">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <Sparkles size={18} className="text-purple-400" />
        <span className="font-medium">扩展管理</span>
      </div>

      {/* 标签切换 */}
      <div className="flex border-b border-white/10">
        <button
          onClick={() => setActiveTab('skills')}
          className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            activeTab === 'skills' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Sparkles size={14} /> Skills
        </button>
        <button
          onClick={() => setActiveTab('mcp')}
          className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            activeTab === 'mcp' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Plug size={14} /> MCP
        </button>
        <button
          onClick={() => setActiveTab('tools')}
          className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            activeTab === 'tools' ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Wrench size={14} /> 工具
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'skills' && <SkillsPanel />}
        {activeTab === 'mcp' && <McpPanel />}
        {activeTab === 'tools' && <ToolsPanel />}
      </div>
    </div>
  );
}
