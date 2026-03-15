/**
 * 用户路由：/api/users
 *
 * - GET  /api/users/me          → 当前用户信息
 * - GET  /api/users/me/config   → 获取所有配置（缺失项会合并 .x-config.json 默认值）
 * - GET  /api/users/me/config/:key → 获取单个配置
 * - PUT  /api/users/me/config   → 批量更新配置
 * - PUT  /api/users/me/config/:key → 更新单个配置
 * - DELETE /api/users/me/config/:key → 删除单个配置
 *
 * llm_config 仅专业版（pro/enterprise）可配置，非专业版始终使用 server/.x-config.json 默认值。
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { loadDefaultConfig } from '../config/defaultConfig.js';

const LLM_CONFIG_KEY = 'llm_config';
const PRO_PLANS = new Set(['pro', 'enterprise']);

async function canConfigureLLM(
  subscriptionService: SubscriptionService | undefined,
  userId: string
): Promise<boolean> {
  if (!subscriptionService) return true; // 无订阅服务时允许（开发模式）
  try {
    const sub = await subscriptionService.getUserSubscription(userId);
    return sub ? PRO_PLANS.has(sub.planId) : false;
  } catch {
    return false; // 表不存在等异常时视为不可配置
  }
}

export function createUserRouter(db: AppDatabase, subscriptionService?: SubscriptionService): Router {
  const router = Router();

  /** GET /api/users/me - 当前用户信息（含 email：有则已登录账号，无则为匿名） */
  router.get('/me', async (req, res) => {
    const userId = req.userId;
    const user = await db.ensureUser(userId);
    const email = (await db.getEmailByUserId(userId)) ?? null;
    res.json({
      id: user.id,
      displayName: user.display_name,
      email,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    });
  });

  /** GET /api/users/me/config - 获取所有配置，缺失项合并 .x-config.json 默认值 */
  router.get('/me/config', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const canEditLLM = await canConfigureLLM(subscriptionService, userId);
    const configs = await db.getAllConfig(userId);
    const parsed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(configs)) {
      if (key === LLM_CONFIG_KEY && !canEditLLM) continue; // 非专业版不返回用户存储的 llm_config
      try {
        parsed[key] = JSON.parse(value);
      } catch {
        parsed[key] = value;
      }
    }
    const defaults = loadDefaultConfig();
    for (const [key, defVal] of Object.entries(defaults)) {
      if (parsed[key] === undefined || parsed[key] === null) {
        parsed[key] = defVal;
      }
    }
    res.json(parsed);
  });

  /** 未存储时可返回空对象的配置 key（避免首次打开设置页 404） */
  const EMPTY_OBJECT_KEYS = new Set([
    'audio_api_config',
    'email_smtp_config',
    'email_imap_config',
    'skill_config',
    'qq_config',
    'telegram_config',
    'discord_config',
    'slack_config',
    'whatsapp_config',
  ]);

  /** GET /api/users/me/config/:key - 获取单个配置，缺失时尝试返回默认值 */
  router.get('/me/config/:key', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const key = req.params.key;
    const canEditLLM = await canConfigureLLM(subscriptionService, userId);
    if (key === LLM_CONFIG_KEY && !canEditLLM) {
      const defaults = loadDefaultConfig();
      const defVal = defaults[LLM_CONFIG_KEY];
      return res.json({ key, value: defVal ?? {} });
    }
    let value = await db.getConfig(userId, key);
    if (value === undefined) {
      const defaults = loadDefaultConfig();
      const defVal = defaults[key];
      if (defVal !== undefined) {
        return res.json({ key, value: defVal });
      }
      if (EMPTY_OBJECT_KEYS.has(key)) {
        return res.json({ key, value: {} });
      }
      res.status(404).json({ error: `Config key '${key}' not found` });
      return;
    }
    try {
      res.json({ key, value: JSON.parse(value) });
    } catch {
      res.json({ key, value });
    }
  });

  /** PUT /api/users/me/config - 批量更新配置 */
  router.put('/me/config', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Body must be a JSON object' });
      return;
    }
    const canEditLLM = await canConfigureLLM(subscriptionService, userId);
    if (LLM_CONFIG_KEY in body && !canEditLLM) {
      res.status(403).json({ error: '仅专业版用户可配置大模型，请升级套餐' });
      return;
    }
    for (const [key, value] of Object.entries(body)) {
      const strValue = typeof value === 'string' ? value : JSON.stringify(value);
      await db.setConfig(userId, key, strValue);
    }
    res.json({ success: true });
  });

  /** PUT /api/users/me/config/:key - 更新单个配置 */
  router.put('/me/config/:key', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const key = req.params.key;
    const canEditLLM = await canConfigureLLM(subscriptionService, userId);
    if (key === LLM_CONFIG_KEY && !canEditLLM) {
      res.status(403).json({ error: '仅专业版用户可配置大模型，请升级套餐' });
      return;
    }
    const { value } = req.body ?? {};
    if (value === undefined) {
      res.status(400).json({ error: 'Missing value in body' });
      return;
    }
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    await db.setConfig(userId, key, strValue);
    res.json({ success: true, key });
  });

  /** DELETE /api/users/me/config/:key - 删除单个配置 */
  router.delete('/me/config/:key', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const key = req.params.key;
    const canEditLLM = await canConfigureLLM(subscriptionService, userId);
    if (key === LLM_CONFIG_KEY && !canEditLLM) {
      res.status(403).json({ error: '仅专业版用户可配置大模型，请升级套餐' });
      return;
    }
    await db.deleteConfig(userId, key);
    res.json({ success: true, key });
  });

  return router;
}
