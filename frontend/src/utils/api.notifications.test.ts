import { afterEach,describe,it,expect,vi } from 'vitest';
import { api } from './api';
vi.mock('@/store/systemLogStore',()=>({getSystemLogStore:()=>({addLog:vi.fn()})}));
vi.mock('./userId.js',()=>({getUserId:()=> 'owner',getUserIdOrNull:()=> 'owner'}));
vi.mock('../i18n.js',()=>({default:{language:'zh-CN'}}));
afterEach(()=>vi.unstubAllGlobals());

describe('unwrapped notification contracts',()=>{
  it('rejects malformed payloads before they can crash the notification view or reset DND',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{"success":true,"data":{}}')));
    await expect(api.getNotifications()).rejects.toThrow('格式');await expect(api.getUnreadNotificationCount()).rejects.toThrow('格式');await expect(api.getDndPreferences()).rejects.toThrow('格式');
  });
  it('returns flat lists, counts and DND preferences from the actual API envelopes',async()=>{
    const notice={id:'reminder',title:'到时间啦',body:'整理书包',link:'app:chat-session:original',read:false};
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify({success:true,data:url.includes('/unread-count')?{count:1}:url.includes('/dnd')?{enabled:false,quietHoursStart:null,quietHoursEnd:null}:[notice]}))));
    expect(await api.getNotifications()).toEqual([notice]);expect(await api.getUnreadNotificationCount()).toEqual({count:1});expect((await api.getDndPreferences()).enabled).toBe(false);
  });
});
