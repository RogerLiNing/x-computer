import type http from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import type {AgentOrchestrator} from './orchestrator/AgentOrchestrator.js';
import type {AuditLogger} from './observability/AuditLogger.js';
import type {SessionAuth} from './auth/sessionAuth.js';
import type {TaskEvent} from '../../shared/src/index.js';
import {setBroadcast,setBroadcastToUser,setBroadcastToAppChannel} from './wsBroadcast.js';

export function redactSocketSecrets(value:unknown):unknown {
  if(Array.isArray(value))return value.map(redactSocketSecrets);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>! /^(apikey|password|pass|privatekey|passphrase|secret|clientsecret|appsecret|secretaccesskey|authorization|accesstoken|refreshtoken|token|bottoken|cookie|setcookie)$/i.test(key.replace(/[-_]/g,''))).map(([key,item])=>[key,redactSocketSecrets(item)]));
  return value;
}

export function isAllowedSocketOrigin(origin:string|undefined,host:string|undefined,env:Record<string,string|undefined>=process.env):boolean{
  if(!origin)return true;
  try{
    const parsed=new URL(origin);if(parsed.origin!==origin)return false;
    if(parsed.host===host)return true;
    if(env.NODE_ENV==='production')return false;
    if(['http://localhost:3000','http://127.0.0.1:3000'].includes(origin))return true;
    const configured=env.X_COMPUTER_DEV_ORIGIN;if(!configured)return false;
    const target=new URL(configured);
    return target.origin===configured&&target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname)&&origin===configured;
  }catch{return false;}
}

export function attachWebSocketServer(server:http.Server, {orchestrator,audit,sessions}:{orchestrator:AgentOrchestrator;audit:AuditLogger;sessions:SessionAuth}) {
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 262144 });

/** 已连接的客户端，关联 userId 与订阅的小程序通道 */
interface ClientInfo {
  ws: WebSocket;
  token?: string;
  userId?: string;
  /** 已订阅的小程序 appId 集合（用于 app_channel 推送） */
  subscribedAppIds: Set<string>;
  cookie?:string;
  pendingSends:number;
  sendQueue:Promise<void>;
}
const clients = new Set<ClientInfo>();
const revoked=(token:string)=>{for(const client of clients)if(client.token===token)client.ws.close(1008,'Logged out');};
const credentialsChanged=(userId:string)=>{for(const client of clients)if(client.userId===userId)client.ws.close(1008,'Credentials changed');};
sessions.on('revoked',revoked);sessions.on('credentials_changed',credentialsChanged);
wss.once('close',()=>{sessions.off('revoked',revoked);sessions.off('credentials_changed',credentialsChanged);});

wss.on('connection', (ws, request) => {
  const info: ClientInfo = { ws, subscribedAppIds: new Set(),cookie:request.headers.cookie,pendingSends:0,sendQueue:Promise.resolve() };
  const sessionReady = sessions.authenticate(request.headers.cookie).then((session: {userId:string;expiresAt:number;token:string}|null)=>{
    const origin=request.headers.origin;
    const allowedOrigin = isAllowedSocketOrigin(origin,request.headers.host);
    if(!session || !allowedOrigin){ws.close(1008,'Login required');return false;}
    info.userId=session.userId;info.token=session.token;clients.add(info);
    const expiry=setTimeout(()=>ws.close(1008,'Session expired'),Math.max(0,session.expiresAt-Date.now()));expiry.unref();ws.once('close',()=>clearTimeout(expiry));return true;
  }).catch(()=>{ws.close(1011,'Authentication unavailable');return false;});
  console.log(`[WS] Client connected (total: ${clients.size})`);

  // 注意：不在此处发送 init，等待 auth 后再发送（避免泄露其他用户数据）

  ws.on('close', () => {
    clients.delete(info);
    console.log(`[WS] Client disconnected (total: ${clients.size})`);
  });

  ws.on('message', async (raw) => {
    if(!await sessionReady)return;
    try{if(!await sessions.authenticate(request.headers.cookie)){ws.close(1008,'Session expired');return;}}catch{ws.close(1011,'Authentication unavailable');return;}
    try {
      const msg = JSON.parse(raw.toString());
      handleWSMessage(info, msg);
    } catch (err) {
      console.error('[WS] Invalid message:', err);
    }
  });
});

function sendAuthorized(client:ClientInfo,payload:string){
  if(client.ws.readyState!==WebSocket.OPEN)return;
  // Keep ordering and bound queued work while rechecking revocations on every push.
  if(client.pendingSends>=64||client.ws.bufferedAmount>1048576){client.ws.close(1013,'Slow connection');return;}
  client.pendingSends++;
  client.sendQueue=client.sendQueue.then(async()=>{
    if(client.ws.readyState!==WebSocket.OPEN)return;
    const session=await sessions.authenticate(client.cookie);
    if(!session||session.userId!==client.userId||session.token!==client.token){client.ws.close(1008,'Session expired');return;}
    if(client.ws.readyState===WebSocket.OPEN)client.ws.send(payload,error=>{if(error)client.ws.close(1011,'Delivery unavailable');});
  }).catch(()=>client.ws.close(1011,'Authentication unavailable')).finally(()=>{client.pendingSends--;});
}

orchestrator.on('task_event', (event: TaskEvent) => {
  const payload = JSON.stringify(redactSocketSecrets({ type: 'task_event', data: event }));
  for (const client of clients) {
    if (client.userId && client.userId === orchestrator.getTask(event.taskId)?.metadata?.userId && client.ws.readyState === WebSocket.OPEN) {
      sendAuthorized(client,payload);
    }
  }
});

const originalAuditLog = audit.log.bind(audit);
audit.log = (entry) => {
  originalAuditLog(entry);
  const payload = JSON.stringify(redactSocketSecrets({ type: 'audit_entry', data: entry }));
  for (const client of clients) {
    if (client.userId && client.userId === orchestrator.getTask(entry.taskId)?.metadata?.userId && client.ws.readyState === WebSocket.OPEN) {
      sendAuthorized(client,payload);
    }
  }
};

function handleWSMessage(client: ClientInfo, msg: any) {
  switch (msg.type) {
    case 'auth':
      // 客户端发送 userId 关联连接
      if (msg.data?.userId === client.userId) {
        console.log(`[WS] Client authenticated as: ${client.userId}`);
        // 发送 init 数据（仅该用户的任务）
        const allTasks = orchestrator.getAllTasks();
        const userTasks = client.userId !== 'anonymous'
          ? allTasks.filter((t) => (t.metadata as { userId?: string } | undefined)?.userId === client.userId)
          : allTasks;
        sendAuthorized(client,
          JSON.stringify(redactSocketSecrets({
            type: 'init',
            data: {
              tasks: userTasks,
              auditLog: audit.getAll().filter(entry=>orchestrator.getTask(entry.taskId)?.metadata?.userId===client.userId).slice(-50),
            },
          })),
        );
      }
      break;

    case 'subscribe_app':
      if (msg.data?.appId && typeof msg.data.appId === 'string') {
        client.subscribedAppIds.add(String(msg.data.appId).trim());
      }
      break;

    case 'unsubscribe_app':
      if (msg.data?.appId && typeof msg.data.appId === 'string') {
        client.subscribedAppIds.delete(String(msg.data.appId).trim());
      }
      break;

    case 'pause_task':
      if(orchestrator.getTask(msg.data?.taskId)?.metadata?.userId===client.userId)void Promise.resolve(orchestrator.pauseTask(msg.data.taskId)).catch(()=>sendAuthorized(client,JSON.stringify({type:'error',data:{message:'停止未完成，请重试'}})));
      break;

    case 'resume_task':
      // resumeTask removed - step-based task system deprecated
      break;

    case 'set_computer_context':
      if (client.userId && msg.data && typeof msg.data.timestamp === 'number') {
        orchestrator.setComputerContext(msg.data, client.userId);
      }
      break;

    default:
      sendAuthorized(client,JSON.stringify({ type: 'error', data: { message: `Unknown message type: ${msg.type}` } }));
  }
}

function broadcast(msg: any) {
  const userId=msg?.data?.userId;
  if(typeof userId!=='string')return;
  for(const client of clients)if(client.userId===userId&&client.ws.readyState===WebSocket.OPEN)sendAuthorized(client,JSON.stringify(msg));
}

// 供路由等模块向所有客户端广播（如编辑器 Agent 流式输出）
setBroadcast(broadcast);

// 按用户推送（主脑 X 主动找用户时用）
setBroadcastToUser((userId, msg) => {
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      sendAuthorized(client,payload);
    }
  }
});

// 向已订阅某小程序的用户连接推送（X 工具 backend.broadcast_to_app 调用）
setBroadcastToAppChannel((userId, appId, message) => {
  const payload = JSON.stringify({ type: 'app_channel', data: { appId, message } });
  for (const client of clients) {
    if (
      client.userId === userId &&
      client.subscribedAppIds.has(appId) &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      sendAuthorized(client,payload);
    }
  }
});


return wss;
}
