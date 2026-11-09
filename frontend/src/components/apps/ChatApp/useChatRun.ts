import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ChatRunSnapshot, type ChatRunStarted } from '@/utils/api';
import { setMiniAppsFromApi } from '@/appRegistry';
import { getUserIdOrNull } from '@/utils/userId';

export function isChatRunActive(run: Pick<ChatRunSnapshot, 'status'> | null): boolean {
  return run?.status === 'running' || run?.status === 'stopping';
}

/** Follow server-owned work independently of the streaming connection. */
export function useChatRun(sessionId: string | null, onSettled: (run: ChatRunSnapshot) => void) {
  const [run, setRun] = useState<ChatRunSnapshot | null>(null);
  const [runs, setRuns] = useState<ChatRunSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [actionEpoch,setActionEpoch]=useState(0);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  const notifiedRef = useRef('');
  const runRef = useRef(run);
  const generationRef = useRef(0);
  const appsSyncedRef = useRef('');

  const commit = useCallback((next: ChatRunSnapshot, allowResume = false) => {
    if (next.sessionId !== sessionRef.current) return;
    const current = runRef.current;
    if (current?.id === next.id && (next.updatedAt < current.updatedAt ||
      (next.updatedAt===current.updatedAt&&(next.conversationUpdatedAt??next.updatedAt)<(current.conversationUpdatedAt??current.updatedAt)) ||
      (!allowResume && next.updatedAt === current.updatedAt && !isChatRunActive(current) && isChatRunActive(next)))) return;
    if (current?.id !== next.id) generationRef.current += 1;
    runRef.current = next;
    setRun(next);
    setRuns((previous) => [next, ...previous.filter((item) => item.id !== next.id)]);
    setError(null);
    const created=next.toolCalls.filter(tool=>tool.toolName==='x.create_app'&&tool.status==='completed').map(tool=>tool.id);
    const appKey=`${next.id}:${created.join(',')}`;
    if(created.length&&appsSyncedRef.current!==appKey){
      appsSyncedRef.current=appKey;const owner=getUserIdOrNull();
      void api.getMiniApps().then(result=>{if(appsSyncedRef.current===appKey&&getUserIdOrNull()===owner)setMiniAppsFromApi(result.apps);}).catch(()=>{
        if(appsSyncedRef.current===appKey&&getUserIdOrNull()===owner){appsSyncedRef.current='';setError('应用已保存，桌面刷新暂未完成。请点击刷新进度再试。');}
      });
    }
    const key = `${next.id}:${next.status}:${next.updatedAt}:${next.conversationUpdatedAt??next.updatedAt}`;
    if (!isChatRunActive(next) && key !== notifiedRef.current) {
      notifiedRef.current = key;
      settledRef.current(next);
    }
  }, []);
  const accept = useCallback((next: ChatRunSnapshot) => {
    if (runRef.current && runRef.current.id !== next.id) return;
    commit(next);
  }, [commit]);
  const follow = useCallback((next: ChatRunSnapshot) => {
    if (next.sessionId !== sessionRef.current || (!isChatRunActive(next) && runRef.current?.id !== next.id)) return;
    generationRef.current++;
    setActionEpoch(value=>value+1);
    commit(next, true);
  }, [commit]);

  useEffect(() => {
    let cancelled = false;
    const generation = ++generationRef.current;
    if (runRef.current?.sessionId !== sessionId) runRef.current = null;
    setRun((previous) => previous?.sessionId === sessionId ? previous : null);
    setRuns([]);
    setError(null);
    if (!sessionId) { setRestoring(false); return; }
    setRestoring(true);
    api.listChatRuns(sessionId).then(({ runs: next }) => {
      if (cancelled || generation !== generationRef.current) return;
      setRuns(next);
      const latest = next[0];
      if (latest) commit(latest);
    }).catch((reason: Error) => {
      if (!cancelled && generation === generationRef.current) setError(`任务状态读取失败：${reason.message}`);
    }).finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; generationRef.current += 1; };
  }, [sessionId, commit]);

  const active = isChatRunActive(run);
  // Revisions can arrive after the first delivery while the original conversation stays open.
  const waitingForExperts=!!run?.expertRuns?.length||!!run?.followup;
  const waitingForApproval = run?.userQuestion?.status === 'pending' || [run?.shellApproval, run?.sendApproval].some(approval => approval && ['pending', 'approved', 'executing'].includes(approval.status));
  const runId = run?.id;
  useEffect(() => {
    if ((!active&&!waitingForExperts&&!waitingForApproval) || !runId || !sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const generation = generationRef.current;
      try {
        let next = await api.getChatRun(runId);
        if(next.followupRunId)next=await api.getChatRun(next.followupRunId);
        if (cancelled || generation !== generationRef.current || runRef.current?.id !== runId) return;
        if(next.id===runId)accept(next);else commit(next);
        if (!isChatRunActive(next)&&!next.expertRuns?.length&&!next.followup&&next.userQuestion?.status !== 'pending'&&![next.shellApproval, next.sendApproval].some(approval => approval && ['pending','approved','executing'].includes(approval.status))) return;
      } catch (reason) {
        if (cancelled || generation !== generationRef.current) return;
        setError(`连接暂时中断，正在重新获取任务状态：${reason instanceof Error ? reason.message : String(reason)}`);
      }
      if (!cancelled) timer = setTimeout(poll, active?2000:5000);
    };
    timer = setTimeout(poll, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [runId, active, waitingForExperts, waitingForApproval, sessionId, accept, commit,actionEpoch]);

  const track = useCallback((started: ChatRunStarted) => {
    commit({ ...started, id: started.runId, sessionId: started.sessionId, status: started.status, content: started.content ?? '', artifacts: started.artifacts ?? [], toolCalls: started.toolCalls ?? [], updatedAt: started.updatedAt ?? 0, canResume: started.canResume ?? false });
  }, [commit]);

  const act = useCallback(async (action: 'stop' | 'resume') => {
    const current = runRef.current;
    if (!current) return;
    const generation = generationRef.current;
    try {
      const next = await (action === 'stop' ? api.stopChatRun(current.id) : api.resumeChatRun(current.id));
      if (generation === generationRef.current && current.id === runRef.current?.id){generationRef.current++;setActionEpoch(value=>value+1);commit(next, action === 'resume');}
    } catch (reason) {
      if (current.sessionId === sessionRef.current && generation === generationRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [commit]);

  const refresh = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;
    const generation = generationRef.current;
    try {
      const { runs: next } = await api.listChatRuns(currentSession);
      if (currentSession !== sessionRef.current || generation !== generationRef.current) return;
      setRuns(next);
      if (next[0]) commit(next[0]);
    } catch (reason) {
      if (currentSession === sessionRef.current && generation === generationRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [commit]);

  const visibleRun = run?.sessionId === sessionId ? run : null;
  return { run: visibleRun, runs: runs.filter((item) => item.sessionId === sessionId), error, restoring, isRunning: isChatRunActive(visibleRun), track, accept, follow, refresh, stop: () => act('stop'), resume: () => act('resume') };
}
