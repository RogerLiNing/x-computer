import {useDesktopStore} from '@/store/desktopStore';
import {openAssistantComputer} from './openAssistantComputer';
import {api} from './api';

export function returnedExpertId(messageId:string):string|undefined {
  return /^return-([a-f0-9]{32})-[a-f0-9]{16}$/.exec(messageId)?.[1];
}
export async function openReturnedExpert(messageId:string):Promise<void> {
  const id=returnedExpertId(messageId);
  if(!id)throw new Error('成果记录编号无效');
  const run=await api.getChatRun(id);
  useDesktopStore.getState().openApp('chat',{sessionId:run.sessionId});
}

export function getNotificationTarget(link:string|null|undefined):{appId:'x'|'browser'|'settings'|'chat';meta?:Record<string,unknown>}|null {
  if(link==='app:x')return {appId:'x'};
  if(link==='app:browser')return {appId:'browser'};
  const scheduledRun = /^app:scheduled-run:([a-f0-9]{32})$/.exec(link ?? '');
  if (scheduledRun) {
    return {appId:'settings',meta:{scheduledRunId:scheduledRun[1]}};
  }
  const match=/^app:chat-session:([\w-]{1,128})$/.exec(link??'');
  return match?{appId:'chat',meta:{sessionId:match[1]}}:null;
}

export function openNotificationLink(link:string|null):boolean {
  const target=getNotificationTarget(link);
  if(!target)return false;
  if(target.appId==='browser')openAssistantComputer();
  else if(target.meta)useDesktopStore.getState().openApp(target.appId,target.meta);
  else useDesktopStore.getState().openApp(target.appId);
  return true;
}

export function externalNotificationUrl(link:string|null):string|null {
  try{const url=new URL(link??'');return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
