import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {useReminderMessages,mergeConcurrentReminders} from './useReminderMessages';
const hooks=vi.hoisted(()=>({slots:[] as any[],cursor:0,effects:[] as Array<()=>void>,cleanups:new Map<number,()=>void>()}));
vi.mock('react',()=>({
 useRef(value:unknown){const i=hooks.cursor++;return hooks.slots[i]??={current:value};},
 useEffect(effect:()=>void|(()=>void),deps:unknown[]){const i=hooks.cursor++;if(hooks.slots[i]&&deps.every((dep,j)=>dep===hooks.slots[i][j]))return;hooks.slots[i]=deps;hooks.effects.push(()=>{hooks.cleanups.get(i)?.();const cleanup=effect();if(cleanup)hooks.cleanups.set(i,cleanup);else hooks.cleanups.delete(i);});},
}));
let arrivals:{current:Map<string,number>};const received=vi.fn();
const render=(session='source',busy=false)=>{hooks.cursor=0;useReminderMessages(session,busy,received,arrivals);hooks.effects.splice(0).forEach(effect=>effect());};
const message={id:'a'.repeat(32),content:'⏰ 整理书包',timestamp:1};
const send=(sessionId='source')=>window.dispatchEvent(new CustomEvent('x:reminder-arrived',{detail:{sessionId,message}}));
beforeEach(()=>{hooks.slots=[];hooks.cursor=0;hooks.effects=[];hooks.cleanups.clear();vi.clearAllMocks();arrivals={current:new Map()};vi.stubGlobal('window',new EventTarget());});
afterEach(()=>{hooks.cleanups.forEach(cleanup=>cleanup());vi.unstubAllGlobals();});

describe('live reminder messages',()=>{
 it('defers reminders during an in-flight reply and deduplicates retransmission',()=>{
  render('source',true);send();send();expect(received).not.toHaveBeenCalled();render('source',false);expect(received).toHaveBeenCalledTimes(1);expect(received).toHaveBeenCalledWith(message);send();expect(received).toHaveBeenCalledTimes(1);
 });
 it('does not append another conversation reminder or an old pending reminder after switching',()=>{
  render('source',true);send();render('different',false);expect(received).not.toHaveBeenCalled();send();expect(received).not.toHaveBeenCalled();
 });
 it('ignores oversized realtime payloads',()=>{
  render();window.dispatchEvent(new CustomEvent('x:reminder-arrived',{detail:{sessionId:'source',message:{...message,content:'a'.repeat(16001)}}}));expect(received).not.toHaveBeenCalled();
 });
 it('preserves concurrent arrivals without resurrecting an older deleted reminder',()=>{
  const old={id:'old'},fresh={id:'fresh'},server={id:'server'};
  expect(mergeConcurrentReminders([old,fresh],[server],new Map([['old',5],['fresh',20]]),10)).toEqual([server,fresh]);
  expect(mergeConcurrentReminders([fresh],[server,fresh],new Map([['fresh',20]]),10)).toEqual([server,fresh]);
 });
});
