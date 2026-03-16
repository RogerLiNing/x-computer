/**
 * MCP扩展管理：管理MCP服务器配置
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plug, Plus, Trash2, Pencil, Search, RefreshCw, ChevronDown, Copy } from 'lucide-react';
import { api, type McpServerConfig, type McpToolSchema, normalizeMcpConfig } from '@/utils/api';
import { getUserId } from '@/utils/userId';
import { getCloudConfigSnapshot } from '@/utils/applyUserConfig';

interface Props {
  windowId: string;
}

export function McpApp({ windowId }: Props) {
  const userId = getUserId();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [configPath, setConfigPath] = useState('');
  const [fromEnv, setFromEnv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newTransport, setNewTransport] = useState<'http' | 'stdio'>('stdio');
  const [newServer, setNewServer] = useState<McpServerConfig>({ id: '', name: '' });
  const [headersJson, setHeadersJson] = useState('{}');
  const [argsJson, setArgsJson] = useState('["bing-cn-mcp"]');
  const [jsonImport, setJsonImport] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [lastTestedServerId, setLastTestedServerId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ servers: { id: string; toolsCount: number; error?: string }[]; totalTools: number } | null>(null);
  const [serverTools, setServerTools] = useState<Record<string, McpToolSchema[]>>({});
  const [expandedToolsServerId, setExpandedToolsServerId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTransport, setEditTransport] = useState<'http' | 'stdio'>('stdio');
  const [editServer, setEditServer] = useState<McpServerConfig>({ id: '', name: '' });
  const [editHeadersJson, setEditHeadersJson] = useState('{}');
  const [editArgsJson, setEditArgsJson] = useState('["bing-cn-mcp"]');
  const [mcpSearchQuery, setMcpSearchQuery] = useState('');
  const [mcpSearchResults, setMcpSearchResults] = useState<Array<{ name: string; title?: string; description?: string; version?: string; websiteUrl?: string; config: { id: string; name?: string; url?: string; command?: string; args?: string[] } }>>([]);
  const [mcpSearching, setMcpSearching] = useState(false);
  const [mcpAddingId, setMcpAddingId] = useState<string | null>(null);

  const currentConfigJson = (() => {
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const s of servers) {
      const entry: Record<string, unknown> = { id: s.id };
      if (s.name && s.name !== s.id) entry.name = s.name;
      if (s.url) entry.url = s.url;
      if (s.headers && Object.keys(s.headers).length > 0) entry.headers = s.headers;
      if (s.env && Object.keys(s.env).length > 0) entry.env = s.env;
      const sAny = s as unknown as Record<string, unknown>;
      if (sAny.type) entry.type = sAny.type;
      if (s.command) entry.command = s.command;
      if (s.args && s.args.length > 0) entry.args = s.args;
      mcpServers[s.id] = entry;
    }
    return JSON.stringify({ mcpServers }, null, 2);
  })();

  const handleCopyCurrentJson = useCallback(() => {
    navigator.clipboard.writeText(currentConfigJson).then(
      () => {
        setCopyFeedback('已复制');
        setTimeout(() => setCopyFeedback(null), 2000);
      },
      () => setCopyFeedback('复制失败'),
    );
  }, [currentConfigJson]);

  const loadConfig = useCallback(() => {
    const snapshot = getCloudConfigSnapshot();
    const raw = snapshot?.mcp_config;
    if (raw != null) {
      const list = normalizeMcpConfig(Array.isArray(raw) ? { servers: raw } : raw);
      if (list.length > 0) {
        setServers(list);
      }
    }
    setLoading(true);
    setError(null);
    Promise.all([api.mcpGetConfig(), api.mcpStatus()])
      .then(([config, st]) => {
        setServers(config.servers);
        setConfigPath(config.configPath);
        setFromEnv(config.fromEnv);
        setStatus(st);
      })
      .catch((e) => setError(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const saveServers = async (toSave: McpServerConfig[]) => {
    setSaveLoading(true);
    setError(null);
    setSaveMessage(null);
    try {
      await api.mcpSaveConfig({ servers: toSave });
      setServers(toSave);
      loadConfig();
      setSaveMessage('ok');
      setTimeout(() => setSaveMessage(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步失败');
      setSaveMessage('fail');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleTest = async (server: McpServerConfig) => {
    setTestingId(server.id);
    setTestResult(null);
    try {
      const res = await api.mcpTest(server);
      if (res.ok) {
        const list = res.tools ?? [];
        setServerTools((prev) => ({ ...prev, [server.id]: list }));
        setTestResult(`成功，发现 ${res.toolsCount ?? list.length} 个工具`);
        setLastTestedServerId(server.id);
        setExpandedToolsServerId(server.id);
      } else {
        setServerTools((prev) => {
          const next = { ...prev };
          delete next[server.id];
          return next;
        });
        setTestResult(`失败: ${res.error ?? '未知错误'}`);
        setLastTestedServerId(server.id);
      }
    } catch (e) {
      setServerTools((prev) => {
        const next = { ...prev };
        delete next[server.id];
        return next;
      });
      setTestResult(`失败: ${e instanceof Error ? e.message : '请求异常'}`);
      setLastTestedServerId(server.id);
    } finally {
      setTestingId(null);
    }
  };

  const handleAdd = () => {
    if (!newServer.id?.trim()) {
      setError('id 为必填');
      return;
    }
    if (servers.some((x) => x.id === newServer.id)) {
      setError(`id "${newServer.id}" 已存在`);
      return;
    }
    let s: McpServerConfig;
    if (newTransport === 'http') {
      let headers: Record<string, string> | undefined;
      try {
        const parsed = JSON.parse(headersJson || '{}');
        if (parsed && typeof parsed === 'object') {
          headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k), String(v)]));
        }
      } catch {
        setError('headers 格式无效，需为 JSON 对象');
        return;
      }
      if (!newServer.url?.trim()) {
        setError('URL 为必填');
        return;
      }
      s = { ...newServer, url: newServer.url, headers: headers && Object.keys(headers).length ? headers : undefined };
    } else {
      let args: string[];
      try {
        const parsed = JSON.parse(argsJson || '[]');
        args = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        setError('args 格式无效，需为 JSON 数组，如 ["bing-cn-mcp"]');
        return;
      }
      if (!newServer.command?.trim()) {
        setError('command 为必填，如 npx');
        return;
      }
      s = { ...newServer, command: newServer.command, args: args.length ? args : undefined };
    }
    const merged = [...servers, s];
    setServers(merged);
    setShowAdd(false);
    setEditingId(null);
    setNewServer({ id: '', name: '' });
    setHeadersJson('{}');
    setArgsJson('["bing-cn-mcp"]');
    setError(null);
    saveServers(merged);
  };

  const handleRemove = (id: string) => {
    const next = servers.filter((s) => s.id !== id);
    setServers(next);
    setEditingId(null);
    saveServers(next);
  };

  const handleStartEdit = (s: McpServerConfig) => {
    setShowAdd(false);
    setEditingId(s.id);
    setEditTransport(s.url ? 'http' : 'stdio');
    setEditServer({ ...s });
    setEditHeadersJson(JSON.stringify(s.headers ?? {}, null, 2));
    setEditArgsJson(JSON.stringify(s.args ?? ['bing-cn-mcp'], null, 2));
    setError(null);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    let s: McpServerConfig;
    if (editTransport === 'http') {
      let headers: Record<string, string> | undefined;
      try {
        const parsed = JSON.parse(editHeadersJson || '{}');
        if (parsed && typeof parsed === 'object') {
          headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k), String(v)]));
        }
      } catch {
        setError('headers 格式无效，需为 JSON 对象');
        return;
      }
      if (!editServer.url?.trim()) {
        setError('URL 为必填');
        return;
      }
      s = { ...editServer, id: editingId, url: editServer.url, headers: headers && Object.keys(headers).length ? headers : undefined };
    } else {
      let args: string[];
      try {
        const parsed = JSON.parse(editArgsJson || '[]');
        args = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        setError('args 格式无效，需为 JSON 数组');
        return;
      }
      if (!editServer.command?.trim()) {
        setError('command 为必填');
        return;
      }
      s = { ...editServer, id: editingId, command: editServer.command, args: args.length ? args : undefined };
    }
    const merged = servers.map((x) => (x.id === editingId ? s : x));
    setServers(merged);
    setEditingId(null);
    setError(null);
    saveServers(merged);
  };

  const handleImportJson = async () => {
    setImportMsg(null);
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonImport.trim());
    } catch {
      setError('JSON 格式无效');
      return;
    }
    const normalized = normalizeMcpConfig(parsed);
    if (normalized.length === 0) {
      setError('未解析到有效配置。支持格式：{ "servers": [...] } 或 { "mcpServers": { "id": { "url" 或 "command","args" } } }');
      return;
    }
    const merged = [...servers];
    for (const s of normalized) {
      if (!merged.some((x) => x.id === s.id)) merged.push(s);
    }
    setServers(merged);
    setJsonImport('');
    setImportMsg(`已导入 ${normalized.length} 个服务器，共 ${merged.length} 个`);
    await saveServers(merged);
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h2 className="text-sm font-medium text-desktop-text flex items-center gap-2">
          <Plug size={16} />
          MCP 扩展
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-desktop-accent/20 text-desktop-accent hover:bg-desktop-accent/30 transition-colors"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={12} />
            添加服务器
          </button>
          {saveLoading && <span className="text-xs text-desktop-muted flex items-center gap-1"><RefreshCw size={12} className="animate-spin" />保存中…</span>}
          {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
          {saveMessage === 'fail' && <span className="text-xs text-amber-400/90">同步失败</span>}
        </div>
      </div>

      {fromEnv && (
        <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 mb-3">
          当前配置来自环境变量，保存将写入文件
        </div>
      )}

      {/* 搜索添加区域 */}
      <div className="flex gap-2 mb-3 shrink-0">
        <input
          type="text"
          placeholder="搜索 MCP 市场..."
          className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
          value={mcpSearchQuery}
          onChange={(e) => setMcpSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), api.mcpRegistrySearch(mcpSearchQuery, 8).then((r) => { if (r?.ok && r.servers) setMcpSearchResults(r.servers); else setMcpSearchResults([]); }).catch(() => setMcpSearchResults([])).finally(() => setMcpSearching(false)))}
        />
        <button
          type="button"
          className="px-3 py-2 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-desktop-muted flex items-center gap-1.5"
          disabled={mcpSearching}
          onClick={async () => {
            setMcpSearching(true);
            try {
              const r = await api.mcpRegistrySearch(mcpSearchQuery || ' ', 8);
              if (r?.ok && r.servers) setMcpSearchResults(r.servers);
              else setMcpSearchResults([]);
            } catch {
              setMcpSearchResults([]);
            } finally {
              setMcpSearching(false);
            }
          }}
        >
          {mcpSearching ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
          搜索
        </button>
      </div>

      {/* 搜索结果 */}
      {mcpSearchResults.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 shrink-0">
          {mcpSearchResults.map((s) => {
            const cfg = s.config;
            const already = servers.some((x) => x.id === cfg.id);
            return (
              <div key={s.name} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5 text-xs">
                <span className="text-desktop-text">{s.title ?? s.name}</span>
                {already ? (
                  <span className="text-[10px] text-green-400">已添加</span>
                ) : (
                  <button
                    type="button"
                    className="text-[10px] text-desktop-accent hover:underline"
                    disabled={mcpAddingId !== null}
                    onClick={async () => {
                      setMcpAddingId(cfg.id);
                      try {
                        const entry: McpServerConfig = { id: cfg.id, name: cfg.name ?? s.title ?? s.name, url: cfg.url, command: cfg.command, args: cfg.args };
                        await saveServers([...servers, entry]);
                        setMcpSearchResults((prev) => prev.filter((x) => x.config.id !== cfg.id));
                      } catch (e) {
                        setError(e instanceof Error ? e.message : '添加失败');
                      } finally {
                        setMcpAddingId(null);
                      }
                    }}
                  >
                    {mcpAddingId === cfg.id ? '添加中…' : '添加'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {status && <div className="text-[11px] text-desktop-muted mb-3 shrink-0">已加载 {status.totalTools} 个工具</div>}

      {/* JSON配置区域 */}
      <details className="group mb-3 shrink-0">
        <summary className="text-xs text-desktop-muted cursor-pointer hover:text-desktop-text list-none flex items-center gap-1.5">
          <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
          查看/导入 JSON 配置
        </summary>
        <div className="mt-2 space-y-2">
          <textarea
            className="w-full h-16 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-desktop-text font-mono outline-none resize-y"
            value={jsonImport}
            onChange={(e) => { setJsonImport(e.target.value); setImportMsg(null); setError(null); }}
            placeholder='{"mcpServers":{"id":{"url":"https://..."}}}'
            spellCheck={false}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="px-2.5 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-muted hover:bg-white/20"
              onClick={handleImportJson}
            >
              导入
            </button>
            <button
              type="button"
              className="px-2.5 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-muted hover:bg-white/20 flex items-center gap-1"
              onClick={handleCopyCurrentJson}
            >
              <Copy size={12} />
              {copyFeedback || '复制配置'}
            </button>
          </div>
          {importMsg && <span className="text-xs text-green-400/90">{importMsg}</span>}
        </div>
      </details>

      {loading ? (
        <div className="py-12 text-center text-xs text-desktop-muted">加载中...</div>
      ) : servers.length === 0 ? (
        <div className="py-6 rounded-xl bg-white/[0.02] border border-white/5 text-center text-xs text-desktop-muted">
          暂无 MCP 服务器。点击「添加服务器」开始配置。
        </div>
      ) : (
        <div className="flex-1 overflow-auto space-y-2">
          <ul className="space-y-2">
            {servers.map((s) => {
              const tools = serverTools[s.id];
              const hasTools = tools && tools.length > 0;
              const isExpanded = expandedToolsServerId === s.id;
              const statusEntry = status?.servers.find((x) => x.id === s.id);
              return (
                <li
                  key={s.id}
                  className="rounded-lg bg-white/[0.03] border border-white/5 overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-3 py-2.5 px-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-desktop-text truncate">{s.name || s.id}</div>
                      <div className="text-[11px] text-desktop-muted truncate">
                        {s.url ?? (s.command ? [s.command, ...(s.args ?? [])].join(' ') : '—')}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {statusEntry && (
                          <span className="text-[10px] text-desktop-muted">
                            {statusEntry.error
                              ? `错误: ${statusEntry.error}`
                              : `${statusEntry.toolsCount ?? 0} 个工具`}
                          </span>
                        )}
                        {testingId === s.id && <span className="text-[10px] text-desktop-muted">测试中…</span>}
                        {lastTestedServerId === s.id && testResult && (
                          <span className={`text-[10px] ${testResult.startsWith('成功') ? 'text-green-400' : 'text-red-400'}`}>
                            {testResult}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="p-1 rounded text-desktop-muted hover:bg-white/10 hover:text-desktop-text"
                        title="测试"
                        onClick={() => handleTest(s)}
                        disabled={testingId === s.id}
                      >
                        <RefreshCw size={14} className={testingId === s.id ? 'animate-spin' : ''} />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded text-desktop-muted hover:bg-white/10 hover:text-desktop-text"
                        title="编辑"
                        onClick={() => handleStartEdit(s)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded text-desktop-muted hover:bg-red-500/20 hover:text-red-400"
                        title="删除"
                        onClick={() => handleRemove(s.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {/* 工具列表展开 */}
                  {hasTools && (
                    <div className="border-t border-white/5 px-3 py-2 bg-white/[0.02]">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs text-desktop-muted hover:text-desktop-text"
                        onClick={() => setExpandedToolsServerId(isExpanded ? null : s.id)}
                      >
                        <ChevronDown size={12} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        工具 ({tools.length})
                      </button>
                      {isExpanded && (
                        <div className="mt-2 space-y-1 max-h-32 overflow-auto">
                          {tools.map((t) => (
                            <div key={t.name} className="text-[10px] text-desktop-muted">
                              <span className="text-desktop-text">{t.name}</span>
                              {t.description && <span className="ml-1">- {t.description}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {editingId && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div className="text-xs font-medium text-desktop-text">编辑 MCP 服务器</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${editTransport === 'http' ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/10 text-desktop-muted hover:bg-white/20'}`}
                  onClick={() => setEditTransport('http')}
                >
                  HTTP
                </button>
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${editTransport === 'stdio' ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/10 text-desktop-muted hover:bg-white/20'}`}
                  onClick={() => setEditTransport('stdio')}
                >
                  Stdio
                </button>
              </div>
              <div className="grid gap-2 text-xs">
                <div>
                  <label className="text-desktop-muted block mb-0.5">ID（不可修改）</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-muted outline-none"
                    value={editServer.id}
                    readOnly
                    disabled
                  />
                </div>
                {editTransport === 'http' ? (
                  <>
                    <div>
                      <label className="text-desktop-muted block mb-0.5">URL（JSON-RPC 端点）</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                        value={editServer.url ?? ''}
                        onChange={(e) => setEditServer({ ...editServer, url: e.target.value.trim() || undefined })}
                        placeholder="https://mcp.exa.ai/mcp"
                      />
                    </div>
                    <div>
                      <label className="text-desktop-muted block mb-0.5">Headers（JSON，可选）</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text font-mono outline-none"
                        value={editHeadersJson}
                        onChange={(e) => setEditHeadersJson(e.target.value)}
                        placeholder='{"Authorization":"Bearer YOUR_KEY"}'
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-desktop-muted block mb-0.5">command（启动命令）</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                        value={editServer.command ?? ''}
                        onChange={(e) => setEditServer({ ...editServer, command: e.target.value.trim() || undefined })}
                        placeholder="npx"
                      />
                    </div>
                    <div>
                      <label className="text-desktop-muted block mb-0.5">args（JSON 数组）</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text font-mono outline-none"
                        value={editArgsJson}
                        onChange={(e) => setEditArgsJson(e.target.value)}
                        placeholder='["bing-cn-mcp"]'
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="text-desktop-muted block mb-0.5">名称（可选）</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                    value={editServer.name ?? ''}
                    onChange={(e) => setEditServer({ ...editServer, name: e.target.value || undefined })}
                    placeholder="Bing CN 搜索"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-xs bg-desktop-accent/60 text-desktop-text hover:bg-desktop-accent/80"
                  onClick={handleSaveEdit}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-muted hover:bg-white/20"
                  onClick={() => { setEditingId(null); setError(null); }}
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {showAdd && (
            <div className="rounded-xl border border-desktop-accent/30 bg-desktop-accent/5 p-4 space-y-3">
              <div className="text-xs font-medium text-desktop-text">添加 MCP 服务器</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${newTransport === 'http' ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/10 text-desktop-muted hover:bg-white/20'}`}
                  onClick={() => setNewTransport('http')}
                >
                  HTTP
                </button>
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${newTransport === 'stdio' ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/10 text-desktop-muted hover:bg-white/20'}`}
                  onClick={() => setNewTransport('stdio')}
                >
                  Stdio
                </button>
              </div>
              <div className="grid gap-2 text-xs">
                <div>
                  <label className="text-desktop-muted block mb-0.5">ID（唯一标识）</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                    value={newServer.id}
                    onChange={(e) => setNewServer({ ...newServer, id: e.target.value.trim() })}
                    placeholder="e.g. bingcn"
                  />
                </div>
                {newTransport === 'http' ? (
                  <>
                    <div>
                      <label className="text-desktop-muted block mb-0.5">URL（JSON-RPC 端点）</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                        value={newServer.url ?? ''}
                        onChange={(e) => setNewServer({ ...newServer, url: e.target.value.trim() || undefined })}
                        placeholder="https://mcp.exa.ai/mcp"
                      />
                    </div>
                    <div>
                      <label className="text-desktop-muted block mb-0.5">Headers（JSON，可选）</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text font-mono outline-none"
                        value={headersJson}
                        onChange={(e) => setHeadersJson(e.target.value)}
                        placeholder='{"Authorization":"Bearer YOUR_KEY"}'
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-desktop-muted block mb-0.5">command（启动命令）</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                        value={newServer.command ?? ''}
                        onChange={(e) => setNewServer({ ...newServer, command: e.target.value.trim() || undefined })}
                        placeholder="npx"
                      />
                    </div>
                    <div>
                      <label className="text-desktop-muted block mb-0.5">args（JSON 数组）</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text font-mono outline-none"
                        value={argsJson}
                        onChange={(e) => setArgsJson(e.target.value)}
                        placeholder='["bing-cn-mcp"]'
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="text-desktop-muted block mb-0.5">名称（可选）</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                    value={newServer.name ?? ''}
                    onChange={(e) => setNewServer({ ...newServer, name: e.target.value || undefined })}
                    placeholder="Bing CN 搜索"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-xs bg-desktop-accent/60 text-desktop-text hover:bg-desktop-accent/80"
                  onClick={handleAdd}
                >
                  添加
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-muted hover:bg-white/20"
                  onClick={() => { setShowAdd(false); setError(null); }}
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {error && <div className="text-xs text-red-400/90">{error}</div>}
        </div>
      )}
    </div>
  );
}
