import {describe,it,expect,vi} from 'vitest';
import {getNotificationTarget,openNotificationLink,returnedExpertId,openReturnedExpert,externalNotificationUrl} from './openNotificationLink';
import {api} from './api';
const openApp=vi.hoisted(()=>vi.fn());
vi.mock('@/store/desktopStore',()=>({useDesktopStore:{getState:()=>({openApp})}}));
vi.mock('./openAssistantComputer',()=>({openAssistantComputer:vi.fn()}));
vi.mock('./api',()=>({api:{getChatRun:vi.fn()}}));
describe('internal outcome notifications',()=>{
 it('identifies supported targets without navigating or accepting a task',()=>{
  const calls=openApp.mock.calls.length;
  expect(getNotificationTarget('app:chat-session:session-1')).toEqual({appId:'chat',meta:{sessionId:'session-1'}});
  for(const link of ['javascript:alert(1)','app:scheduled-run:../bad','https://example.test','app:unknown',null])expect(getNotificationTarget(link)).toBeNull();
  expect(openApp.mock.calls).toHaveLength(calls);
 });
 it('never opens script, data, local-file or credential-bearing notification URLs',()=>{
  for(const link of ['javascript:alert(1)','data:text/html,x','file:///private/key','https://name:secret@example.test','app:unknown',null])expect(externalNotificationUrl(link)).toBeNull();
  expect(externalNotificationUrl('https://example.test/report')).toBe('https://example.test/report');
 });
 it('opens the assistant for a durable autonomous notice',()=>{expect(openNotificationLink('app:x')).toBe(true);expect(openApp).toHaveBeenLastCalledWith('x');});
 it('opens the existing original conversation rather than a new external browser tab',()=>{
  expect(openNotificationLink('app:chat-session:session-1')).toBe(true);
  expect(openApp).toHaveBeenCalledWith('chat',{sessionId:'session-1'});
  expect(openNotificationLink('app:chat-session:../bad')).toBe(false);
  expect(openNotificationLink('https://example.test')).toBe(false);
 });
 it('opens the exact scheduled record for a warning before a run exists',()=>{
  const id='c'.repeat(32);
  expect(openNotificationLink(`app:scheduled-run:${id}`)).toBe(true);
  expect(openApp).toHaveBeenLastCalledWith('settings',{scheduledRunId:id});
  expect(openNotificationLink('app:scheduled-run:../bad')).toBe(false);
 });
 it('opens the source expert record using authenticated run lookup',async()=>{
  const id='a'.repeat(32),message=`return-${id}-${'b'.repeat(16)}`;
  vi.mocked(api.getChatRun).mockResolvedValue({sessionId:'expert-session'} as never);
  expect(returnedExpertId(message)).toBe(id);await openReturnedExpert(message);
  expect(api.getChatRun).toHaveBeenCalledWith(id);expect(openApp).toHaveBeenLastCalledWith('chat',{sessionId:'expert-session'});
  await expect(openReturnedExpert('invalid')).rejects.toThrow('编号无效');
 });
});
