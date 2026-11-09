import {getNotificationTarget,openNotificationLink} from '@/utils/openNotificationLink';
import {openAssistantComputer} from '@/utils/openAssistantComputer';
import { useEffect, useRef, useState } from 'react';
import { api, type AssistantWorkbenchData, type ChatRunArtifact } from '@/utils/api';
import { useDesktopStore } from '@/store/desktopStore';

export type WorkbenchView = 'attention' | 'active' | 'finished';
const TITLES:Record<WorkbenchView,string>={attention:'等我决定',active:'正在做',finished:'我的作品'};
const STATUS:Record<string,string>={running:'正在帮你做',stopping:'正在停下来',completed:'做好了',paused:'已暂停',failed:'需要处理',blocked:'需要处理',interrupted:'可以恢复'};

/** Render only recorded work. Opening a work item does not start or approve it. */
export function WorkbenchContent({data,view,onView,onSelect,onOpen,onNotice,onNavigate}:{
 data:AssistantWorkbenchData;view:WorkbenchView;onView:(view:WorkbenchView)=>void;
 onSelect:(id:string)=>void;onOpen:(file:ChatRunArtifact)=>void;onNotice:(id:string,link?:string|null)=>void;onNavigate?:()=>void;
}) {
 const count={attention:data.attention.length,active:data.active.length,finished:data.finished.length};
 const records=view==='active'?data.active:data.finished;
 return <>
  <div className="flex flex-wrap gap-2" aria-label="助手工作台">
   {(['attention','active','finished'] as const).map(key=><button type="button" key={key} aria-pressed={view===key} onClick={()=>onView(key)} className={`rounded-xl px-4 py-2 text-sm ${view===key?'bg-amber-500/15 text-amber-200':'text-desktop-muted hover:bg-white/5'}`}>{TITLES[key]} · {count[key]}</button>)}
  </div>
  <div className="max-h-60 overflow-auto mt-2 space-y-2">
   {view==='attention' && data.attention.length===0 && <p className="py-2 text-sm text-desktop-muted">现在没有需要你决定的事。</p>}
   {view==='attention' && data.attention.map(item=><div key={item.id} className="border-t border-white/10 py-2 flex items-start gap-3">
    <div className="min-w-0 flex-1"><p className="text-sm break-words">{item.title}</p><p className="text-xs text-desktop-muted">{item.detail==='成果待验收'?'做好了，等你看看':item.detail}</p></div>
    <button type="button" onClick={()=>{if(item.source==='run')onSelect(item.sourceId);else if(item.source==='delegation'){onNavigate?.();useDesktopStore.getState().openApp('delegation-tracker');}else if(item.appId==='browser'){onNavigate?.();openAssistantComputer();}else onNotice(item.sourceId,item.link);}} className="rounded-lg border border-white/15 px-3 py-2 text-sm shrink-0">{item.appId==='browser'||getNotificationTarget(item.link)?'去处理':item.source==='notification'?'标为已处理':'去看看'}</button>
   </div>)}
   {view!=='attention' && records.length===0 && <p className="py-2 text-sm text-desktop-muted">{view==='active'?'现在没有正在做的事情。':'完成的交办和作品会出现在这里。'}</p>}
   {view!=='attention' && records.map(record=><article key={record.id} className="border-t border-white/10 py-2">
    <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="text-sm break-words">{record.title}</p><p className="text-xs text-desktop-muted">{record.review?.status==='accepted'?'你已确认':record.review?.status==='changes_requested'?'你提出了修改':STATUS[record.status]} · {new Date(record.updatedAt).toLocaleString()}</p></div><button type="button" onClick={()=>onSelect(record.id)} className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-sm">查看进度与结果</button></div>
    <div className="flex flex-wrap gap-2 mt-2"><button type="button" onClick={()=>{onNavigate?.();useDesktopStore.getState().openApp(record.scene==='x_direct'?'x':'chat',{sessionId:record.sessionId});}} className="rounded-lg border border-white/15 px-3 py-2 text-sm">打开原对话</button>{record.artifacts.map(file=><button type="button" key={file.path} onClick={()=>onOpen(file)} className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 break-all">打开作品：{file.ownerName?`${file.ownerName}：`:""}{file.name}</button>)}</div>
   </article>)}
  </div>
  {data.limited && view!=='attention' && <p className="text-xs text-desktop-muted">这里展示最近的交办；更早的内容可在原对话中查看。</p>}
 </>;
}

export function AssistantWorkbench({onSelect,onOpen,onAttentionChange,onNavigate}:{onSelect:(id:string)=>void;onOpen:(file:ChatRunArtifact)=>void;onAttentionChange?:(count:number)=>void;onNavigate?:()=>void}) {
 const [data,setData]=useState<AssistantWorkbenchData|null>(null);
 const [error,setError]=useState('');const [view,setView]=useState<WorkbenchView>('attention');
 const refreshRef=useRef<()=>void>(()=>{});
 const disclosure = useRef<HTMLDetailsElement>(null);
 const summary = useRef<HTMLElement>(null);
 const select = (id: string) => {
   if (disclosure.current) disclosure.current.open = false;
   summary.current?.focus();
   onSelect(id);
 };
 useEffect(()=>{
  let live=true;let version=0;
  const load=async()=>{const request=++version;try{const next=await api.getAssistantWorkbench();if(live&&request===version){setData(next);setError('');onAttentionChange?.(next.attention.length);}}catch(reason){if(live&&request===version){setData(null);setError(reason instanceof Error?reason.message:String(reason));}}};
  refreshRef.current=()=>{void load();};void load();
  const refresh=()=>{void load();};const timer=setInterval(refresh,15000);
  window.addEventListener('x:workbench-refresh',refresh);
  return()=>{live=false;clearInterval(timer);window.removeEventListener('x:workbench-refresh',refresh);};
 },[onAttentionChange]);
 const notice=async(id:string,link?:string|null)=>{
  if(getNotificationTarget(link)){
   onNavigate?.();openNotificationLink(link??null);
   if(disclosure.current)disclosure.current.open=false;
   return;
  }
  try{await api.markNotificationRead(id);refreshRef.current();window.dispatchEvent(new Event('x:notifications-refresh'));}
  catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
 };
 return <details ref={disclosure} aria-label="我的助手工作台" className="min-w-0">
  <summary ref={summary} className="min-h-10 cursor-pointer rounded px-2 py-1 text-sm font-semibold focus-visible:outline focus-visible:outline-amber-300">
    我的助手工作台
    {!!data?.attention.length && <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 font-normal text-amber-200">{data.attention.length} 件待处理</span>}
  </summary>
  <section aria-label="工作台列表" className="space-y-2 border-t border-white/10 pt-2">
    <div className="flex justify-end"><button type="button" onClick={()=>refreshRef.current()} className="px-3 py-2 text-sm text-desktop-muted">刷新进度</button></div>
    {!data&&!error&&<p className="text-sm text-desktop-muted">正在读取你的工作进度…</p>}
    {error&&<div role="alert" className="text-sm text-amber-300"><p>暂时取不到最新进度，请点“刷新进度”重试。</p><details><summary>查看原因</summary>{error}</details></div>}
    {data&&<WorkbenchContent data={data} view={view} onView={setView} onSelect={select} onOpen={onOpen} onNotice={(id,link)=>void notice(id,link)} onNavigate={onNavigate}/>}
  </section>
 </details>;
}
