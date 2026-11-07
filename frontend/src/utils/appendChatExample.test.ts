import {describe,expect,it} from 'vitest';
import {appendChatExample} from './appendChatExample';
describe('examples remain editable drafts',()=>{
 it('fills an empty draft',()=>{expect(appendChatExample('','故事')).toBe('故事');});
 it('preserves the exact existing draft',()=>{expect(appendChatExample('还没写完\n','故事')).toBe('还没写完\n\n\n故事');});
});
