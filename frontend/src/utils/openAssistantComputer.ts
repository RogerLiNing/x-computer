import {useDesktopStore} from '@/store/desktopStore';
/** A decision returns to the existing computer instead of opening another control surface. */
export function openAssistantComputer(){
 const desktop=useDesktopStore.getState();const window=[...desktop.windows].reverse().find(item=>item.appId==='browser');
 if(window)desktop.focusWindow(window.id);else desktop.openApp('browser');
}
