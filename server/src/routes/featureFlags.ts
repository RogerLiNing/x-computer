import { Router } from 'express';
import {
  isFeatureEnabled,
  getAllFeatureFlags,
  getFeatureFlagDefinitions,
  getFeatureFlagsByCategory,
  overrideFeatureFlag,
  resetFeatureFlags,
  getFeatureFlagStats,
  type FeatureFlagDefinition,
} from '../config/featureFlags.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createFeatureFlagsRouter(): Router {
  const router = Router();

  // GET /api/admin/feature-flags — 获取所有功能状态（含元信息）
  router.get('/', (_req, res) => {
    try {
      const flags = getFeatureFlagDefinitions();
      const stats = getFeatureFlagStats();
      res.json({ success: true, data: { flags, stats } });
    } catch (err) {
      serverLogger.error('feature-flags', '获取功能列表失败', String(err));
      res.status(500).json({ success: false, error: '获取功能列表失败' });
    }
  });

  // GET /api/admin/feature-flags/stats — 获取功能统计
  router.get('/stats', (_req, res) => {
    try {
      const stats = getFeatureFlagStats();
      res.json({ success: true, data: stats });
    } catch (err) {
      serverLogger.error('feature-flags', '获取功能统计失败', String(err));
      res.status(500).json({ success: false, error: '获取功能统计失败' });
    }
  });

  // GET /api/admin/feature-flags/category/:category — 按分类获取功能
  router.get('/category/:category', (req, res) => {
    try {
      const { category } = req.params;
      const validCategories = ['core', 'experimental', 'admin', 'integrations'];
      if (!validCategories.includes(category)) {
        res.status(400).json({ success: false, error: `无效的分类: ${category}` });
        return;
      }
      const flags = getFeatureFlagsByCategory(category as FeatureFlagDefinition['category']);
      res.json({ success: true, data: flags });
    } catch (err) {
      serverLogger.error('feature-flags', '按分类获取功能失败', String(err));
      res.status(500).json({ success: false, error: '按分类获取功能失败' });
    }
  });

  // GET /api/admin/feature-flags/:key — 获取单个功能状态
  router.get('/:key', (req, res) => {
    try {
      const { key } = req.params;
      const flags = getFeatureFlagDefinitions();
      const flag = flags.find((f) => f.key === key);
      if (!flag) {
        res.status(404).json({ success: false, error: `未知的功能: ${key}` });
        return;
      }
      res.json({ success: true, data: flag });
    } catch (err) {
      serverLogger.error('feature-flags', '获取功能状态失败', String(err));
      res.status(500).json({ success: false, error: '获取功能状态失败' });
    }
  });

  // PUT /api/admin/feature-flags/:key/override — 运行时覆盖功能状态
  router.put('/:key/override', (req, res) => {
    try {
      const { key } = req.params;
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ success: false, error: 'enabled 必须是布尔值' });
        return;
      }
      overrideFeatureFlag(key, enabled);
      res.json({ success: true, data: { key, enabled, note: '运行时覆盖，仅当前进程有效，重启后失效' } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('未知的功能')) {
        res.status(404).json({ success: false, error: msg });
        return;
      }
      serverLogger.error('feature-flags', '覆盖功能状态失败', String(err));
      res.status(500).json({ success: false, error: '覆盖功能状态失败' });
    }
  });

  // POST /api/admin/feature-flags/reset — 重置所有运行时覆盖
  router.post('/reset', (_req, res) => {
    try {
      resetFeatureFlags();
      res.json({ success: true, data: { message: '已重置所有运行时覆盖' } });
    } catch (err) {
      serverLogger.error('feature-flags', '重置功能覆盖失败', String(err));
      res.status(500).json({ success: false, error: '重置功能覆盖失败' });
    }
  });

  return router;
}
