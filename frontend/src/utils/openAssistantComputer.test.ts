import {beforeEach,describe,it,expect,vi} from 'vitest';
const desktop=vi.hoisted(()=>({windows:[] as Array<{id:string;appId:string}>,focusWindow:vi.fn(),openApp:vi.fn()}));
vi.mock('@/store/desktopStore',()=>({useDesktopStore:{getState:()=>desktop}}));
import {openAssistantComputer} from './openAssistantComputer';
describe('return to assistant computer',()=>{
 beforeEach(()=>{desktop.windows=[];vi.clearAllMocks();});
 it('opens it when absent',()=>{openAssistantComputer();expect(desktop.openApp).toHaveBeenCalledWith('browser');});
 it('focuses an existing browser without duplicating its controls',()=>{desktop.windows=[{id:'browser',appId:'browser'}];openAssistantComputer();expect(desktop.focusWindow).toHaveBeenCalledWith('browser');expect(desktop.openApp).not.toHaveBeenCalled();});
});
