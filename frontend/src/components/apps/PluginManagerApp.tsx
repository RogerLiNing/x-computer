import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Box,
  Check,
  Cpu,
  Database,
  HardDrive,
  Layers3,
  MemoryStick,
  Plug,
  Power,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  BUILTIN_MANIFESTS,
  getBundledPlugins,
  isAppEnabled,
  setPluginEnabled,
} from '@/appRegistry';
import { useAppRegistryRevision } from '@/hooks/useAppRegistry';
import { useDesktopStore } from '@/store/desktopStore';

interface RuntimePlugin {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  startupPolicy: string;
}

interface RuntimeStatus {
  backgroundAutostart?:boolean;
  profile: string;
  plugins: RuntimePlugin[];
}

function permissionLabel(permission: string): string {
  const labels: Record<string, string> = {
    'filesystem.read': '读取文件',
    'filesystem.write': '写入文件',
    shell: '执行命令',
    network: '访问网络',
    'browser.control': '控制浏览器',
    llm: '调用 AI',
    'tools.execute': '执行工具',
    scheduler: '后台调度',
    'email.read': '读取邮件',
    'email.send': '发送邮件',
    'account.manage': '管理账户',
  };
  return labels[permission] ?? permission;
}

export function PluginManagerApp() {
  const revision = useAppRegistryRevision();
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);

  const togglePlugin = (pluginId: string, enabled: boolean) => {
    setPluginEnabled(pluginId, !enabled);
    if (!enabled) return;

    const { windows, closeWindow } = useDesktopStore.getState();
    windows
      .filter((window) => window.appId === pluginId)
      .forEach((window) => closeWindow(window.id));
  };

  const coreApps = useMemo(
    () => BUILTIN_MANIFESTS.filter((manifest) => manifest.runtime === 'core'),
    [],
  );
  const plugins = useMemo(() => getBundledPlugins(), [revision]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/runtime/plugins')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: RuntimeStatus | null) => {
        if (!cancelled && data) setRuntime(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full overflow-auto bg-desktop-window text-desktop-text">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-desktop-window/95 px-5 py-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-300">
            <Plug size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold">插件中心</h2>
            <p className="text-xs text-desktop-muted">
              核心保持极简，其他能力打开时才加载；停用插件不会删除数据。
            </p>
          </div>
          <div className="ml-auto rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-300">
            {runtime ? `后端：${runtime.profile}` : '前端按需加载'}
          </div>
        </div>
      </div>

      <div className="space-y-6 p-5">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Layers3 size={15} className="text-amber-300" />
            <h3 className="text-sm font-medium">核心系统</h3>
            <span className="text-[11px] text-desktop-muted">始终可用</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {coreApps.map((app) => (
              <div key={app.id} className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-amber-400/10 p-2 text-amber-300">
                    <ShieldCheck size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{app.name}</span>
                      <Check size={13} className="text-emerald-400" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-desktop-muted">
                      {app.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={15} className="text-fuchsia-300" />
            <h3 className="text-sm font-medium">可拔插应用</h3>
            <span className="text-[11px] text-desktop-muted">按需启用</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {plugins.map((plugin) => {
              const enabled = isAppEnabled(plugin.id);
              return (
                <article
                  key={plugin.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    enabled
                      ? 'border-fuchsia-400/25 bg-fuchsia-400/[0.06]'
                      : 'border-white/8 bg-white/[0.025]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`rounded-lg p-2 ${enabled ? 'bg-fuchsia-400/15 text-fuchsia-300' : 'bg-white/5 text-desktop-muted'}`}>
                      <Box size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-medium">{plugin.name}</h4>
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase text-desktop-muted">
                          {plugin.startupPolicy}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-desktop-muted">
                        {plugin.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() => togglePlugin(plugin.id, enabled)}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                        enabled ? 'bg-fuchsia-500' : 'bg-white/10'
                      }`}
                      title={enabled ? '停用插件' : '启用插件'}
                    >
                      <span
                        className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                          enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(plugin.permissions ?? []).map((permission) => (
                      <span key={permission} className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-desktop-muted">
                        {permissionLabel(permission)}
                      </span>
                    ))}
                    {(plugin.permissions?.length ?? 0) === 0 && (
                      <span className="rounded-full bg-emerald-400/8 px-2 py-1 text-[10px] text-emerald-300">
                        无额外权限
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-3 border-t border-white/5 pt-3 text-[10px] text-desktop-muted">
                    <span className="flex items-center gap-1"><MemoryStick size={11} /> {plugin.resourceBudget?.memoryMb ?? '—'} MB</span>
                    <span className="flex items-center gap-1"><Cpu size={11} /> {plugin.resourceBudget?.cpuPercent ?? '—'}%</span>
                    <span className="flex items-center gap-1"><Activity size={11} /> {plugin.resourceBudget?.backgroundTasks ?? 0}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <Power size={11} />
                      {enabled ? '已启用' : '已停用'}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {runtime && (
          <section className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Database size={15} className="text-cyan-300" />
              <h3 className="text-sm font-medium">后端运行模块</h3>
              <span className="ml-auto text-[11px] text-desktop-muted">{runtime.profile}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {runtime.backgroundAutostart===false&&<p role="status" className="col-span-full text-sm text-amber-200">后台自动启动已暂停。当前手动交办仍可使用，已保存的计划会保留。</p>}
              {runtime.plugins.map((plugin) => (
                <div key={plugin.id} className="flex items-center gap-2 rounded-lg bg-black/10 px-3 py-2">
                  <HardDrive size={13} className={plugin.enabled ? 'text-emerald-400' : 'text-desktop-muted'} />
                  <span className="min-w-0 flex-1 truncate text-xs">{plugin.name}</span>
                  <span className={`text-[10px] ${plugin.enabled ? 'text-emerald-400' : 'text-desktop-muted'}`}>
                    {plugin.enabled ? '已启用' : '停用'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
