import {describe,it,expect,vi} from 'vitest';import http from 'node:http';import {EventEmitter} from 'node:events';import WebSocket from 'ws';
import {attachWebSocketServer,redactSocketSecrets} from './webSocketServer.js';import {SessionAuth} from './auth/sessionAuth.js';import {AuditLogger} from './observability/AuditLogger.js';
import type {AgentOrchestrator} from './orchestrator/AgentOrchestrator.js';
import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from './db/database.js';
async function setup(override?:SessionAuth){const rows=new Map();const sessions=override??new SessionAuth({getConfig:async(u,k)=>rows.get(u+k),setConfig:async(u,k,v)=>{rows.set(u+k,v);}});const tasks=[{id:'a',metadata:{userId:'alice'}},{id:'b',metadata:{userId:'bob'}}];const orchestrator=Object.assign(new EventEmitter(),{getAllTasks:()=>tasks,getTask:(id:string)=>tasks.find(t=>t.id===id),pauseTask:vi.fn(),setComputerContext:vi.fn()});const audit=new AuditLogger();const server=http.createServer();const wss=attachWebSocketServer(server,{sessions,orchestrator:orchestrator as unknown as AgentOrchestrator,audit});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;const sockets:WebSocket[]=[];
const connect=async(user?:string,origin?:string)=>{const cookie=user?await sessions.createCookie(user):undefined;const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,{headers:{...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})}});sockets.push(ws);await new Promise<void>((r,j)=>{ws.once('open',()=>r());ws.once('error',j);});return {ws,cookie};};
return {sessions,orchestrator,audit,connect,close:async()=>{sockets.forEach(w=>w.terminate());await new Promise<void>(r=>wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));}};}
const message=(ws:WebSocket)=>new Promise<any>(r=>ws.once('message',d=>r(JSON.parse(d.toString()))));
describe('production WebSocket authentication and isolation',()=>{
 it('blocks outgoing private data after another service instance changes the credentials',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'ws-reset-')),first=new SqliteAppDatabase(root),second=new SqliteAppDatabase(root),a=new SqliteDatabaseAdapter(first),b=new SqliteDatabaseAdapter(second);
  await a.ensureUser('alice');await a.createAuthAccount('alice@example.test','old-fixture-hash','alice');
  const one=new SessionAuth(a),two=new SessionAuth(b),s=await setup(two);
  try{
   const {ws,cookie}=await s.connect('alice'),init=message(ws);ws.send(JSON.stringify({type:'auth',data:{userId:'alice'}}));await init;
   const received:any[]=[];ws.on('message',data=>received.push(JSON.parse(data.toString())));
   await a.run('UPDATE auth_accounts SET password_hash=? WHERE user_id=?',['new-fixture-hash','alice']);one.credentialsChanged('alice');expect(await two.authenticate(cookie)).toBeNull();
   const closed=new Promise<number>(resolve=>ws.once('close',resolve));s.orchestrator.emit('task_event',{taskId:'a',type:'status_change',data:{privateValue:'AFTER_RESET'}});
   expect(await closed).toBe(1008);expect(received).toEqual([]);
  }finally{await s.close();first.close();second.close();}
 });
 it('authenticates the configured local frontend and rejects another origin even with a valid cookie',async()=>{
  vi.stubEnv('X_COMPUTER_DEV_ORIGIN','http://127.0.0.1:3420');const s=await setup();
  try{const {ws:allowed}=await s.connect('alice','http://127.0.0.1:3420'),init=message(allowed);allowed.send(JSON.stringify({type:'auth',data:{userId:'alice'}}));expect((await init).type).toBe('init');
   const {ws:rejected}=await s.connect('alice','http://127.0.0.1:3421');expect(await new Promise<number>(resolve=>rejected.once('close',resolve))).toBe(1008);
  }finally{await s.close();vi.unstubAllEnvs();}
 });
 it('removes nested credential field variants while retaining normal progress data',()=>{
  const value={status:'running',metadata:{llmConfig:{providerId:'provider',api_key:'model-secret'},headers:{Authorization:'bearer-secret',Cookie:'session-secret'}},output:[{client_secret:'oauth-secret',refresh_token:'refresh-secret',pass:'mail-secret',name:'result'}]};
  expect(redactSocketSecrets(value)).toEqual({status:'running',metadata:{llmConfig:{providerId:'provider'},headers:{}},output:[{name:'result'}]});
 });
 it('closes unauthenticated sockets',async()=>{const s=await setup();try{const {ws}=await s.connect();const code=await new Promise<number>(r=>ws.once('close',r));expect(code).toBe(1008);}finally{await s.close();}});
 it('sends only owned init and task events, and refuses a foreign pause',async()=>{const s=await setup();try{const {ws:a}=await s.connect('alice');const first=message(a);a.send(JSON.stringify({type:'auth',data:{userId:'alice'}}));expect((await first).data.tasks.map((t:any)=>t.id)).toEqual(['a']);const {ws:b}=await s.connect('bob');const bMessages:any[]=[];b.on('message',d=>bMessages.push(JSON.parse(d.toString())));const event=message(a);s.orchestrator.emit('task_event',{taskId:'a',type:'status_change',data:{}});expect((await event).data.taskId).toBe('a');b.send(JSON.stringify({type:'pause_task',data:{taskId:'a'}}));await new Promise(r=>setTimeout(r,30));expect(s.orchestrator.pauseTask).not.toHaveBeenCalled();expect(bMessages).toEqual([]);}finally{await s.close();}});
 it('closes matching sockets on logout revocation',async()=>{const s=await setup();try{const {ws,cookie}=await s.connect('alice');const init=message(ws);ws.send(JSON.stringify({type:'auth',data:{userId:'alice'}}));await init;const closed=new Promise<number>(r=>ws.once('close',r));await s.sessions.logout({headers:{cookie}} as any,{append:()=>{}} as any);expect(await closed).toBe(1008);}finally{await s.close();}});
});
