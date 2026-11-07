import {describe,it,expect,vi,afterEach} from 'vitest';
import {XComputerClient} from '../../../packages/sdk/js/src/client.js';
afterEach(()=>vi.unstubAllGlobals());
describe('SDK server sessions',()=>{
 it('retains each client cookie separately and sends it on later requests',async()=>{
  const calls:Array<{url:string;headers:Record<string,string>}>=[];
  vi.stubGlobal('fetch',async(url:string,options:RequestInit)=>{calls.push({url,headers:options.headers as Record<string,string>});return url.endsWith('/login')?new Response(JSON.stringify({userId:'alice'}),{headers:{'set-cookie':'x_session=alice.opaque; HttpOnly; Path=/'}}):new Response(JSON.stringify({allowRegister:true}));});
  const alice=new XComputerClient();const other=new XComputerClient({userId:'bob'});
  await alice.login('test@example.test','test-password','captcha','answer');await alice.getAuthSettings();
  // Public settings need no identity; the explicit logout must carry and then clear the private session.
  await alice.logout();expect(calls.at(-1)?.headers.Cookie).toBe('x_session=alice.opaque');expect(alice.getUserId()).toBeUndefined();
  await other.logout();expect(calls.at(-1)?.headers.Cookie).toBeUndefined();
 });
});
