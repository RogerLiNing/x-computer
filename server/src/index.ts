import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import './setTz.js';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

import { createApp } from './app.js';
import type { TaskEvent } from '../../shared/src/index.js';
import { setBroadcast, setBroadcastToUser, setBroadcastToAppChannel } from './wsBroadcast.js';
import { loadMcpAndRegister } from './mcp/loadAndRegister.js';
import { initServerManager } from './server/ServerManager.js';

// ── Create app and server ────────────────────────────────────
// 可通过 X_COMPUTER_WORKSPACE 指定工作区根目录（含 memory/），未设置则用系统临时目录
const workspaceRoot = process.env.X_COMPUTER_WORKSPACE
  ? path.resolve(process.env.X_COMPUTER_WORKSPACE)
  : undefined;

const requireLogin = process.env.X_COMPUTER_REQUIRE_LOGIN !== 'false';

// 顶层 await（Node.js 支持 ES modules 顶层 await）
const { app, orchestrator, policy, audit, sandboxFS, db } = await createApp({
  ...(workspaceRoot ? { workspaceRoot } : {}),
  allowAnonymous: !requireLogin,
});

// 初始化服务器管理器
initServerManager(db);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** 已连接的客户端，关联 userId 与订阅的小程序通道 */
interface ClientInfo {
  ws: WebSocket;
  userId?: string;
  /** 已订阅的小程序 appId 集合（用于 app_channel 推送） */
  subscribedAppIds: Set<string>;
}
const clients = new Set<ClientInfo>();

wss.on('connection', (ws) => {
  const info: ClientInfo = { ws, subscribedAppIds: new Set() };
  clients.add(info);
  console.log(`[WS] Client connected (total: ${clients.size})`);

  // 注意：不在此处发送 init，等待 auth 后再发送（避免泄露其他用户数据）

  ws.on('close', () => {
    clients.delete(info);
    console.log(`[WS] Client disconnected (total: ${clients.size})`);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleWSMessage(info, msg);
    } catch (err) {
      console.error('[WS] Invalid message:', err);
    }
  });
});

orchestrator.on('task_event', (event: TaskEvent) => {
  const payload = JSON.stringify({ type: 'task_event', data: event });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
});

const originalAuditLog = audit.log.bind(audit);
audit.log = (entry) => {
  originalAuditLog(entry);
  const payload = JSON.stringify({ type: 'audit_entry', data: entry });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
};

function handleWSMessage(client: ClientInfo, msg: any) {
  switch (msg.type) {
    case 'auth':
      // 客户端发送 userId 关联连接
      if (msg.data?.userId && typeof msg.data.userId === 'string') {
        client.userId = msg.data.userId;
        console.log(`[WS] Client authenticated as: ${client.userId}`);
        // 发送 init 数据（仅该用户的任务）
        const allTasks = orchestrator.getAllTasks();
        const userTasks = client.userId !== 'anonymous'
          ? allTasks.filter((t) => (t.metadata as { userId?: string } | undefined)?.userId === client.userId)
          : allTasks;
        client.ws.send(
          JSON.stringify({
            type: 'init',
            data: {
              mode: orchestrator.getMode(),
              tasks: userTasks,
              auditLog: audit.getAll().slice(-50),
            },
          }),
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

    case 'create_task':
      orchestrator.createAndRun(msg.data, client.userId).then((task) => {
        client.ws.send(JSON.stringify({ type: 'task_created', data: task }));
      });
      break;

    case 'set_mode':
      orchestrator.setMode(msg.data.mode);
      broadcast({ type: 'mode_changed', data: { mode: msg.data.mode } });
      break;

    case 'pause_task':
      orchestrator.pauseTask(msg.data.taskId);
      break;

    case 'resume_task':
      orchestrator.resumeTask(msg.data.taskId);
      break;

    case 'approve_step':
      orchestrator.approveStep(msg.data.taskId, msg.data.stepId);
      break;

    case 'reject_step':
      orchestrator.rejectStep(msg.data.taskId, msg.data.stepId);
      break;

    case 'set_computer_context':
      if (msg.data && typeof msg.data.timestamp === 'number') {
        orchestrator.setComputerContext(msg.data);
      }
      break;

    default:
      client.ws.send(JSON.stringify({ type: 'error', data: { message: `Unknown message type: ${msg.type}` } }));
  }
}

function broadcast(msg: any) {
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

// 供路由等模块向所有客户端广播（如编辑器 Agent 流式输出）
setBroadcast(broadcast);

// 按用户推送（主脑 X 主动找用户时用）
setBroadcastToUser((userId, msg) => {
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
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
      client.ws.send(payload);
    }
  }
});

// ── Start ──────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4000');

async function start() {
  await sandboxFS.init();
  console.log(`[FS] Sandbox workspace: ${sandboxFS.getRoot()}`);

  await loadMcpAndRegister(orchestrator, workspaceRoot).catch((err) => {
    console.warn('[MCP] 加载或注册失败（可忽略）:', err?.message ?? err);
  });

  server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║                                                  ║
║    X-Computer Server v0.1.0                      ║
║    AI 自主电脑系统 — 后端服务                      ║
║                                                  ║
║    HTTP API:    http://localhost:${PORT}/api        ║
║    WebSocket:   ws://localhost:${PORT}/ws           ║
║    Workspace:   ${sandboxFS.getRoot().slice(0, 30).padEnd(30)}  ║
║                                                  ║
║    执行模式: ${orchestrator.getMode().padEnd(10)}                       ║
║    工具数量: ${String(orchestrator.getTools().length).padEnd(10)}                       ║
║    策略规则: ${String(policy.getRules().length).padEnd(10)}                       ║
║    多用户隔离: ✅                                  ║
║    云端持久化: ✅ (${db.getDialect() === 'mysql' ? 'MySQL' : 'SQLite'})                        ║
║                                                  ║
╚══════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);
