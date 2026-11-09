import {beforeEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MiniAppView} from './MiniAppView';
import {api} from '@/utils/api';
import {setMiniAppsFromApi} from '@/appRegistry';
import {useDesktopStore} from '@/store/desktopStore';
const state=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,owner:'alice'}));
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),
  useState(initial:unknown){const index=state.cursor++;if(!(index in state.slots))state.slots[index]=initial;return [state.slots[index],(value:unknown)=>{state.slots[index]=typeof value==='function'?value(state.slots[index]):value;}];},
  useEffect(){},useCallback(fn:unknown){return fn;},
}));
vi.mock('@/utils/api',()=>({api:{getAppVersions:vi.fn(),restoreAppVersion:vi.fn(),getMiniApps:vi.fn()}}));
vi.mock('@/appRegistry',()=>({setMiniAppsFromApi:vi.fn()}));
vi.mock('@/utils/userId',()=>({getUserId:()=>state.owner,getUserIdOrNull:()=>state.owner}));
vi.mock('@/store/desktopStore',()=>({useDesktopStore:{getState:()=>({openApp:open})}}));
const open=vi.hoisted(()=>vi.fn());
vi.mock('@/components/shared/IsolatedPreview',()=>({PreviewFrame:()=>null}));
const render=()=>{state.cursor=0;return MiniAppView({appId:'counter'});};
function button(node:any,label:string):any{
  if(!node||typeof node!=='object')return;
  if(node.type==='button'&&node.props.children===label)return node;
  for(const child of [node.props?.children].flat(Infinity)){const found=button(child,label);if(found)return found;}
}
const flush=async()=>{for(let count=0;count<6;count++)await Promise.resolve();};
beforeEach(()=>{vi.clearAllMocks();state.slots=[];state.cursor=0;state.owner='alice';});
describe('application recovery controls',()=>{
  it('loads history and opens the separate restored application after refreshing the desktop',async()=>{
    vi.mocked(api.getAppVersions).mockResolvedValue({versions:[{id:'v1',name:'旧版',createdAt:1}]});
    vi.mocked(api.restoreAppVersion).mockResolvedValue({app:{id:'copy',name:'副本',path:'apps/copy'}});
    vi.mocked(api.getMiniApps).mockResolvedValue({apps:[{id:'copy',name:'副本',path:'apps/copy'}]});
    button(render(),'以前的版本').props.onClick();await flush();
    expect(renderToStaticMarkup(render())).toContain('副本从新的存档开始');
    button(render(),'恢复为副本').props.onClick();await flush();
    expect(api.restoreAppVersion).toHaveBeenCalledWith('counter','v1');
    expect(setMiniAppsFromApi).toHaveBeenCalledWith([{id:'copy',name:'副本',path:'apps/copy'}]);expect(open).toHaveBeenCalledWith('copy');
  });
  it('does not open a delayed restore under a different signed-in user',async()=>{
    vi.mocked(api.getAppVersions).mockResolvedValue({versions:[{id:'v1',name:'旧版',createdAt:1}]});
    let complete!:(value:any)=>void;vi.mocked(api.restoreAppVersion).mockReturnValue(new Promise(resolve=>complete=resolve));
    button(render(),'以前的版本').props.onClick();await flush();button(render(),'恢复为副本').props.onClick();
    state.owner='bob';complete({app:{id:'copy',name:'副本',path:'apps/copy'}});await flush();
    expect(open).not.toHaveBeenCalled();expect(api.getMiniApps).not.toHaveBeenCalled();
  });
  it('keeps recovery available when the current application cannot open',()=>{
    render();state.slots[2]='当前应用无法打开';
    const html=renderToStaticMarkup(render());expect(html).toContain('以前的版本');expect(html).toContain('当前应用无法打开');expect(button(render(),'重新打开').props.disabled).toBe(false);
  });
});
