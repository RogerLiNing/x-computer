import {describe,expect,it} from 'vitest';
import {isAllowedSocketOrigin} from './webSocketServer.js';

describe('development proxy WebSocket origins',()=>{
 const env={NODE_ENV:'development',X_COMPUTER_DEV_ORIGIN:'http://127.0.0.1:3420'};
 it('accepts the exact configured frontend origin without opening every local port',()=>{
  expect(isAllowedSocketOrigin('http://127.0.0.1:3420','127.0.0.1:4420',env)).toBe(true);
  expect(isAllowedSocketOrigin('http://127.0.0.1:3421','127.0.0.1:4420',env)).toBe(false);
  expect(isAllowedSocketOrigin('http://localhost:3420','127.0.0.1:4420',env)).toBe(false);
 });
 it('preserves same-origin and default dev support but ignores dev allowances in production',()=>{
  expect(isAllowedSocketOrigin('https://assistant.example','assistant.example',{NODE_ENV:'production'})).toBe(true);
  expect(isAllowedSocketOrigin('http://127.0.0.1:3000','127.0.0.1:4000',{})).toBe(true);
  expect(isAllowedSocketOrigin(env.X_COMPUTER_DEV_ORIGIN,'127.0.0.1:4420',{...env,NODE_ENV:'production'})).toBe(false);
 });
 it('rejects null, malformed and external configured origins',()=>{
  for(const origin of ['null','invalid','http://127.0.0.1:3420/path','http://user:pass@127.0.0.1:3420'])expect(isAllowedSocketOrigin(origin,'127.0.0.1:4420',env)).toBe(false);
  expect(isAllowedSocketOrigin('https://outside.example','127.0.0.1:4420',{X_COMPUTER_DEV_ORIGIN:'https://outside.example'})).toBe(false);
 });
});
