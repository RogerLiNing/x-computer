import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatDraft } from './useChatDraft';
import { shouldSubmitChat } from '@/components/apps/ChatApp/chatHelpers';
const state=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,user:'alice'}));
vi.mock('@/utils/userId',()=>({getUserIdOrNull:()=>state.user||null}));
vi.mock('react',()=>({
 useState:(initial:unknown)=>{const i=state.cursor++;if(!(i in state.slots))state.slots[i]=typeof initial==='function'?initial():initial;return [state.slots[i],(v:unknown)=>{state.slots[i]=v;}];},
 useRef:(initial:unknown)=>{const i=state.cursor++;return state.slots[i]??=( {current:initial});},
 useCallback:(fn:unknown)=>fn,
}));
const render=(session:string|null='one',scene:'chat'|'x'='chat')=>{state.cursor=0;return useChatDraft(session,scene);};
beforeEach(()=>{state.slots=[];state.cursor=0;state.user='alice';const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});});
describe('unsent chat drafts',()=>{
 it('restores typed text after reopening without sending it',()=>{render()[1]('没写完的故事');state.slots=[];expect(render()[0]).toBe('没写完的故事');});
 it('isolates conversations, users and assistant entrances',()=>{
  render()[1]('alice one');render('two')[1]('alice two');expect(render('one')[0]).toBe('alice one');expect(render('one','x')[0]).toBe('');
  state.user='bob';expect(render()[0]).toBe('');state.user='alice';expect(render('two')[0]).toBe('alice two');
 });
 it('applies consecutive updates and clears the consumed draft',()=>{const [,set]=render();set('a');set(previous=>previous+'b');expect(render()[0]).toBe('ab');render()[1]('');state.slots=[];expect(render()[0]).toBe('');});
 it('keeps typing usable when browser storage fails',()=>{vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('full');}});render()[1]('继续写');expect(render()[0]).toBe('继续写');expect(render()[2]).toBe(true);});
 it('does not persist text under a shared anonymous key',()=>{state.user='';render()[1]('临时');state.slots=[];expect(render()[0]).toBe('');});
});
describe('chat submission keys',()=>{
 it('does not send during Chinese composition, legacy composition or Shift+Enter',()=>{
  expect(shouldSubmitChat({key:'Enter',shiftKey:false,nativeEvent:{isComposing:true}})).toBe(false);
  expect(shouldSubmitChat({key:'Enter',shiftKey:false,nativeEvent:{keyCode:229}})).toBe(false);
  expect(shouldSubmitChat({key:'Enter',shiftKey:true,nativeEvent:{}})).toBe(false);
  expect(shouldSubmitChat({key:'Enter',shiftKey:false,nativeEvent:{}})).toBe(true);
 });
});
