import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/utils/api',()=>({api:{markXProactiveMessageRead:vi.fn(async()=>({success:true}))}}));
import {useConnectionStore} from './connectionStore';
afterEach(()=>useConnectionStore.setState({xProactiveMessages:[]}));
it('preserves read state when the same batch contains mixed duplicate states',()=>{
 const message={id:'same-batch',content:'完成',type:'info',createdAt:1};
 useConnectionStore.getState().setXProactiveMessages([{...message,read:true},{...message,read:false}]);
 expect(useConnectionStore.getState().xProactiveMessages).toEqual([{...message,read:true}]);
});
it('deduplicates replayed notices and preserves their read state',()=>{
 const store=useConnectionStore.getState(),message={id:'durable-notice',content:'完成',type:'info',createdAt:1};
 store.addXProactiveMessage(message);store.markXProactiveRead(message.id);store.addXProactiveMessage({...message,read:false});
 expect(useConnectionStore.getState().xProactiveMessages).toEqual([{...message,read:true}]);
 store.setXProactiveMessages([{...message,read:false},{...message,read:false}]);expect(useConnectionStore.getState().xProactiveMessages).toEqual([{...message,read:true}]);
 store.addXProactiveMessage({...message,id:'different'});expect(useConnectionStore.getState().xProactiveMessages).toHaveLength(2);
});
