import {afterEach,expect,it,vi} from 'vitest';
import {backgroundAutostartEnabled} from './backgroundRuntime.js';

afterEach(()=>vi.unstubAllEnvs());
it.each([undefined,'true','false','','0','FALSE','unknown'])('requires a recognized opt-in when the value is present: %s',value=>{
  vi.stubEnv('X_COMPUTER_BACKGROUND_AUTOSTART',value);
  expect(backgroundAutostartEnabled()).toBe(value===undefined||value==='true');
});
