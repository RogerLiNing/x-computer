import {describe,it,expect,vi} from 'vitest';
import {BrowserComputer,assertBrowserAction} from './BrowserComputer.js';
describe('browser provisioning and waits',()=>{
 it('does not start a container when checking an unopened computer',async()=>{
  const manager={findRunningContainer:vi.fn(async()=>undefined),getOrCreateContainer:vi.fn()};
  const computer=new BrowserComputer(manager);
  expect(await computer.request('owner','human',{action:'state'})).toMatchObject({started:false});expect(manager.getOrCreateContainer).not.toHaveBeenCalled();
 });
 it('rejects invalid owners and oversized parameters before provisioning',async()=>{
  const manager={findRunningContainer:vi.fn(),getOrCreateContainer:vi.fn()};const computer=new BrowserComputer(manager);
  await expect(computer.request('../other','human',{})).rejects.toThrow('登录');
  await expect(computer.request('owner','human',{text:'x'.repeat(17000)})).rejects.toThrow('参数过大');expect(manager.getOrCreateContainer).not.toHaveBeenCalled();
 });
 it('does not repeatedly call a model while waiting, and honors cancellation',async()=>{
  const computer=new BrowserComputer({findRunningContainer:vi.fn(),getOrCreateContainer:vi.fn()});
  const request=vi.spyOn(computer,'request').mockResolvedValue({started:true,holder:'human'});
  const controller=new AbortController();const waiting=computer.waitForControl('owner',controller.signal);controller.abort();
  await expect(waiting).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
 });
 it('does not allow generic agent actions to impersonate the upload confirmation path',async()=>{
  const manager={findRunningContainer:vi.fn(),getOrCreateContainer:vi.fn()};const computer=new BrowserComputer(manager);
  for(const action of ['upload_request','upload_approve'])await expect(computer.request('owner','agent',{action,actor:'human',id:'x'})).rejects.toThrow('用户确认');
  expect(manager.getOrCreateContainer).not.toHaveBeenCalled();
 });

 it('limits model actions to page operations, excluding status and approval RPCs',()=>{
  for(const action of ['state','frame','take','release','upload_approve','upload_cancel'])expect(()=>assertBrowserAction({action})).toThrow('不支持');
  for(const action of ['navigate','click','type','key','scroll','new_tab','switch_tab','close_tab'])expect(()=>assertBrowserAction({action})).not.toThrow();
 });

});
