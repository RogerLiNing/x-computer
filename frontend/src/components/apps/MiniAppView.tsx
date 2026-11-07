/** Generated applications have an opaque origin and an app-scoped data capability. */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/utils/api';
import { PreviewFrame } from '@/components/shared/IsolatedPreview';
import { useConnectionStore } from '@/store/connectionStore';
import { getUserId, getUserIdOrNull } from '@/utils/userId';
import { setMiniAppsFromApi } from '@/appRegistry';
import { useDesktopStore } from '@/store/desktopStore';

export function MiniAppView({appId}:{appId:string}){
  const owner=getUserId();const [url,setUrl]=useState('');const [expires,setExpires]=useState(0);const [error,setError]=useState('');const [version,setVersion]=useState(0);
  const [history,setHistory]=useState<Array<{id:string;name:string;createdAt:number}>|null>(null);
  const [historyError,setHistoryError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{setHistory(null);setHistoryError('');},[appId,owner]);
  const showHistory=async()=>{
    if(history!==null){setHistory(null);return;}
    setBusy(true);setHistoryError('');
    try{const result=await api.getAppVersions(appId);if(getUserIdOrNull()===owner)setHistory(result.versions);}
    catch{setHistoryError('以前的版本暂时读不到，请稍后重试。');}
    finally{setBusy(false);}
  };
  const restore=async(id:string)=>{
    setBusy(true);setHistoryError('');
    try{
      const result=await api.restoreAppVersion(appId,id);
      if(getUserIdOrNull()!==owner)return;
      const apps=await api.getMiniApps();if(getUserIdOrNull()!==owner)return;
      setMiniAppsFromApi(apps.apps);useDesktopStore.getState().openApp(result.app.id);
    }catch{setHistoryError('副本暂时没有打开，请在桌面查看或稍后重试。当前应用和存档没有被覆盖。');}
    finally{setBusy(false);}
  };
  useEffect(()=>{
    let live=true;setUrl('');setError('');
    void api.createAppPreview(appId).then(result=>{if(live&&getUserIdOrNull()===owner){setExpires(result.expiresAt);setUrl(result.url);}}).catch(()=>{if(live)setError('应用暂时无法打开，请重试或让助手检查。');});
    return()=>{live=false;};
  },[appId,owner,version]);
  const channel=useCallback((send:(message:unknown)=>void)=>{
    const store=useConnectionStore.getState();store.sendWs?.({type:'subscribe_app',data:{appId}});
    const unsub=store.subscribeAppChannel(appId,message=>{if(getUserIdOrNull()===owner&&Date.now()<expires)send(message);});
    return()=>{unsub();useConnectionStore.getState().sendWs?.({type:'unsubscribe_app',data:{appId}});};
  },[appId,owner,expires]);
  return <div className="h-full flex flex-col"><div className="shrink-0 flex justify-end border-b border-black/10 bg-white p-1 text-slate-700"><button type="button" aria-expanded={history!==null} onClick={()=>void showHistory()} disabled={busy} className="rounded-lg px-3 py-2 text-sm">以前的版本</button><button type="button" onClick={()=>setVersion(value=>value+1)} className="rounded-lg px-3 py-2 text-sm" disabled={!url&&!error}>重新打开</button></div>
    {historyError&&<p role="alert" className="shrink-0 bg-white p-3 text-sm text-red-800">{historyError}</p>}
    {history!==null&&<section aria-label="以前的版本" className="max-h-52 shrink-0 overflow-auto bg-white p-3 text-slate-800"><p className="mb-2 text-sm">恢复会新建一个副本，当前应用和存档会保留。副本从新的存档开始。</p>{history.length===0?<p className="text-sm">还没有保存的版本。助手下次交付这个应用时会保留版本。</p>:<ul>{history.map(item=><li key={item.id} className="flex items-center justify-between gap-2 border-t border-slate-200 py-2 text-sm"><span>{item.name} · {new Date(item.createdAt).toLocaleString()}</span><button type="button" disabled={busy} onClick={()=>void restore(item.id)} className="shrink-0 rounded-lg border border-slate-300 px-3 py-2">恢复为副本</button></li>)}</ul>}</section>}
    <div className="flex-1 min-h-0">{error?<p role="alert" className="p-4 text-sm">{error}</p>:url?<PreviewFrame key={url} url={url} title={appId} onChannel={channel}/>:<p className="p-4 text-sm">正在准备应用…</p>}</div></div>;
}
