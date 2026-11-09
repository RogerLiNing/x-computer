import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatRunPanel } from './ChatRunPanel';
import type { ChatRunSnapshot } from '@/utils/api';
vi.mock('@/utils/api', () => ({ api: {} }));
vi.mock('@/store/desktopStore', () => ({ useDesktopStore: { getState: () => ({}) } }));
vi.mock('@/appRegistry',()=>({getApp:vi.fn(),setMiniAppsFromApi:vi.fn()}));
const base: ChatRunSnapshot = { id:'run',sessionId:'session',status:'completed',content:'作品正文',artifacts:[],toolCalls:[],updatedAt:1,canResume:false,review:{status:'pending'} };
function render(run:ChatRunSnapshot|null) {return renderToStaticMarkup(<ChatRunPanel run={run} error={null} onStop={()=>{}} onResume={()=>{}} onOpen={()=>{}}/>);}
describe('plain-language assistant controls',()=>{
 it('keeps progress and review in a closed, explicitly opened dialog',()=>{
  const html=render(base);
  expect(html).toContain('aria-haspopup="dialog"');expect(html).toContain('aria-label="进度与成果"');
  expect(html).toContain('aria-label="关闭进度与成果"');
  expect(html).not.toMatch(/<dialog[^>]*\sopen(?:=|\s|>)/);
  expect(html).not.toContain('max-h-[50%]');
 });
 it('keeps the current task stop control available outside the closed panel',()=>{
  const html=render({...base,status:'running',review:undefined});
  expect(html.slice(0,html.indexOf('<dialog'))).toContain('aria-label="停止当前任务"');
 });
 it('shows a pending question with choices and an editable answer, without permitting generic resumption',()=>{
  const html=render({...base,status:'blocked',review:undefined,canResume:false,
    userQuestion:{id:'q',toolCallId:'ask',question:'想写什么结尾？',options:['开心','<script>'],status:'pending'}});
  expect(html).toContain('补充信息');expect(html).toContain('补充你的想法');expect(html).toContain('补充好了，继续做');
  expect(html).toContain('开心');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
  expect(html).not.toContain('>继续做<');
 });
 it('shows the exact pending command and offers only one-time human decisions',()=>{
  const html=render({...base,status:'blocked',review:undefined,shellApproval:{id:'approval',toolCallId:'call',command:'printf "<script>" > copy.txt',workdir:'文档',timeout:5000,workspace:'/private/workspace',executionMode:'host',hash:'hash',expiresAt:Date.now()+60000,status:'pending'}});
  expect(html).toContain('这条命令还没有运行');expect(html).toContain('允许这一次');expect(html).toContain('不执行这条命令');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('>继续做<');
 });
 it('does not promise resumption when an uncertain action requires investigation',()=>{
  const html=render({...base,status:'paused',review:undefined,canResume:false,error:'上次工具执行结果未知，请核实后重新交办。'});
  expect(html).toContain('已停下，请先处理下面的问题');expect(html).not.toContain('想做时可以继续');expect(html).not.toContain('>继续做<');
 });
 it('explains shared-model waiting and keeps the stop action available',()=>{const html=render({...base,status:'running',review:undefined,waitingForModel:true});expect(html).toContain('正在等模型空闲');expect(html).toContain('先停一下');});
 it('identifies the assistant continuation and keeps the source expert available',()=>{
  expect(render({...base,followup:{rootRunId:'root',sourceRunId:'expert',sequence:1,eventKey:'event'}})).toContain('看看专家原稿');
 });
 it('shows received working copies with a direct download action',()=>{
  const html=render({...base,inputFiles:[{name:'材料.bin',path:'agents/a/runs/r/输入/01/data.bin',sourcePath:'资料/data.bin',relativePath:'输入/01/data.bin',size:10,sha256:'digest'}]});
  expect(html).toContain('当时收到的材料副本');expect(html).toContain('查看材料 1：材料.bin');expect(html).toContain('下载材料：材料.bin');
 });
 it('links an original result to its existing revision',()=>{
  expect(render({...base,review:{status:'changes_requested',revisionRunId:'revision',feedback:'改成示例'}})).toContain('查看修改版');
 });
 it('distinguishes equally named files by their contributing expert',()=>{
  const html=render({...base,artifacts:[{path:'a/group.md',name:'group.md',size:1,ownerName:'起草专家'},{path:'b/group.md',name:'group.md',size:1,ownerName:'审核专家'}]});
  expect(html).toContain('起草专家：');expect(html).toContain('审核专家：');
 });
 it('offers direct access to dispatched expert work and identifies its parent handoff',()=>{
  expect(render({...base,review:undefined,artifacts:[],expertRuns:[{id:'expert-run',agentName:'写作专家'}]})).toContain('查看专家：写作专家');
  const child=render({...base,expert:{parentRunId:'parent',agentId:'writer',agentName:'写作专家',depth:1}});
  expect(child).toContain('看看主助手的交办');expect(child).toContain('专家“写作专家”的工作记录');
 });
 it('offers a recorded application as a reviewable result',()=>{
  const html=render({...base,toolCalls:[{id:'created',toolName:'x.create_app',status:'completed',input:{name:'计数器'},output:{ok:true,appId:'counter'}}]});
  expect(html).toContain('打开应用：计数器');expect(html).toContain('满意，完成啦');
 });
 it('offers a clear completion action and keeps the change form closed initially',()=>{
  const html=render(base);expect(html).toContain('满意，完成啦');expect(html).toContain('想改一改');
  expect(html).not.toContain('<textarea');expect(html).toContain('看看文字');expect(html).not.toContain('成果待验收');
 });
 it('does not offer acceptance while work is still running',()=>{
  const html=render({...base,status:'running',review:undefined});expect(html).toContain('先停一下');expect(html).not.toContain('满意，完成啦');
 });
 it('explains continuation and preserves the resume control',()=>{
  expect(render({...base,status:'paused',review:undefined,canResume:true})).toContain('继续做');
 });
 it('keeps the attention entry available before starting a conversation',()=>{
  const html = render(null);
  expect(html).toContain('<details aria-label="我的助手工作台"');
  expect(html).not.toContain('<details open=""');

 });
});


it('shows the bound sending account and escapes its display name', () => {
  const html = render({ ...base, status: 'blocked', review: undefined,
    sendApproval: { id: 'send', toolCallId: 'call', toolName: 'x.send_whatsapp', input: { to: '10000000009', message: '合成测试正文' },
      sender: { accountId: '10000000001@s.whatsapp.net', label: '<script>账号</script>' }, hash: 'hash', status: 'pending', expiresAt: Date.now() + 60000 } });
  expect(html).toContain('发送账号：'); expect(html).toContain('10000000001@s.whatsapp.net');
  expect(html).toContain('&lt;script&gt;账号'); expect(html).not.toContain('<script>'); expect(html).toContain('确认发送这一次');
});
