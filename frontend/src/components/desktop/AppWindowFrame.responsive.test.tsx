import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppWindow } from '@shared/index';
import { AppWindowFrame } from './AppWindowFrame';

const viewport=vi.hoisted(()=>({mobile:false}));
vi.mock('@/hooks/useMobileViewport',()=>({useMobileViewport:()=>viewport.mobile}));
vi.mock('@/store/desktopStore',()=>({useDesktopStore:(select:(state:unknown)=>unknown)=>select({})}));
vi.mock('../apps/AppContent',()=>({AppContent:()=> <div>窗口内容</div>}));
const window:AppWindow={id:'settings',appId:'settings',title:'系统设置',x:900,y:700,width:700,height:500,isMinimized:false,isMaximized:false,isFocused:true,zIndex:1};
afterEach(()=>{viewport.mobile=false;});

it('keeps an existing desktop window within a phone viewport without changing its saved geometry',()=>{
  viewport.mobile=true;
  const html=renderToStaticMarkup(<AppWindowFrame window={window}/>);
  expect(html).toContain('left:0;top:0;width:100%;height:100%');
  expect(html).toContain('safe-area-pb');expect(html).toContain('窗口内容');
  viewport.mobile=false;
  const desktop=renderToStaticMarkup(<AppWindowFrame window={window}/>);
  expect(desktop).toContain('left:900px;top:700px;width:700px;height:500px');
  expect(window.isMaximized).toBe(false);
});
