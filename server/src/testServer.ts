import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {createApp} from './app.js';
import {attachWebSocketServer} from './webSocketServer.js';

/** Test listeners use the same authenticated WebSocket implementation as production. */
export async function startTestServer(workspaceRoot?:string){
 const result=await createApp({workspaceRoot:workspaceRoot??path.join(os.tmpdir(),`x-ws-${Date.now()}`),databaseType:'sqlite',allowAnonymous:false});
 await result.sandboxFS.init();const server=http.createServer(result.app);
 const wss=attachWebSocketServer(server,{orchestrator:result.orchestrator,audit:result.audit,sessions:result.app.locals.sessions});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,port:(server.address() as {port:number}).port,orchestrator:result.orchestrator,
 createCookie:(id:string)=>result.app.locals.sessions.createCookie(id),
 close:async()=>{wss.clients.forEach(ws=>ws.terminate());await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));result.heartbeatService.stop();await result.db.close();}};
}
