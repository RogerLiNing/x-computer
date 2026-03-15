import http from 'http';
import path from 'path';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { createApp } from './app.js';
import type { TaskEvent } from '../../shared/src/index.js';

/**
 * 启动带 WebSocket 的测试用 HTTP 服务器（监听随机端口），供 WS 测试使用
 */
export async function startTestServer(workspaceRoot?: string) {
  const root = workspaceRoot ?? path.join(os.tmpdir(), `x-computer-ws-test-${Date.now()}`);
  const { app, orchestrator, policy, audit, sandboxFS } = await createApp({ workspaceRoot: root });
  await sandboxFS.init();

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(
      JSON.stringify({
        type: 'init',
        data: {
          mode: orchestrator.getMode(),
          tasks: orchestrator.getAllTasks(),
          auditLog: audit.getAll().slice(-50),
        },
      }),
    );
    ws.on('close', () => { clients.delete(ws); });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleWSMessage(ws, msg);
      } catch {
        // ignore
      }
    });
  });

  orchestrator.on('task_event', (event: TaskEvent) => {
    const payload = JSON.stringify({ type: 'task_event', data: event });
    clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
  });

  const originalAuditLog = audit.log.bind(audit);
  audit.log = (entry: Parameters<typeof originalAuditLog>[0]) => {
    originalAuditLog(entry);
    const payload = JSON.stringify({ type: 'audit_entry', data: entry });
    clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
  };

  function handleWSMessage(ws: WebSocket, msg: any) {
    switch (msg.type) {
      case 'create_task':
        orchestrator.createAndRun(msg.data).then((task) => {
          ws.send(JSON.stringify({ type: 'task_created', data: task }));
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
        ws.send(JSON.stringify({ type: 'error', data: { message: `Unknown message type: ${msg.type}` } }));
    }
  }

  function broadcast(msg: any) {
    const payload = JSON.stringify(msg);
    clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
  }

  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as { port: number }).port;

  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => {});
        server.close(() => resolve());
        setTimeout(resolve, 500);
      }),
    orchestrator,
  };
}
