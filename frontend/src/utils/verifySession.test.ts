import {describe,it,expect} from 'vitest';import {verifySession} from './verifySession';import {ApiError} from './api';
describe('session verification during service interruptions',()=>{
 it('uses only the server-verified identity',async()=>{expect(await verifySession(async()=>({id:'verified-user',email:'test@example.test'}))).toEqual({status:'logged-in',userId:'verified-user'});});
 it.each([401,403])('requires sign-in for an authoritative auth rejection %s',async status=>{expect(await verifySession(async()=>{throw new ApiError('rejected',status);})).toEqual({status:'logged-out'});});
 it.each([429,500,502,503])('keeps service failure %s distinct from logout',async status=>{expect(await verifySession(async()=>{throw new ApiError('service failed',status);})).toEqual({status:'unavailable'});});
 it('does not infer a session from a network failure or timeout',async()=>{for(const error of [new TypeError('fetch failed'),new DOMException('timeout','AbortError')])expect(await verifySession(async()=>{throw error;})).toEqual({status:'unavailable'});});
 it('accepts a server-authenticated account without an email address',async()=>{expect(await verifySession(async()=>({id:'oauth-user',email:null}))).toEqual({status:'logged-in',userId:'oauth-user'});});
 it('rejects malformed successful responses and still requires login for anonymous accounts',async()=>{expect(await verifySession(async()=>({id:'anonymous',email:null}))).toEqual({status:'logged-out'});expect(await verifySession(async()=>null as never)).toEqual({status:'unavailable'});});
});
