import { useCallback, useEffect, useState } from 'react';
import { Package, Power, Trash2 } from 'lucide-react';
import type { XPackageRecord } from '@x-computer/shared';
import { api } from '@/utils/api';
import { setMiniAppsFromApi } from '@/appRegistry';

const KIND_LABELS: Record<string, string> = { ui: '应用', tools: '工具', skill: '技能' };
const SOURCE_LABELS: Record<string, string> = { generated: 'X 制作', installed: '手动安装', space: '来自空间', catalog: '来自目录', builtin: '内置' };

interface Props {
  /** Injected in tests; the app uses the real client. */
  client?: Pick<typeof api, 'listPackages' | 'setPackageEnabled' | 'removePackage' | 'getMiniApps'>;
}

async function refreshDesktopApps(client: NonNullable<Props['client']>): Promise<void> {
  try {
    const { apps } = await client.getMiniApps();
    setMiniAppsFromApi(apps);
  } catch {
    // The desktop refreshes on its own schedule; a failed refresh only delays the icon update.
  }
}

/** The user's installed X packages with enable/disable and remove controls. */
export function InstalledPackagesSection({ client = api }: Props) {
  const [packages, setPackages] = useState<XPackageRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { packages: list } = await client.listPackages();
      setPackages(list);
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '读取包列表失败');
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (record: XPackageRecord) => {
    setBusy(record.manifest.id);
    try {
      await client.setPackageEnabled(record.manifest.id, !record.enabled);
      await load();
      await refreshDesktopApps(client);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '更新失败');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (record: XPackageRecord) => {
    if (!window.confirm(`移除「${record.manifest.name}」的登记？文件与历史版本会保留。`)) return;
    setBusy(record.manifest.id);
    try {
      await client.removePackage(record.manifest.id);
      await load();
      await refreshDesktopApps(client);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '移除失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Package size={15} className="text-sky-300" />
        <h3 className="text-sm font-medium">已安装的包</h3>
        <span className="text-[11px] text-desktop-muted">X 制作的应用、工具扩展与技能</span>
      </div>
      {error && <p role="alert" className="mb-2 text-xs text-rose-300">{error}</p>}
      {packages && packages.length === 0 && <p className="text-xs text-desktop-muted">还没有安装任何包。让助手制作一个应用，或从共享空间、目录安装。</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {(packages ?? []).map((record) => (
          <article key={record.manifest.id} className={`rounded-xl border p-3 ${record.enabled ? 'border-sky-400/25 bg-sky-400/[0.06]' : 'border-white/8 bg-white/[0.025]'}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="truncate text-sm font-medium">{record.manifest.name}</h4>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-desktop-muted">v{record.manifest.version}</span>
                </div>
                <p className="mt-1 text-[11px] text-desktop-muted">
                  {record.manifest.kinds.map((kind) => KIND_LABELS[kind] ?? kind).join(' · ')} · {SOURCE_LABELS[record.source] ?? record.source}
                </p>
                {record.manifest.description && <p className="mt-1 line-clamp-2 text-[11px] text-desktop-muted">{record.manifest.description}</p>}
              </div>
              <button type="button" role="switch" aria-checked={record.enabled} disabled={busy === record.manifest.id}
                onClick={() => void toggle(record)} title={record.enabled ? '停用' : '启用'}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${record.enabled ? 'bg-sky-500' : 'bg-white/10'}`}>
                <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${record.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3 text-[10px] text-desktop-muted">
              {record.manifest.permissions.length === 0
                ? <span className="rounded-full bg-emerald-400/8 px-2 py-1 text-emerald-300">无额外权限</span>
                : record.manifest.permissions.map((permission) => <span key={permission} className="rounded-full bg-white/5 px-2 py-1">{permission}</span>)}
              <span className="ml-auto flex items-center gap-1"><Power size={11} />{record.enabled ? '已启用' : '已停用'}</span>
              <button type="button" onClick={() => void remove(record)} disabled={busy === record.manifest.id} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white/10" title="移除登记">
                <Trash2 size={11} />移除
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
