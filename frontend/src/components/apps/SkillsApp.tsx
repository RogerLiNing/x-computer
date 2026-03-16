/**
 * 技能管理：管理Skills配置
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Plus, Trash2, Search, RefreshCw } from 'lucide-react';
import { api } from '@/utils/api';
import { getUserId } from '@/utils/userId';
import { getCloudConfigSnapshot } from '@/utils/applyUserConfig';

interface Props {
  windowId: string;
}

interface SkillConfigField {
  key: string;
  label?: string;
  description?: string;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  dirName: string;
  configFields?: SkillConfigField[];
}

type SkillConfigValue = Record<string, string | undefined>;

export function SkillsApp({ windowId }: Props) {
  const userId = getUserId();
  const [recommended, setRecommended] = useState<Array<{ slug: string; name: string; description: string; category?: string; installed: boolean }>>([]);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillConfig, setSkillConfig] = useState<Record<string, SkillConfigValue>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [extractingLLM, setExtractingLLM] = useState(false);
  const [deletingDir, setDeletingDir] = useState<string | null>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillSearchResults, setSkillSearchResults] = useState<Array<{ slug: string; version?: string; description: string }>>([]);
  const [skillSearching, setSkillSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const load = useCallback((opts?: { extractLLM?: boolean }) => {
    const snapshot = getCloudConfigSnapshot();
    const snapRaw = snapshot?.skill_config;
    if (typeof snapRaw === 'object' && snapRaw !== null && !Array.isArray(snapRaw)) {
      setSkillConfig(snapRaw as Record<string, SkillConfigValue>);
    }
    setLoading(true);
    setError(null);
    return Promise.all([
      api.getSkills(opts?.extractLLM ? { extract: 'llm' } : undefined),
      api.getUserConfig(),
      api.getRecommendedSkills().catch(() => []),
    ])
      .then(([list, config, rec]) => {
        setSkills(list);
        setRecommended(Array.isArray(rec) ? rec : []);
        const raw = config?.skill_config;
        const obj =
          typeof raw === 'object' && raw !== null && !Array.isArray(raw)
            ? (raw as Record<string, SkillConfigValue>)
            : {};
        setSkillConfig(obj);
      })
      .catch((e) => setError(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // 配置修改后自动保存并提示
  useEffect(() => {
    if (isFirstMount.current || loading) {
      if (!loading) isFirstMount.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true);
      setError(null);
      setSaveMessage(null);
      api.setUserConfigKey('skill_config', skillConfig)
        .then(() => {
          setSaveMessage('ok');
          setTimeout(() => setSaveMessage(null), 2500);
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '同步失败');
          setSaveMessage('fail');
        })
        .finally(() => setSaveLoading(false));
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [skillConfig, loading]);

  const handleDeleteSkill = useCallback(async (dirName: string, skillId: string) => {
    if (!confirm(`确定要删除 Skill「${dirName}」吗？此操作不可恢复。`)) return;
    setDeletingDir(dirName);
    setError(null);
    try {
      await api.deleteSkill(dirName);
      setSkills((prev) => prev.filter((s) => s.dirName !== dirName));
      setSkillConfig((prev) => {
        const { [skillId]: _, ...rest } = prev;
        return rest;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeletingDir(null);
    }
  }, []);

  const setSkillConfigField = useCallback((skillId: string, fieldKey: string, value: string) => {
    setSkillConfig((prev) => {
      const next = { ...prev[skillId], [fieldKey]: value.trim() || undefined };
      if (Object.keys(next).every((k) => next[k] == null)) {
        const { [skillId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [skillId]: next };
    });
  }, []);

  if (loading) {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={16} className="text-desktop-accent" />
          <h2 className="text-sm font-medium text-desktop-text">Skills</h2>
        </div>
        <p className="text-desktop-muted text-xs">加载中…</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h2 className="text-sm font-medium text-desktop-text flex items-center gap-2">
          <Sparkles size={16} />
          Skills
        </h2>
        <div className="flex items-center gap-2">
          {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
          {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
          {saveMessage === 'fail' && <span className="text-xs text-amber-400/90">同步失败</span>}
        </div>
      </div>

      {/* 搜索添加区域 */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3 mb-4 shrink-0">
        <h4 className="text-xs font-medium text-desktop-text flex items-center gap-1.5">
          <Search size={12} />
          从 SkillHub 搜索
        </h4>
        <p className="text-[11px] text-desktop-muted">在 SkillHub 技能市场中搜索并一键安装</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="搜索关键词，如 crypto、搜索、calendar…"
            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
            value={skillSearchQuery}
            onChange={(e) => setSkillSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setSkillSearching(true);
                api.searchSkills(skillSearchQuery.trim() || 'search', 15).then((r) => {
                  if (r?.ok && r.skills) setSkillSearchResults(r.skills);
                  else setSkillSearchResults([]);
                }).catch(() => setSkillSearchResults([])).finally(() => setSkillSearching(false));
              }
            }}
          />
          <button
            type="button"
            className="px-3 py-2 rounded-lg text-xs bg-desktop-accent/30 hover:bg-desktop-accent/50 text-desktop-text disabled:opacity-50 flex items-center gap-1.5"
            disabled={skillSearching}
            onClick={async () => {
              setSkillSearching(true);
              try {
                const r = await api.searchSkills(skillSearchQuery.trim() || 'search', 15);
                if (r?.ok && r.skills) setSkillSearchResults(r.skills);
                else setSkillSearchResults([]);
              } catch {
                setSkillSearchResults([]);
              } finally {
                setSkillSearching(false);
              }
            }}
          >
            {skillSearching ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
            搜索
          </button>
        </div>
        {skillSearchResults.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-auto">
            {skillSearchResults.map((s) => {
              const already = skills.some((x) => x.dirName === s.slug) || recommended.some((r) => r.slug === s.slug && r.installed);
              return (
                <div key={s.slug} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 border border-white/5 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-desktop-text">{s.slug}</span>
                    <p className="text-[10px] text-desktop-muted line-clamp-1 mt-0.5">{s.description}</p>
                  </div>
                  {already ? (
                    <span className="text-[10px] text-green-400 shrink-0">已安装</span>
                  ) : (
                    <button
                      type="button"
                      className="shrink-0 px-2 py-1 rounded text-[10px] bg-desktop-accent/30 hover:bg-desktop-accent/50 text-desktop-text disabled:opacity-50"
                      disabled={installingSlug !== null}
                      onClick={async () => {
                        setInstallingSlug(s.slug);
                        try {
                          await api.installSkill(`skillhub:${s.slug}`);
                          setSkillSearchResults((prev) => prev.filter((x) => x.slug !== s.slug));
                          load();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : '安装失败');
                        } finally {
                          setInstallingSlug(null);
                        }
                      }}
                    >
                      {installingSlug === s.slug ? '安装中…' : '安装'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 推荐技能 */}
      {recommended.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3 mb-4 shrink-0">
          <h4 className="text-xs font-medium text-desktop-text">推荐 Skill</h4>
          <div className="flex flex-wrap gap-2">
            {recommended.map((r) => (
              <div
                key={r.slug}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/5"
              >
                <div>
                  <span className="text-xs font-medium text-desktop-text">{r.name}</span>
                  <p className="text-[10px] text-desktop-muted line-clamp-1">{r.description}</p>
                </div>
                {r.installed ? (
                  <span className="text-[10px] text-green-400 shrink-0">已安装</span>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 px-2 py-1 rounded text-[10px] bg-desktop-accent/30 hover:bg-desktop-accent/50 text-desktop-text disabled:opacity-50"
                    disabled={installingSlug !== null}
                    onClick={async () => {
                      setInstallingSlug(r.slug);
                      try {
                        await api.installSkill(`skillhub:${r.slug}`);
                        setRecommended((prev) => prev.map((x) => (x.slug === r.slug ? { ...x, installed: true } : x)));
                        load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : '安装失败');
                      } finally {
                        setInstallingSlug(null);
                      }
                    }}
                  >
                    {installingSlug === r.slug ? '安装中…' : '安装'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-desktop-muted text-xs mb-3 shrink-0">
        已安装的 Skills，需要 API Key 的可在此配置，修改后自动保存。
      </p>

      {error && (
        <p className="text-red-400 text-xs mb-3 shrink-0">{error}</p>
      )}

      {skills.length === 0 ? (
        <p className="text-desktop-muted text-xs">未发现已安装的 Skill。请从上方搜索安装。</p>
      ) : (
        <div className="flex-1 overflow-auto space-y-4">
          {skills.map((s) => (
            <div key={s.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-desktop-text font-medium">{s.name}</span>
                  {s.requiresApiKey && (
                    <span className="text-xs text-amber-500/90">需配置 API Key</span>
                  )}
                </div>
                <button
                  type="button"
                  className="px-2 py-1 rounded text-xs text-red-400/90 hover:bg-red-500/10 disabled:opacity-50"
                  disabled={deletingDir === s.dirName}
                  onClick={() => handleDeleteSkill(s.dirName, s.id)}
                  title="删除此 Skill"
                >
                  {deletingDir === s.dirName ? '删除中…' : '删除'}
                </button>
              </div>
              <p className="text-desktop-muted text-xs">{s.description}</p>
              {s.requiresApiKey && (
                <div className="pt-2 space-y-3">
                  {s.configFields && s.configFields.length > 0 ? (
                    s.configFields.map((f) => (
                      <div key={f.key}>
                        <label className="block text-xs text-desktop-muted mb-1">
                          {f.label ?? f.key}
                        </label>
                        <input
                          type="password"
                          className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text placeholder:text-desktop-muted outline-none"
                          placeholder={`${f.key}（修改后自动保存）`}
                          value={skillConfig[s.id]?.[f.key] ?? ''}
                          onChange={(e) => setSkillConfigField(s.id, f.key, e.target.value)}
                        />
                        {f.description && (
                          <p className="text-desktop-muted/80 text-[10px] mt-0.5">{f.description}</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <div>
                      <label className="block text-xs text-desktop-muted mb-1">API Key</label>
                      <input
                        type="password"
                        className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text placeholder:text-desktop-muted outline-none"
                        placeholder="修改后自动保存"
                        value={skillConfig[s.id]?.apiKey ?? ''}
                        onChange={(e) => setSkillConfigField(s.id, 'apiKey', e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-2 flex-wrap">
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15"
              onClick={() => load()}
            >
              <RefreshCw size={12} className="inline mr-1" />
              刷新
            </button>
            {skills.some((s) => s.requiresApiKey && !s.configFields?.length) && (
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
                disabled={extractingLLM}
                onClick={() => {
                  setExtractingLLM(true);
                  load({ extractLLM: true })?.finally(() => setExtractingLLM(false));
                }}
              >
                {extractingLLM ? '提取中…' : '用大模型提取配置字段'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
