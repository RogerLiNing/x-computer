import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { AppDatabase } from '../db/database.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import {
  getMcpStatus,
  loadMcpConfig,
  saveMcpConfig,
  reloadMcpAndRegister,
  getMcpConfigPath,
  normalizeMcpConfig,
  loadMcpAndRegisterForUser,
} from '../mcp/loadAndRegister.js';
import { listTools } from '../mcp/client.js';
import { searchMcpRegistry } from '../mcp/registry.js';
import type { McpServerConfig } from '../mcp/types.js';
import { loadDefaultConfig } from '../config/defaultConfig.js';

export function createMcpRouter(
  orchestrator: AgentOrchestrator,
  sandboxFS: SandboxFS,
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
): Router {
  const router = Router();

  /** MCP 状态：已加载的服务器与工具数（配置见文档 MCP 配置） */
  router.get('/mcp/status', (_req, res) => {
    const status = getMcpStatus();
    res.json(status ?? { servers: [], totalTools: 0 });
  });

  /** MCP 配置：获取当前配置（按用户隔离：有 userId 时优先用云端 db，与运行时一致，保证 headers 等不丢失） */
  router.get('/mcp/config', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const workspaceRoot =
        userSandboxManager && userId && userId !== 'anonymous'
          ? userSandboxManager.getUserWorkspaceRoot(userId)
          : sandboxFS.getRoot();
      let servers: Awaited<ReturnType<typeof loadMcpConfig>>;
      if (db && userId && userId !== 'anonymous') {
        const fromDb = await db.getConfig(userId, 'mcp_config');
        if (fromDb?.trim()) {
          try {
            const parsed = JSON.parse(fromDb) as unknown;
            servers = normalizeMcpConfig(
              Array.isArray(parsed) ? { servers: parsed } : typeof parsed === 'object' && parsed !== null ? parsed : {},
            );
            if (servers.length > 0) {
              const configPath = getMcpConfigPath(workspaceRoot);
              return res.json({ servers, configPath, fromEnv: false });
            }
          } catch (_) {
            /* 解析失败则回退到文件 */
          }
        }
      }
      servers = await loadMcpConfig(workspaceRoot);
      if (servers.length === 0) {
        const defaults = loadDefaultConfig()?.mcp_servers;
        if (defaults) {
          const raw = Array.isArray(defaults) ? { servers: defaults } : typeof defaults === 'object' && defaults !== null ? { mcpServers: defaults } : {};
          servers = normalizeMcpConfig(raw);
        }
      }
      const configPath = getMcpConfigPath(workspaceRoot);
      const fromEnv = !!process.env.X_COMPUTER_MCP_SERVERS?.trim();
      res.json({ servers, configPath, fromEnv });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '获取配置失败' });
    }
  });

  /** MCP 配置：保存并重载（按用户隔离：有 userId 时写入该用户工作区并同步到云端） */
  router.post('/mcp/config', async (req, res) => {
    try {
      const body = req.body as { servers?: unknown; mcpServers?: unknown };
      if (body.servers !== undefined && !Array.isArray(body.servers)) {
        res.status(400).json({ error: 'servers 需为数组' });
        return;
      }
      if (body.mcpServers !== undefined && (typeof body.mcpServers !== 'object' || body.mcpServers === null)) {
        res.status(400).json({ error: 'mcpServers 需为对象' });
        return;
      }
      const servers = normalizeMcpConfig(
        body as { mcpServers?: Record<string, Record<string, unknown>>; servers?: McpServerConfig[] },
      );
      if (servers.length === 0 && body.servers === undefined && body.mcpServers === undefined) {
        res.status(400).json({ error: 'Body 需包含 servers 数组或 mcpServers 对象' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      const workspaceRoot =
        userSandboxManager && userId && userId !== 'anonymous'
          ? userSandboxManager.getUserWorkspaceRoot(userId)
          : sandboxFS.getRoot();
      const configPath = await saveMcpConfig(workspaceRoot, servers);
      if (db && userId && userId !== 'anonymous') {
        await db.ensureUser(userId);
        await db.setConfig(userId, 'mcp_config', JSON.stringify(servers));
      }
      const result =
        userId && userId !== 'anonymous' && userSandboxManager
          ? await loadMcpAndRegisterForUser(
              orchestrator,
              userId,
              userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
              db?.getConfig.bind(db),
            )
          : await reloadMcpAndRegister(orchestrator, workspaceRoot);
      res.json({ success: true, configPath, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '保存并重载失败' });
    }
  });

  /** MCP Registry 搜索：从 registry.modelcontextprotocol.io 搜索 MCP 服务器，供前端市场与 X 工具使用 */
  router.get('/mcp/registry/search', async (req, res) => {
    try {
      const q = String(req.query?.q ?? '').trim();
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const result = await searchMcpRegistry(q, limit);
      if (result.ok) {
        res.json({ ok: true, servers: result.servers });
      } else {
        res.status(500).json({ ok: false, error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message ?? 'MCP Registry 搜索失败' });
    }
  });

  /** MCP 测试：测试单个服务器连接，返回完整工具列表（含名称、描述、参数 schema）或错误 */
  router.post('/mcp/test', async (req, res) => {
    try {
      const server = req.body as McpServerConfig;
      const hasHttp = server?.id && server?.url;
      const hasStdio = server?.id && server?.command;
      if (!hasHttp && !hasStdio) {
        res.status(400).json({ error: 'Body 需包含 id，以及 url（HTTP）或 command（Stdio）' });
        return;
      }
      const tools = await listTools(server);
      res.json({
        ok: true,
        toolsCount: tools.length,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? { type: 'object', properties: {}, required: [] },
        })),
      });
    } catch (err: any) {
      res.status(200).json({ ok: false, error: err.message ?? String(err) });
    }
  });

  return router;
}
