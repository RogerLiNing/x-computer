import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createComputerRouter} from './computer.js';
import {userContextMiddleware} from '../middleware/userContext.js';

describe('computer boundary',()=>{
 let server:Server;
 afterEach(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
 async function setup(enabled=true){
  const request=vi.fn(async(userId:string,actor:string,input:Record<string,unknown>)=>({holder:actor,userId,action:input.action}));
  const approveUpload=vi.fn(async()=>({provided:true}));
  const app=express();app.use(express.json());
  app.locals.sessions={authenticate:async(cookie?:string)=>cookie==='valid'?{userId:'owner'}:null};
  app.use('/api',userContextMiddleware(false));
  app.use('/api/computer',createComputerRouter(enabled?{request,approveUpload}:undefined));
  server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/computer`;
  const post=(body:unknown,cookie='valid',headers:Record<string,string>={})=>fetch(base+'/action',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify(body)});
  return {request,approveUpload,post,base};
 }
 it('requires a verified session and rejects an ownership mismatch',async()=>{
  const {post,request}=await setup();expect((await post({action:'start'},'')).status).toBe(401);
  expect((await post({action:'start'},'valid',{'X-User-Id':'other'})).status).toBe(403);expect(request).not.toHaveBeenCalled();
 });
 it('derives actor and owner from the server, never the payload',async()=>{
  const {post,request}=await setup();const response=await post({action:'take',actor:'agent',userId:'other'});
  expect(response.status).toBe(200);expect(request).toHaveBeenCalledWith('owner','human',expect.anything());expect(response.headers.get('Cache-Control')).toBe('no-store');
 });
 it('reports disabled capability honestly and refuses execution',async()=>{
  const {base,post,request}=await setup(false);expect(await (await fetch(base+'/status',{headers:{Cookie:'valid'}})).json()).toEqual({available:false});
  expect((await post({action:'start'})).status).toBe(503);expect(request).not.toHaveBeenCalled();
 });
 it('keeps downloaded-file delivery under the verified owner identity',async()=>{
  const {post,request}=await setup();expect((await post({action:'present_download',id:'download',userId:'other',path:'../profile'})).status).toBe(200);
  expect(request).toHaveBeenCalledWith('owner','human',expect.objectContaining({action:'present_download',id:'download'}));
 });
 it('rejects unsupported operations before entering the container',async()=>{
  const {post,request}=await setup();expect((await post({action:'eval',script:'x'})).status).toBe(400);expect(request).not.toHaveBeenCalled();
 });
 it('binds upload decisions to the authenticated user and ignores supplied file metadata',async()=>{
  const {post,request,approveUpload}=await setup();expect((await post({action:'upload_decision',id:'request',decision:'approve',userId:'other',path:'private'})).status).toBe(200);
  expect(approveUpload).toHaveBeenCalledWith('owner','request');expect(request).not.toHaveBeenCalled();
  expect((await post({action:'upload_decision',id:'request',decision:'reject'})).status).toBe(200);
  expect(request).toHaveBeenCalledWith('owner','human',{action:'upload_reject',id:'request'});
 });

});
