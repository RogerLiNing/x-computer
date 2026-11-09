import {backgroundAutostartEnabled} from './config/backgroundRuntime.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateIsolatedRuntime } from './config/isolatedRuntime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.X_COMPUTER_ISOLATED === '1') validateIsolatedRuntime();
else dotenv.config({ path: path.join(__dirname, '..', '.env') });

import './setTz.js';
import http from 'http';


import { createApp } from './app.js';

import { attachWebSocketServer } from './webSocketServer.js';
import { createUpgradeRouter } from './nodes/index.js';
import { loadMcpAndRegister } from './mcp/loadAndRegister.js';
import { initServerManager } from './server/ServerManager.js';

// ── Create app and server ────────────────────────────────────
// 可通过 X_COMPUTER_WORKSPACE 指定工作区根目录（含 memory/），未设置则用系统临时目录
const workspaceRoot = process.env.X_COMPUTER_WORKSPACE
  ? path.resolve(process.env.X_COMPUTER_WORKSPACE)
  : undefined;

const requireLogin = process.env.X_COMPUTER_REQUIRE_LOGIN !== 'false';

// 顶层 await（Node.js 支持 ES modules 顶层 await）
const { app, orchestrator, audit, sandboxFS, db, plugins, nodes } = await createApp({
  ...(workspaceRoot ? { workspaceRoot } : {}),
  allowAnonymous: !requireLogin,
});

// 初始化服务器管理器
initServerManager(db);

const server = http.createServer(app);
const upgrades = createUpgradeRouter(server);
attachWebSocketServer(server,{orchestrator,audit,sessions:app.locals.sessions,upgrades});
if (nodes) upgrades.register(nodes.gateway.path, nodes.gateway.handleUpgrade);

// ── Start ──────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4000');

async function start() {
  await sandboxFS.init();
  console.log(`[FS] Sandbox workspace: ${sandboxFS.getRoot()}`);

  if (plugins.isEnabled('mcp') && backgroundAutostartEnabled()) {
    await loadMcpAndRegister(orchestrator, workspaceRoot).catch((err) => {
      console.warn('[MCP] 加载或注册失败（可忽略）:', err?.message ?? err);
    });
  }

  server.listen({ port: PORT, ...(process.env.HOST ? { host: process.env.HOST } : {}) }, () => {
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
║    工具数量: ${String(orchestrator.getTools().length).padEnd(10)}                       ║
║    运行档位: ${plugins.profile.padEnd(10)}                       ║
║    多用户隔离: ✅                                  ║
║    云端持久化: ✅ (${db.getDialect() === 'mysql' ? 'MySQL' : 'SQLite'})                        ║
║                                                  ║
╚══════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);
