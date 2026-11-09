import {describe,it,expect,vi} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
import {WorkbenchContent} from './AssistantWorkbench';import type {AssistantWorkbenchData} from '@/utils/api';
vi.mock('@/utils/api',()=>({api:{}}));vi.mock('@/store/desktopStore',()=>({useDesktopStore:{getState:()=>({})}}));
const data:AssistantWorkbenchData={active:[{id:'run-a',sessionId:'session-a',title:'正在整理报告',status:'running',updatedAt:1,artifacts:[],canResume:false}],finished:[{id:'run-b',sessionId:'session-b',title:'已写好故事',status:'completed',review:{status:'pending'},updatedAt:2,canResume:false,artifacts:[{name:'故事.md',path:'文档/故事.md',size:12}]}],attention:[{id:'run:run-b',source:'run',sourceId:'run-b',title:'等你确认的故事',detail:'成果待验收',at:2}],limited:false};
const render=(view:'attention'|'active'|'finished',value=data)=>renderToStaticMarkup(<WorkbenchContent data={value} view={view} onView={()=>{}} onSelect={()=>{}} onOpen={()=>{}} onNotice={()=>{}}/>);
describe('assistant activity workbench',()=>{
 it('separates active work, decisions and files using actual counts',()=>{const html=render('active');expect(html).toContain('正在做 · 1');expect(html).toContain('正在整理报告');expect(html).not.toContain('已写好故事');});
 it('opens existing verified file records without claiming review acceptance',()=>{const html=render('finished');expect(html).toContain('打开作品：故事.md');expect(html).toContain('打开原对话');expect(html).not.toContain('你已确认');});
 it('offers an explicit action for a decision, without approving automatically',()=>{const html=render('attention');expect(html).toContain('等你确认的故事');expect(html).toContain('去看看');expect(html).not.toContain('确认成果');});
 it('labels incomplete historical listings honestly',()=>{expect(render('finished',{...data,limited:true})).toContain('更早的内容可在原对话中查看');});
 it('routes an upload decision to the computer instead of merely marking it read',()=>{const html=render('attention',{...data,attention:[{id:'notice',source:'notification',sourceId:'upload',title:'确认文件',detail:'等待确认',at:3,appId:'browser'}]});expect(html).toContain('去处理');expect(html).not.toContain('标为已处理');});
 it('offers navigation for recorded task links and an explicit dismissal for unlinked notices',()=>{
  const notice={id:'notice',source:'notification' as const,sourceId:'pending',title:'渠道消息需要你处理',detail:'请切回原账号',at:3};
  const html=render('attention',{...data,attention:[{...notice,link:`app:scheduled-run:${'a'.repeat(32)}`}]});
  expect(html).toContain('去处理');expect(html).toContain('请切回原账号');expect(html).not.toContain('标为已处理');
  for(const link of [null,'javascript:alert(1)','app:scheduled-run:../bad'])expect(render('attention',{...data,attention:[{...notice,link}]})).toContain('标为已处理');
 });

});
