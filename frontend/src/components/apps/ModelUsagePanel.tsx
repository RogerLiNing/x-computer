import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { api, type UsageTotals } from '@/utils/api';

type Summary = Awaited<ReturnType<typeof api.getModelUsage>>;

const RANGES = [7, 30, 90] as const;

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatCost(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(4)}`;
}

function Totals({ totals }: { totals: UsageTotals }) {
  const cells: Array<[string, string]> = [
    ['调用次数', String(totals.calls)],
    ['输入 token', formatTokens(totals.promptTokens)],
    ['输出 token', formatTokens(totals.completionTokens)],
    ['估算费用', formatCost(totals.costUsd)],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-black/10 px-3 py-2">
          <div className="text-[10px] text-desktop-muted">{label}</div>
          <div className="text-sm font-medium">{value}</div>
        </div>
      ))}
    </div>
  );
}

/** Per-user model usage read from /api/usage/models. Costs are catalog estimates and show "—" when unknown. */
export function ModelUsagePanel() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getModelUsage(days)
      .then((data) => { if (!cancelled) { setSummary(data); setError(null); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取用量失败'); });
    return () => { cancelled = true; };
  }, [days]);

  return (
    <section className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 size={15} className="text-blue-300" />
        <h3 className="text-sm font-medium">模型用量</h3>
        <div className="ml-auto flex gap-1">
          {RANGES.map((range) => (
            <button key={range} type="button" onClick={() => setDays(range)}
              className={`rounded px-2 py-0.5 text-[11px] ${days === range ? 'bg-blue-500/30 text-blue-100' : 'bg-white/5 text-desktop-muted hover:bg-white/10'}`}>
              {range} 天
            </button>
          ))}
        </div>
      </div>
      {error && <p role="alert" className="mb-2 text-xs text-rose-300">{error}</p>}
      {summary && (
        <>
          <Totals totals={summary.totals} />
          {summary.byModel.length > 0 && (
            <table className="mt-3 w-full text-left text-[11px]">
              <thead className="text-desktop-muted">
                <tr><th className="py-1 font-normal">模型</th><th className="py-1 font-normal">次数</th><th className="py-1 font-normal">输入</th><th className="py-1 font-normal">输出</th><th className="py-1 font-normal">费用</th></tr>
              </thead>
              <tbody>
                {summary.byModel.map((row) => (
                  <tr key={`${row.providerId}/${row.modelId}`} className="border-t border-white/5">
                    <td className="py-1 pr-2">{row.providerId} / {row.modelId}</td>
                    <td className="py-1">{row.calls}</td>
                    <td className="py-1">{formatTokens(row.promptTokens)}</td>
                    <td className="py-1">{formatTokens(row.completionTokens)}</td>
                    <td className="py-1">{formatCost(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {summary.totals.calls === 0 && <p className="mt-2 text-xs text-desktop-muted">这段时间还没有模型调用记录。</p>}
          <p className="mt-2 text-[10px] text-desktop-muted">费用按模型目录中的公开价格估算；目录没有价格的模型显示为 —。</p>
        </>
      )}
    </section>
  );
}
