import { useEffect, useRef, useState } from 'react';
import { api } from '@/utils/api';

import { previewCapsule } from '@shared/previewCapsule';
export { previewCapsule } from '@shared/previewCapsule';

export function PreviewFrame({url,title,autoHeight=false,onChannel}:{url:string;title:string;autoHeight?:boolean;onChannel?:(send:(message:unknown)=>void)=>()=>void}){
  const ref=useRef<HTMLIFrameElement>(null);const [height,setHeight]=useState(320);
  useEffect(()=>{
    const listener=(event:MessageEvent)=>{if(autoHeight&&event.source===ref.current?.contentWindow&&event.data?.type==='x_render_height'&&Number.isFinite(event.data.height))setHeight(Math.min(720,Math.max(120,event.data.height)));};
    addEventListener('message',listener);return()=>removeEventListener('message',listener);
  },[autoHeight]);
  useEffect(()=>onChannel?.(message=>ref.current?.contentWindow?.postMessage({type:'x_app_channel',data:message},'*')),[onChannel]);
  return <iframe ref={ref} title={title} sandbox="allow-scripts" allow="autoplay; fullscreen" referrerPolicy="no-referrer" srcDoc={previewCapsule(url,location.origin)} className="w-full border-0 bg-white" style={{height:autoHeight?height:'100%'}}/>;
}

export function ContentPreview({content,mode}:{content:string;mode:'html'|'react'}){
  const [url,setUrl]=useState('');const [error,setError]=useState('');
  useEffect(()=>{
    let current=true;setUrl('');setError('');
    void api.createContentPreview(content,mode).then(result=>{if(current)setUrl(result.url);}).catch(()=>{if(current)setError('内容暂时无法显示，请让助手检查。');});
    return()=>{current=false;};
  },[content,mode]);
  if(error)return <p role="alert">{error}</p>;
  return url?<PreviewFrame url={url} title="助手生成内容" autoHeight/>:<p className="text-sm text-desktop-muted">正在准备预览…</p>;
}
