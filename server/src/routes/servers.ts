/**
 * 服务器管理 API 路由
 */

import { Router } from 'express';
import { getServerManager } from '../server/ServerManager.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createServerRouter() {
  const router = Router();

  // 列出所有服务器
  router.get('/', async (req, res) => {
    try {
      const manager = getServerManager();
      const servers = await manager.listServers();

      res.json({
        count: servers.length,
        servers: servers.map(s => ({
          serverId: s.id,
          name: s.name,
          host: s.host,
          port: s.port,
          username: s.username,
          authType: s.authType,
          description: s.description,
          tags: s.tags,
          createdAt: new Date(s.createdAt).toISOString(),
        })),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('server-api', 'Failed to list servers', msg);
      res.status(500).json({ error: msg });
    }
  });

  // 添加服务器
  router.post('/', async (req, res) => {
    try {
      const { name, host, port, username, authType, password, privateKey, passphrase, description, tags } = req.body;

      if (!name || !host || !username || !authType) {
        return res.status(400).json({ error: 'Missing required fields: name, host, username, authType' });
      }

      if (!['password', 'privateKey'].includes(authType)) {
        return res.status(400).json({ error: 'authType must be "password" or "privateKey"' });
      }

      if (authType === 'password' && !password) {
        return res.status(400).json({ error: 'password is required when authType is "password"' });
      }

      if (authType === 'privateKey' && !privateKey) {
        return res.status(400).json({ error: 'privateKey is required when authType is "privateKey"' });
      }

      const manager = getServerManager();
      const server = await manager.addServer({
        name,
        host,
        port: port || 22,
        username,
        authType,
        password,
        privateKey,
        passphrase,
        description,
        tags,
      });

      res.json({
        serverId: server.id,
        name: server.name,
        host: server.host,
        port: server.port,
        username: server.username,
        message: `服务器已添加: ${server.name} (${server.host})`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('server-api', 'Failed to add server', msg);
      res.status(500).json({ error: msg });
    }
  });

  // 更新服务器
  router.put('/:serverId', async (req, res) => {
    try {
      const { serverId } = req.params;
      const updates = req.body;

      const manager = getServerManager();
      await manager.updateServer(serverId, updates);

      res.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('server-api', 'Failed to update server', msg);
      res.status(500).json({ error: msg });
    }
  });

  // 删除服务器
  router.delete('/:serverId', async (req, res) => {
    try {
      const { serverId } = req.params;

      const manager = getServerManager();
      await manager.removeServer(serverId);

      res.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('server-api', 'Failed to delete server', msg);
      res.status(500).json({ error: msg });
    }
  });

  // 测试连接
  router.post('/:serverId/test', async (req, res) => {
    try {
      const { serverId } = req.params;

      const manager = getServerManager();
      const result = await manager.testConnection(serverId);

      res.json({
        serverId,
        success: result.success,
        message: result.message,
        duration: result.duration,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('server-api', 'Failed to test connection', msg);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
