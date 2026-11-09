import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/utils/api';
import { useDesktopStore } from '@/store/desktopStore';

type Run = Awaited<ReturnType<typeof api.scheduledRunsList>>['runs'][number];
const STATUS: Record<string, string> = { queued: '等着开始', attached: '已交给助手', completed: '做好了，去看看',
  needs_attention: '需要你处理', cancelled: '已请求停止', reminded: '提醒已送达' };
const REPLY_STATUS = {not_sent:'回复还没发出',sending:'正在发送回复',sent:'回复已提交',unknown:'回复是否送达还不确定'};

export function ScheduledRuns({ focusRunId }: { focusRunId?: string }) {
  const target = useRef<HTMLElement>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState<string>();
  const refresh = useCallback(async () => {
    try { setRuns((await api.scheduledRunsList(focusRunId)).runs); setError(''); }
    catch { setError('暂时无法读取执行记录，请稍后重试。'); }
  }, [focusRunId]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 15000);const changed=()=>{void refresh();};window.addEventListener('x:workbench-refresh',changed);return () => {clearInterval(timer);window.removeEventListener('x:workbench-refresh',changed);}; }, [refresh]);
  const hasTarget = runs.some(run => run.id === focusRunId);
  useEffect(() => { if (hasTarget) target.current?.scrollIntoView({ block: 'nearest' }); }, [focusRunId, hasTarget]);
  const stop = async (id: string) => {
    setStopping(id);
    try { await api.scheduledRunStop(id); await refresh(); }
    catch { setError('尚未确认停止，请稍后重试或打开原对话查看。'); }
    finally { setStopping(undefined); }
  };
  return <section aria-label="后台执行记录" className="mt-4 space-y-2">
    <div className="flex items-center justify-between"><h4 className="text-sm">后台执行记录</h4><button type="button" onClick={() => { void refresh(); }} className="rounded-lg px-3 py-2 text-sm">刷新记录</button></div>
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {!error && runs.length === 0 && <p className="text-sm text-desktop-muted">交办开始后，你可以在这里查看进度和结果。</p>}
    {runs.map(run => <article key={run.id} ref={run.id === focusRunId ? target : undefined} className={`rounded-xl border p-3 ${run.id === focusRunId ? 'border-amber-400/70' : 'border-white/10'}`}>
      <p className="text-sm break-words">{run.name}</p>
      <p className="text-xs text-desktop-muted">{run.replyStatus&&run.status!=='cancelled'?REPLY_STATUS[run.replyStatus]:STATUS[run.status] || '等待确认'} · {new Date(run.scheduled_at).toLocaleString()}</p>
      {run.replyStatus==='unknown'&&<p role="note" className="mt-1 text-sm text-amber-200">还不知道对方有没有收到。先到原来的聊天里看看，暂时别再发一次。</p>}
      {run.replyStatus==='sending'&&<p className="mt-1 text-sm text-desktop-muted">停止不能撤回已经发出的消息。</p>}
      {run.error && <p className="mt-1 text-sm text-amber-200">{run.error}</p>}
      <div className="mt-2 flex gap-2 flex-wrap">
        {run.execution_session_id && <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-sm" onClick={() => useDesktopStore.getState().openApp('chat', { sessionId: run.execution_session_id })}>打开原对话</button>}
        {run.replyStatus!=='unknown'&&['queued', 'attached', 'needs_attention'].includes(run.status) && <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-sm" disabled={!!stopping} onClick={() => { void stop(run.id); }}>{stopping === run.id ? '正在请求停止…' : '停止这次执行'}</button>}
      </div>
    </article>)}
  </section>;
}
