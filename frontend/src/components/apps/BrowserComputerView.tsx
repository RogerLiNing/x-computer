import { useDesktopStore } from '@/store/desktopStore';
import { useEffect, useRef, useState } from 'react';
type Download={id:string;name:string;size:number};
export function BrowserDownloads({downloads,pending,error,busy,onSave}:{downloads:Download[];pending?:number;error?:string;busy:boolean;onSave:(id:string)=>void}){
 return <section aria-label="浏览器下载">{pending? <p>正在下载，请稍等…</p>:null}{error&&<p role="alert">{error}</p>}{downloads.map(file=><div key={file.id} className="flex flex-wrap items-center gap-2 py-2"><span className="break-all">{file.name}</span><span className="text-xs text-desktop-muted">{file.size} 字节</span><button disabled={busy} onClick={()=>onSave(file.id)} className="px-3 py-2 bg-white/10 rounded-lg">保存并打开</button></div>)}</section>;
}
function uploadSite(value:string){if(value.startsWith('about:'))return '本地练习页';try{const url=new URL(value);return url.origin+url.pathname;}catch{return value;}}
type UploadRequest={id:string;status:string;targetInfo?:{label:string;formAction?:string};url:string;file:{name:string;path:string;size:number;sha256:string}};
export function BrowserUploads({requests,busy,currentURL,onDecision}:{requests:UploadRequest[];busy:boolean;currentURL?:string;onDecision:(id:string,decision:'approve'|'reject')=>void}){
 const active=requests.filter(item=>['pending','unknown'].includes(item.status));
 const visible=active.length?active.slice(-3):requests.filter(item=>item.status==='completed'&&(!currentURL||item.url===currentURL)).slice(-1);
 return <section aria-label="文件上传确认">{visible.map(item=><article key={item.id} className="border border-white/15 rounded-xl p-3 space-y-2">
  <strong>{item.status==='pending'?'需要你确认文件':item.status==='completed'?'文件已提供给网页':'文件提供结果需要核实'}</strong>
  <p className="break-all">文件：{item.file.path}（{item.file.size} 字节）</p>
  <p className="break-all">目标网页：{uploadSite(item.url)}</p>
  {item.targetInfo?.label&&<p>选择框：{item.targetInfo.label}</p>}
  {item.targetInfo?.formAction&&item.targetInfo.formAction!==item.url&&<p className="break-all">表单地址：{uploadSite(item.targetInfo.formAction)}</p>}
  {item.status==='pending'?<><p className="text-sm text-desktop-muted">确认后网页将能读取这份文件，可能立即发送给它的服务端。文件或页面变化后需要重新确认。</p><div className="flex gap-2"><button disabled={busy} onClick={()=>onDecision(item.id,'approve')} className="px-4 py-2 rounded-lg bg-amber-500/20">允许提供这份文件</button><button disabled={busy} onClick={()=>onDecision(item.id,'reject')} className="px-4 py-2 rounded-lg bg-white/10">不提供</button></div></>:<p>{item.status==='completed'?'请继续检查网页处理结果。':'请先查看页面，系统不会自动重试。'}</p>}
 </article>)}</section>;
}
type BrowserTab = { id: string; title?: string; url: string; active: boolean };
export function BrowserTabs({tabs, busy, driving, limit, onAction}: {
 tabs: BrowserTab[]; busy: boolean; driving: boolean; limit: number; onAction: (input: Record<string, unknown>) => void;
}) {
 return <nav aria-label="浏览器标签页" className="flex max-w-full gap-2 overflow-x-auto pb-1">
  {tabs.map((tab, index) => <div key={tab.id} className={`flex shrink-0 items-center rounded-lg border ${tab.active ? 'border-amber-400/60 bg-amber-400/10' : 'border-white/15'}`}>
   <button type="button" disabled={busy || !driving} aria-pressed={tab.active}
    onClick={() => onAction({action:'switch_tab',tab:tab.id})} title={tab.url}
    className="min-h-11 max-w-40 truncate px-3 py-2 text-left text-sm">{tab.title || (tab.url === 'about:blank' ? '新页面' : tab.url) || `页面${index + 1}`}</button>
   <button type="button" disabled={busy || !driving} aria-label={`关闭第${index + 1}个标签页`}
    onClick={() => onAction({action:'close_tab',tab:tab.id})} className="min-h-11 min-w-11 rounded-lg px-3 py-2">×</button>
  </div>)}
  <button type="button" disabled={busy || !driving || tabs.length >= limit} onClick={() => onAction({action:'new_tab'})}
   className="min-h-11 shrink-0 rounded-lg border border-white/15 px-3 py-2 text-sm">新标签页</button>
 </nav>;
}
type ComputerState={tabs?:BrowserTab[];activeTabId?:string;frame?:string;maxTabs?:number;tabError?:string;uploadRequests?:UploadRequest[];downloads?:Download[];pendingDownloads?:number;downloadError?:string;available?:boolean;started?:boolean;holder?:'human'|'agent';image?:string;run?:string;revision?:number;url?:string;allowedOrigins?:string[]};
export function BrowserComputerView() {
 const [state,setState]=useState<ComputerState>({});const [image,setImage]=useState('');const [error,setError]=useState('');
 const [loadError,setLoadError]=useState('');
 const [busy,setBusy]=useState(false);const [text,setText]=useState('');const [url,setUrl]=useState('');
 const latest=useRef<ComputerState>({});
 function apply(data:ComputerState){
  if(data.run===latest.current.run && (data.revision??0)<(latest.current.revision??0))return;
  const previous = latest.current;
  latest.current=data;setState(data);
  if(data.image)setImage(data.image);
  else if (previous.run !== data.run || previous.revision !== data.revision || previous.activeTabId !== data.activeTabId) setImage('');
 }
 const alive=useRef(true);const inFlight=useRef(false);
 async function request<T=ComputerState>(input?:Record<string,unknown>) {
  const response=await fetch(`/api/computer/${input?'action':'status'}`,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);
  const data=await response.json();if(!response.ok)throw new Error(data.error || '电脑暂不可用');return data as T;
 }
 const refresh=async()=>{
  if(inFlight.current)return;inFlight.current=true;
  try{const data=await request({action:'frame'});if(alive.current){apply(data);setLoadError('');}}
  catch(reason){if(alive.current)setLoadError(reason instanceof Error?reason.message:String(reason));}
  finally{inFlight.current=false;}
 };
 useEffect(()=>{alive.current=true;void request().then(data=>{if(alive.current)apply(data);}).catch(reason=>{if(alive.current)setError(String(reason));});return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!state.started)return;void refresh();const timer=setInterval(()=>void refresh(),1500);return()=>clearInterval(timer);},[state.started]);
 async function act(input:Record<string,unknown>){
  if(busy)return;setBusy(true);setError('');
  try{const next=await request(['click','type','key','scroll'].includes(String(input.action)) ? {...input,frame:state.frame} : input);if(alive.current){apply(next);await refresh();}}
  catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:String(reason));}
  finally{if(alive.current)setBusy(false);}
 }
 async function saveDownload(id:string){
  if(busy)return;setBusy(true);setError('');
  try{
   const file=await request<{path:string;name:string}>({action:'present_download',id});
   if(!alive.current)return;
   const app=/\.(png|jpg|jpeg|webp|gif)$/i.test(file.name)?'image-viewer':/\.(pdf|docx|xlsx|pptx)$/i.test(file.name)?'office-viewer':/\.(mp3|wav|ogg|mp4|webm)$/i.test(file.name)?'media-viewer':'text-editor';
   useDesktopStore.getState().openApp(app,{filePath:file.path,fileName:file.name,mediaType:/\.(mp3|wav|ogg)$/i.test(file.name)?'audio':'video'});
  }catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:String(reason));}
  finally{if(alive.current)setBusy(false);}
 }
 const driving=state.holder==='human';
 return <section aria-label="助手电脑" className="h-full overflow-auto p-3 space-y-3">
  <p className="text-sm">这是助手的独立浏览器。画面定时更新；点“我来操作”后，助手会等待你交还。</p>
  {state.available===false&&<p>助手电脑尚未启用，请由管理员配置浏览器容器。</p>}
  <div className="flex flex-wrap gap-2 items-center">
   <button disabled={busy||state.available===false} onClick={()=>void act({action:'start'})} className="px-4 py-2 rounded-lg bg-white/10">打开助手电脑</button>
  {state.started&&<><span>{driving?'你正在操作':'助手可以操作'}</span><button disabled={busy||driving} onClick={()=>void act({action:'take'})} className="px-4 py-2 rounded-lg bg-white/10">我来操作</button><button disabled={busy||!driving} onClick={()=>void act({action:'release'})} className="px-4 py-2 rounded-lg bg-white/10">交还助手</button></>}
  </div>
  {(error||loadError)&&<p role="alert" className="text-amber-300">{error||loadError}</p>}
  {state.uploadRequests?.length?<BrowserUploads requests={state.uploadRequests} busy={busy} currentURL={state.url} onDecision={(id,decision)=>void act({action:'upload_decision',id,decision})}/>:null}
  {(state.downloads?.length||state.pendingDownloads||state.downloadError)?<BrowserDownloads downloads={state.downloads??[]} pending={state.pendingDownloads} error={state.downloadError} busy={busy} onSave={id=>void saveDownload(id)}/>:null}
  {state.started&&<>
   {state.tabs && <BrowserTabs tabs={state.tabs} busy={busy} driving={driving} limit={state.maxTabs ?? 8} onAction={input => void act(input)} />}
   {state.tabError && <p role="alert" className="text-amber-300">{state.tabError}</p>}
   <div className="flex flex-wrap gap-2"><button disabled={busy||!driving} onClick={()=>void act({action:'demo'})} className="px-3 py-2 bg-white/10 rounded-lg">打开练习页</button><input aria-label="助手浏览器网址" value={url} onChange={e=>setUrl(e.target.value)} placeholder="管理员允许的网站地址" className="flex-1 min-w-40 bg-white/5 px-3 py-2 rounded-lg"/><button disabled={busy||!driving||!url} onClick={()=>void act({action:'navigate',url})} className="px-3 py-2 bg-white/10 rounded-lg">前往</button></div>
   <p className="text-xs text-desktop-muted">当前页面：{state.url}。外部网站仅限管理员允许的来源。</p>
   {image&&<img alt="助手浏览器实时画面" src={`data:image/jpeg;base64,${image}`} draggable={false} className={`w-full max-w-[1100px] border border-white/15 ${driving?'cursor-crosshair':''}`} onClick={e=>{if(!driving||busy)return;const rect=e.currentTarget.getBoundingClientRect();void act({action:'click',x:(e.clientX-rect.left)*1100/rect.width,y:(e.clientY-rect.top)*700/rect.height});}}/>}
   <div className="flex flex-wrap gap-2"><input aria-label="发送到助手浏览器的文字" value={text} onChange={e=>setText(e.target.value)} placeholder="先点画面中的输入框，再填写文字" maxLength={4000} className="flex-1 min-w-48 px-3 py-2 rounded-lg bg-white/5"/><button disabled={busy||!driving||!image||!text} onClick={()=>void act({action:'type',text})} className="px-3 py-2 rounded-lg bg-white/10">输入文字</button>{['Enter','Tab','Backspace','Escape'].map(key=><button key={key} disabled={busy||!driving||!image} onClick={()=>void act({action:'key',key})} className="px-3 py-2 rounded-lg bg-white/10">{key}</button>)}<button disabled={busy||!driving||!image} onClick={()=>void act({action:'scroll',delta:500})} className="px-3 py-2 bg-white/10 rounded-lg">向下滚动</button></div>
  </>}
 </section>;
}
