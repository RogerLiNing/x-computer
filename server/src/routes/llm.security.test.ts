import express from 'express';import request from 'supertest';import http from 'node:http';import type {AddressInfo} from 'node:net';
import {afterEach,describe,it,expect,vi} from 'vitest';import{createLLMRouter}from'./llm.js';
const state=vi.hoisted(()=>({url:'',apiKey:'server-private-key'}));
vi.mock('../config/defaultConfig.js',()=>({loadDefaultConfig:()=>({llm_config:{providers:[{id:'preset',name:'preset',baseUrl:state.url,apiKey:state.apiKey}],defaultByModality:{chat:{providerId:'preset',modelId:'model'}}}})}));
describe('model imports never proxy user URLs into the private network',()=>{
 const servers:http.Server[]=[];afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));});
 function app(){const app=express();app.use(express.json());app.use((req,_res,next)=>{req.userId='owner';next();});app.use(createLLMRouter());return app;}
 async function server(handler:(req:http.IncomingMessage,res:http.ServerResponse)=>void){const srv=http.createServer(handler);servers.push(srv);await new Promise<void>(resolve=>srv.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;}
 it('rejects private raw URLs without issuing a request',async()=>{
  let calls=0;const url=await server((_req,res)=>{calls++;res.end('{"data":[]}');});
  const response=await request(app()).post('/import-models').send({baseUrl:url,apiKey:'user-key'});
  expect(response.status).toBe(500);expect(calls).toBe(0);
 });
 it('binds server credentials to their configured provider endpoint, ignoring injected URL or key',async()=>{
  const seen:string[]=[];state.url=await server((req,res)=>{seen.push(req.headers.authorization??'');res.setHeader('content-type','application/json');res.end('{"data":[{"id":"real-model"}]}');});
  const response=await request(app()).post('/import-models').send({providerId:'preset',baseUrl:'http://169.254.169.254/private',apiKey:'attacker-key'});
  expect(response.status).toBe(200);expect(response.body.models).toEqual([{id:'real-model'}]);expect(seen).toEqual(['Bearer server-private-key']);expect(response.text).not.toContain(state.apiKey);
 });
 it('does not follow a redirect even from an administrator preset',async()=>{
  let destination=0;const sink=await server((_req,res)=>{destination++;res.end('{"data":[]}');});
  state.url=await server((_req,res)=>{res.writeHead(302,{location:sink+'/models'});res.end();});
  expect((await request(app()).post('/import-models').send({providerId:'preset'})).status).toBe(500);expect(destination).toBe(0);
 });
});
