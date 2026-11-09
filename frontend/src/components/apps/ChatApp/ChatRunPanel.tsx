import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/utils/api';
import { AssistantWorkbench } from './AssistantWorkbench';
import { useDesktopStore } from '@/store/desktopStore';
import { getApp, setMiniAppsFromApi } from '@/appRegistry';
import { Loader2, Play, Square, FileCheck, X, PanelRight } from 'lucide-react';
import type { ChatRunArtifact, ChatRunSnapshot } from '@/utils/api';

const LABELS: Record<ChatRunSnapshot['status'], string> = {
  running: '我正在帮你做，做好后会告诉你',
  stopping: '正在停下来，请稍等',
  completed: '做好啦，请你看看',
  paused: '已经停下了，想做时可以继续',
  interrupted: '刚才中断了，可以继续',
  failed: '这次没做好，请看看下面的原因',
  blocked: '需要先处理一个问题',
};
const runLabel=(run:ChatRunSnapshot)=>run.status==='running'&&run.waitingForModel?'正在等模型空闲，轮到后会继续。':run.status==='paused'&&run.canResume===false?'已停下，请先处理下面的问题':LABELS[run.status];

export function ChatRunPanel({ run, error, onStop, onResume, onOpen, onRefresh, onRunChanged, sessionId }: {
  run: ChatRunSnapshot | null;
  error: string | null;
  onStop: () => void;
  onResume: () => void;
  onOpen: (artifact: ChatRunArtifact) => void;
  onRefresh?: () => Promise<void>;
  onRunChanged?: (next: ChatRunSnapshot) => void;
  sessionId?: string | null;
}) {
  const dialogRef=useRef<HTMLDialogElement>(null),openerRef=useRef<HTMLButtonElement>(null),closeRef=useRef<HTMLButtonElement>(null);
  const dialogId=useId();
  const [panelOpen,setPanelOpen]=useState(false),[attentionCount,setAttentionCount]=useState(0);
  const closePanel=()=>{dialogRef.current?.close();setPanelOpen(false);openerRef.current?.focus({preventScroll:true});};
  const openFile=(artifact:ChatRunArtifact)=>{closePanel();onOpen(artifact);};
  const [selected,setSelected]=useState<ChatRunSnapshot|null>(null);
  const [feedback,setFeedback]=useState('');
  const [delegationId,setDelegationId]=useState('');
  const [delegations,setDelegations]=useState<Array<{id:string;title:string}>>([]);
  const [failure,setFailure]=useState('');
  const [busy,setBusy]=useState(false);
  const [editingReview,setEditingReview]=useState(false);
  const [questionAnswer, setQuestionAnswer] = useState('');
  const view = JSON.stringify([sessionId ?? run?.sessionId ?? null, run?.id ?? null]);
  const viewRef = useRef(view), intentRef = useRef(0);
  if (viewRef.current !== view) { viewRef.current = view; intentRef.current++; }
  const beginAction = () => { const version=++intentRef.current;setBusy(true);setFailure('');return()=>version===intentRef.current; };
  const clearSelection = () => { intentRef.current++;setSelected(null);setBusy(false);setFailure(''); };
  const refresh=async()=>{window.dispatchEvent(new Event('x:workbench-refresh'));await onRefresh?.();};
  useEffect(()=>{setSelected(null);setFeedback('');setDelegationId('');setBusy(false);setFailure('');dialogRef.current?.close();setPanelOpen(false);},[view]);
  useEffect(()=>()=>{intentRef.current++;},[]);
  const reviewTarget=selected ?? run;
  useEffect(()=>{if(run&&selected?.id===run.id&&run.updatedAt>selected.updatedAt)setSelected(run);},[run,selected?.id,selected?.updatedAt]);
  const createdApps=(reviewTarget?.toolCalls??[]).flatMap(tool=>{
    const output=tool.output as {appId?:unknown}|undefined;
    return tool.toolName==='x.create_app'&&tool.status==='completed'&&typeof output?.appId==='string'&&/^[\w-]{1,128}$/.test(output.appId)
      ? [{id:output.appId,name:String(tool.input?.name??output.appId)}]:[];
  });
  const openCreatedApp=async(id:string)=>{
    const owns=beginAction();
    try{
      const {apps}=await api.getMiniApps();if(!owns())return;setMiniAppsFromApi(apps);
      if(!apps.some(app=>app.id===id)||getApp(id)?.source!=='miniapp')throw new Error('应用暂时无法打开，请让助手检查应用编号或文件。');
      closePanel();useDesktopStore.getState().openApp(id);
    }catch(error){if(owns())setFailure(error instanceof Error?error.message:String(error));}finally{if(owns())setBusy(false);}
  };
  const currentReview=selected?.id===run?.id ? selected?.review : run?.review;
  useEffect(()=>setEditingReview(false),[reviewTarget?.id]);
  const review=async(decision:'accepted'|'changes_requested')=>{
    if(!reviewTarget||busy)return;const owns=beginAction();
    try{const saved=await api.reviewChatRun(reviewTarget.id,{decision,feedback,delegationId:delegationId||undefined,expectedUpdatedAt:reviewTarget.updatedAt});if(!owns())return;setSelected(saved);onRunChanged?.(saved);await refresh();}
    catch(e){if(!owns())return;setFailure(e instanceof Error?e.message:String(e));try{const saved=await api.getChatRun(reviewTarget.id);if(owns()){setSelected(saved);onRunChanged?.(saved);}}catch{/* Preserve the failed action message until a later refresh. */}}finally{if(owns())setBusy(false);}
  };
  const revise=async()=>{if(!reviewTarget||busy)return;const owns=beginAction();try{const next=await api.reviseChatRun(reviewTarget.id);if(!owns())return;setSelected(next);setFeedback('');setDelegationId('');onRunChanged?.(next);await refresh();}catch(e){if(owns())setFailure(e instanceof Error?e.message:String(e));}finally{if(owns())setBusy(false);}};
  const inspect=async(id:string)=>{const owns=beginAction();try{const next=await api.getChatRun(id);if(!owns())return;setSelected(next);setFeedback('');setDelegationId('');}catch(e){if(owns())setFailure(e instanceof Error?e.message:String(e));}finally{if(owns())setBusy(false);}};
  useEffect(() => { setQuestionAnswer(''); }, [reviewTarget?.userQuestion?.id]);
  const answerQuestion = async (answer: string) => {
    const question = reviewTarget?.userQuestion;
    if (!reviewTarget || !question || busy || !answer.trim()) return;
    const owns = beginAction();
    try {
      const next = await api.answerChatQuestion(reviewTarget.id, {
        questionId: question.id, answer: answer.trim(), expectedUpdatedAt: reviewTarget.updatedAt,
      });
      if (!owns()) return;
      setSelected(next);
      onRunChanged?.(next);
      setQuestionAnswer('');
      window.dispatchEvent(new Event('x:notifications-refresh'));
      await refresh();
    } catch (error) {
      if (owns()) setFailure(error instanceof Error ? error.message : String(error));
    } finally { if (owns()) setBusy(false); }
  };
  const pauseQuestion = async () => {
    if (!reviewTarget || busy) return;
    const owns = beginAction();
    try {
      const next = await api.stopChatRun(reviewTarget.id);
      if (owns()) { setSelected(next); onRunChanged?.(next); await refresh(); }
    } catch (error) { if (owns()) setFailure(error instanceof Error ? error.message : String(error)); }
    finally { if (owns()) setBusy(false); }
  };
  const decideApproval = async (kind: 'shellApproval' | 'sendApproval', decision: 'approve' | 'reject') => {
    const proposal = reviewTarget?.[kind];
    if (!reviewTarget || !proposal || busy) return;
    const owns = beginAction();
    try {
      const submit = kind === 'shellApproval' ? api.decideShellCommand : api.decideChannelSend;
      const next = await submit(reviewTarget.id, {
        approvalId: proposal.id, hash: proposal.hash, decision, expectedUpdatedAt: reviewTarget.updatedAt,
      });
      if (!owns()) return;
      setSelected(next); onRunChanged?.(next); await refresh();
    } catch (error) {
      if (!owns()) return;
      setFailure(error instanceof Error ? error.message : String(error));
      try {
        const next = await api.getChatRun(reviewTarget.id);
        if (owns()) { setSelected(next); onRunChanged?.(next); }
      } catch { /* Keep the decision error visible. */ }
    } finally { if (owns()) setBusy(false); }
  };
  const actSelected=async(action:'stop'|'resume')=>{if(!selected||busy)return;const owns=beginAction();try{const next=await(action==='stop'?api.stopChatRun(selected.id):api.resumeChatRun(selected.id));if(!owns())return;setSelected(next);onRunChanged?.(next);}catch(e){if(owns())setFailure(String(e));}finally{if(owns())setBusy(false);}};
  useEffect(()=>{
    if(busy||!selected||!['running','stopping'].includes(selected.status)&&selected.userQuestion?.status !== 'pending'&&![selected.shellApproval, selected.sendApproval].some(approval => approval && ['pending','approved','executing'].includes(approval.status)))return;
    const version=intentRef.current;let live=true;const timer=setInterval(()=>{void api.getChatRun(selected.id).then(next=>{if(live&&version===intentRef.current)setSelected(previous=>previous?.id===next.id&&previous.updatedAt>next.updatedAt?previous:next);}).catch(e=>{if(live&&version===intentRef.current)setFailure(String(e));});},2000);
    return()=>{live=false;clearInterval(timer);};
  },[selected?.id,selected?.status,selected?.shellApproval?.status,selected?.sendApproval?.status,selected?.userQuestion?.status,busy]);
  const send = reviewTarget?.sendApproval;
  const channels: Record<string, string> = { 'x.send_email': '邮件', 'x.send_telegram': 'Telegram',
    'x.send_qq': 'QQ', 'x.send_whatsapp': 'WhatsApp', 'x.send_discord': 'Discord', 'x.send_slack': 'Slack' };
  const active = run?.status === 'running' || run?.status === 'stopping';
  const needsDecision=run?.userQuestion?.status==='pending'||run?.shellApproval?.status==='pending'||run?.sendApproval?.status==='pending';
  const needsAttention=needsDecision||run?.review?.status==='pending'||run?.review?.delegationPending||!!error||!!run&&['paused','interrupted','failed','blocked'].includes(run.status);
  const pendingCount=Math.max(attentionCount,needsAttention?1:0);
  return <>
    <span className="inline-flex shrink-0 items-center gap-1">
      <button ref={openerRef} type="button" aria-label="进度与成果" aria-haspopup="dialog" aria-controls={dialogId} aria-expanded={panelOpen}
        onClick={()=>{dialogRef.current?.showModal();setPanelOpen(true);closeRef.current?.focus({preventScroll:true});}}
        className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 py-2 text-sm ${pendingCount?'text-amber-200 bg-amber-500/10':'text-desktop-muted hover:bg-white/5'}`}>
        {active?<Loader2 size={15} className="animate-spin"/>:<PanelRight size={15}/>}
        <span className="sm:hidden">进度</span><span className="hidden sm:inline">{needsDecision?'需要你决定':active?run?.status==='stopping'?'正在停下':'正在做':'进度与成果'}</span>
        {!!pendingCount&&<span aria-live="polite" aria-label={`${pendingCount} 件待处理`} className="rounded-full bg-amber-500/15 px-1.5 text-xs">{pendingCount}</span>}
      </button>
      {run?.status==='running'&&<button type="button" onClick={onStop} aria-label="停止当前任务" title="先停一下" className="min-h-10 min-w-10 rounded-lg p-2 text-red-400 hover:bg-white/5"><Square size={15}/></button>}
    </span>
    <dialog ref={dialogRef} id={dialogId} aria-label="进度与成果" aria-modal="true"
      onCancel={event=>{event.preventDefault();closePanel();}} onClose={()=>setPanelOpen(false)}
      onClick={event=>{if(event.target===event.currentTarget)closePanel();}}
      onKeyDown={event=>{
        if(event.key!=='Tab'||event.defaultPrevented)return;
        const fields=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]')).filter(field=>{
          if(!field.getClientRects().length)return false;
          for(let parent=field.parentElement;parent&&parent!==event.currentTarget;parent=parent.parentElement){
            if(parent.matches('details:not([open])')&&parent.querySelector(':scope > summary')!==field)return false;
          }
          return true;
        });
        const first=fields[0],last=fields.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-md border-l border-white/15 bg-desktop-window p-0 text-desktop-text shadow-2xl backdrop:bg-black/30">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="font-semibold">进度与成果</h2><button ref={closeRef} type="button" onClick={closePanel} aria-label="关闭进度与成果" className="min-h-11 min-w-11 rounded-lg p-2 hover:bg-white/10"><X size={20}/></button>
        </header>
        <div aria-label="进度和待处理事项" className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-base leading-7">
      {failure && <p role="alert" className="text-amber-300">{failure}</p>}
      {reviewTarget?.userQuestion?.status === 'pending' && <section aria-label="补充信息" className="my-2 space-y-3 rounded-xl border border-amber-400/40 bg-black/20 p-3">
        <strong className="block break-words">{reviewTarget.userQuestion.question}</strong>
        {!!reviewTarget.userQuestion.options.length && <div className="flex flex-wrap gap-2">
          {reviewTarget.userQuestion.options.map(option => <button key={option} type="button" disabled={busy}
            onClick={() => void answerQuestion(option)} className="min-h-11 max-w-full rounded-lg border border-white/25 px-3 py-2 text-left break-words disabled:opacity-50">{option}</button>)}
        </div>}
        <label className="block text-sm">也可以自己写
          <textarea aria-label="补充你的想法" value={questionAnswer} maxLength={4000} disabled={busy}
            onChange={event => setQuestionAnswer(event.target.value)}
            className="mt-1 block min-h-20 w-full rounded-lg border border-white/20 bg-black/20 p-3 text-base" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !questionAnswer.trim()} onClick={() => void answerQuestion(questionAnswer)}
            className="min-h-11 rounded-lg bg-amber-400 px-4 py-2 text-black disabled:opacity-50">{busy ? '正在保存…' : '补充好了，继续做'}</button>
          <button type="button" disabled={busy} onClick={() => void pauseQuestion()} className="min-h-11 rounded-lg border border-white/25 px-4 py-2">先停在这里</button>
        </div>
      </section>}
      {reviewTarget?.userQuestion?.status === 'answered' && <details className="py-1 text-sm">
        <summary className="cursor-pointer">已补充的信息</summary>
        <p className="break-words">{reviewTarget.userQuestion.question}</p>
        <p className="whitespace-pre-wrap break-words">{reviewTarget.userQuestion.answer}</p>
      </details>}
      {reviewTarget?.shellApproval?.status==='pending'&&<section aria-label="运行命令前确认" className="my-3 space-y-3 rounded-xl border border-amber-400/40 bg-black/20 p-3">
        <strong>这条命令还没有运行，需要你决定。</strong>
        <p>它可能读取、修改、删除文件或访问网络。只允许这一次；不清楚就先不执行。</p>
        <p>{reviewTarget.shellApproval.executionMode==='container'?'运行环境：该用户的隔离电脑。':'运行环境：未隔离的本地开发环境，可能访问这台机器权限允许的文件和网络。'}</p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-3 text-sm">{reviewTarget.shellApproval.command}</pre>
        <p className="break-all">工作目录：{reviewTarget.shellApproval.workdir}；最长运行：{reviewTarget.shellApproval.timeout/1000} 秒</p>
        <p>确认有效至：{new Date(reviewTarget.shellApproval.expiresAt).toLocaleString()}</p>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||reviewTarget.shellApproval.expiresAt<=Date.now()} onClick={()=>void decideApproval('shellApproval', 'approve')} className="rounded-lg bg-amber-400 px-4 py-3 text-black disabled:opacity-50">允许这一次</button><button type="button" disabled={busy} onClick={()=>void decideApproval('shellApproval', 'reject')} className="rounded-lg border border-white/30 px-4 py-3">不执行这条命令</button></div>
      </section>}
      {send?.status === 'pending' && <section aria-label="发送前确认" className="my-3 space-y-3 rounded-xl border border-amber-400/40 bg-black/20 p-3">
        <strong>这条消息还没发出去。请先看收件人和正文。</strong>
        <p className="break-all">发送渠道：{channels[send.toolName] || send.toolName}</p>
        {send.sender && <p className="break-all">发送账号：<bdi>{send.sender.label}</bdi>（<bdi dir="ltr">{send.sender.accountId}</bdi>）</p>}
        <p className="break-all">发给：{send.input.to || send.input.chatId || send.input.channelId || send.input.targetId}
          {send.input.targetType && `（${({ private: '私聊', group: '群聊', guild: '频道' } as Record<string, string>)[send.input.targetType] || send.input.targetType}）`}</p>
        {send.input.threadTs && <p className="break-all">线程：{send.input.threadTs}</p>}
        {send.input.subject && <p className="break-words">主题：{send.input.subject}</p>}
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-3 text-sm">{send.input.message || send.input.body}</pre>
        <p>确认有效至：{new Date(send.expiresAt).toLocaleString()}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || send.expiresAt <= Date.now()} onClick={() => void decideApproval('sendApproval', 'approve')} className="rounded-lg bg-amber-400 px-4 py-3 text-black disabled:opacity-50">确认发送这一次</button>
          <button type="button" disabled={busy} onClick={() => void decideApproval('sendApproval', 'reject')} className="rounded-lg border border-white/30 px-4 py-3">不发送</button>
        </div>
      </section>}
      <AssistantWorkbench onSelect={(id)=>void inspect(id)} onOpen={openFile} onAttentionChange={setAttentionCount} onNavigate={closePanel} />
      {reviewTarget?.followup&&<p className="py-2">助手正在接着核对专家交回的成果。<button type="button" disabled={busy} onClick={()=>void inspect(reviewTarget.followup!.sourceRunId)} className="rounded-lg border border-white/15 px-3 py-2">看看专家原稿</button></p>}
      {!!reviewTarget?.inputFiles?.length&&<section aria-label="已收到的材料" className="space-y-2 py-2"><p>当时收到的材料副本，原文件会保留：</p><div className="flex flex-wrap gap-2">{reviewTarget.inputFiles.map((file,index)=><span key={file.path} className="inline-flex flex-wrap gap-1"><button type="button" onClick={()=>openFile(file)} className="rounded-lg border border-white/15 px-3 py-2">查看材料 {index+1}：{file.name}</button><button type="button" onClick={()=>void api.downloadFile(file.path,file.name).catch(error=>setFailure(error instanceof Error?error.message:String(error)))} className="rounded-lg border border-white/15 px-3 py-2" aria-label={`下载材料：${file.name}`}>下载副本</button></span>)}</div></section>}
      {!!reviewTarget?.expertRuns?.length&&<div className="space-y-2 py-2"><p>已交给专家，点这里查看实际进度和成果：</p>{reviewTarget.expertRuns.map(expert=><button type="button" disabled={busy} key={expert.id} onClick={()=>void inspect(expert.id)} className="mr-2 rounded-lg border border-white/15 px-3 py-2">查看专家：{expert.agentName}</button>)}</div>}
      {reviewTarget?.expert&&<p className="py-2">专家“{reviewTarget.expert.agentName}”的工作记录 <button type="button" disabled={busy} onClick={()=>void inspect(reviewTarget.expert!.parentRunId)} className="rounded-lg border border-white/15 px-3 py-2 text-sm">看看主助手的交办</button></p>}
      {selected&&selected.status!=='completed'&&selected.artifacts.length>0&&<div className="flex flex-wrap gap-2 py-2">{selected.artifacts.map(file=><button type="button" key={file.path} onClick={()=>openFile(file)} className="rounded-lg border border-white/15 px-3 py-2">打开已做好的部分：{file.ownerName?`${file.ownerName}：`:""}{file.name}</button>)}</div>}
      {reviewTarget?.status==='completed' && reviewTarget.review && <details key={reviewTarget.id} open={panelOpen||!!selected} className="border-b border-white/10 py-1">
        <summary className="cursor-pointer rounded px-2 py-1 text-sm text-emerald-200 focus-visible:outline focus-visible:outline-amber-300">
          查看成果{reviewTarget.review.status==='pending'?' · 待验收':''}
        </summary>
        <section aria-label="看看做好的作品" className="space-y-3 px-2 pb-2">
        <strong className="block text-lg">{reviewTarget.review.status==='accepted'?'你已确认完成':reviewTarget.review.status==='changes_requested'?'已记下你的修改想法':'做好啦，你觉得怎么样？'}</strong>
        {selected && selected.id!==run?.id && <button type="button" onClick={clearSelection} className="rounded-lg px-3 py-2">返回</button>}
        <details><summary className="cursor-pointer py-2">看看文字</summary><p className="whitespace-pre-wrap max-h-48 overflow-auto">{reviewTarget.content}</p></details>
        {createdApps.map(app=><button type="button" disabled={busy} key={app.id} onClick={()=>void openCreatedApp(app.id)} className="rounded-xl border border-white/20 px-4 py-3">打开应用：{app.name}</button>)}
        <div className="flex flex-wrap gap-2">{reviewTarget.artifacts.map(a=><button type="button" key={a.path} onClick={()=>openFile(a)} className="rounded-xl border border-white/20 px-4 py-3 text-left"><FileCheck size={18} className="inline mr-2"/>打开作品：{a.ownerName?`${a.ownerName}：`:""}{a.name}</button>)}</div>
        {reviewTarget.review.feedback && <p>你想改的地方：{reviewTarget.review.feedback}</p>}
        {reviewTarget.review.revisionRunId&&<button type="button" disabled={busy} onClick={()=>void inspect(reviewTarget.review!.revisionRunId!)} className="rounded-xl border border-white/20 px-4 py-3">查看修改版</button>}
        {reviewTarget.review.status!=='accepted' && !reviewTarget.review.revisionRunId && <>
          <div className="flex flex-wrap gap-3">
            <button disabled={busy} type="button" onClick={()=>void review('accepted')} className="rounded-xl bg-emerald-600 px-5 py-3 font-medium text-white disabled:opacity-50">{busy?'正在保存…':delegationId?'满意，顺便完成这件委托':'满意，完成啦'}</button>
            <button disabled={busy} aria-expanded={editingReview} type="button" onClick={()=>setEditingReview(value=>!value)} className="rounded-xl border border-white/20 px-5 py-3">想改一改</button>
          </div>
          {editingReview && <div className="space-y-3 rounded-xl bg-black/20 p-3">
            <label className="block">哪里想改？<textarea aria-label="哪里想改？" value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="比如：短一点，或者加一只小猫。" className="mt-2 block w-full rounded-lg border border-white/20 bg-black/20 p-3 text-base" /></label>
            <button disabled={busy||!feedback.trim()} type="button" onClick={()=>void review('changes_requested')} className="rounded-lg bg-white/10 px-4 py-3 disabled:opacity-50">记下修改想法</button>
          </div>}
          {reviewTarget.review.status==='changes_requested' && <button disabled={busy} type="button" onClick={()=>void revise()} className="rounded-xl bg-amber-500 px-5 py-3 text-black font-medium">按这个想法重新做</button>}
          <details><summary className="cursor-pointer py-2 text-sm text-desktop-muted">更多：关联委托</summary><label>这份作品属于哪件事？<select aria-label="关联委托" value={delegationId} onFocus={()=>void api.delegationsList().then(setDelegations).catch(e=>setFailure(String(e)))} onChange={e=>setDelegationId(e.target.value)} className="block w-full rounded-lg border border-white/20 bg-desktop-surface p-3"><option value="">不用关联</option>{delegations.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select></label>{delegationId && <p className="text-sm">点“满意”也会把这件委托记为完成。</p>}</details>
        </>}
        {reviewTarget.review.delegationPending && <button disabled={busy} type="button" onClick={()=>void review('accepted')} className="rounded-lg border border-white/20 px-4 py-3">再试一次：记好委托结果</button>}
        {reviewTarget.review.delegationId && <button type="button" onClick={()=>{closePanel();useDesktopStore.getState().openApp('delegation-tracker');}} className="rounded-lg px-3 py-2">查看这件委托</button>}
        </section>
      </details>}
      {selected && selected.status!=='completed' && <div><p>{runLabel(selected)}</p><p>{selected.error}</p><p className="whitespace-pre-wrap max-h-48 overflow-auto">{selected.content}</p>{selected.status==='running' && <button type="button" disabled={busy} onClick={()=>void actSelected('stop')}>先停一下</button>}{selected.canResume && <button type="button" disabled={busy} onClick={()=>void actSelected('resume')}>继续做</button>}<button type="button" onClick={()=>void inspect(selected.id)}>看看最新进度</button><button type="button" onClick={clearSelection}>返回</button></div>}
      {run && <div className="flex items-center gap-2">
        {active && <Loader2 size={13} className="animate-spin shrink-0" />}
        <span className="flex-1">{run.status==='completed' ? currentReview?.status==='accepted' ? '你已确认完成' : currentReview?.status==='changes_requested' ? '已记下你的修改想法' : currentReview ? LABELS.completed : '执行已结束' : runLabel(run)}</span>
        {run.status === 'running' && <button type="button" onClick={onStop} className="flex items-center gap-1 rounded px-2 py-1 text-red-400 hover:bg-white/10"><Square size={12} />先停一下</button>}
        {run.canResume && !active && <button type="button" onClick={onResume} className="flex items-center gap-1 rounded px-2 py-1 text-desktop-highlight hover:bg-white/10"><Play size={12} />继续做</button>}
      </div>}
      {(error || run?.error) && <p className="mt-1 text-amber-300 whitespace-pre-wrap">{error || run?.error}</p>}
      {run && (run.status !== 'completed' || !run.review) && run.artifacts.length > 0 && <div className="flex flex-wrap gap-2 mt-2">
        {run.artifacts.map((artifact) => <button key={artifact.path} type="button" onClick={() => openFile(artifact)} className="flex items-center gap-1.5 rounded border border-white/10 px-2 py-1 hover:bg-white/10"><FileCheck size={13} />{artifact.ownerName?`${artifact.ownerName}：`:""}{artifact.name}</button>)}
      </div>}
        </div>
      </div>
    </dialog>
  </>;
}
