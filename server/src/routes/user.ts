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
 * 管理员和专业版用户可配置自己的模型，其他用户使用服务端默认配置。
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { loadDefaultConfig } from '../config/defaultConfig.js';
import { publicLLMConfig, mergeUserLLMConfig } from '../llm/publicConfig.js';
import { canConfigureUserLLM } from '../llm/userConfigAccess.js';

const LLM_CONFIG_KEY = 'llm_config';
const SERVER_KEYS = new Set(['auth', 'container', 'database', 'mcp_servers', 'email', 'oauth', 'runtime_profile', 'tool_loading_mode', '__proto__', 'constructor', 'prototype']);
// Machine config keys must not alias reserved ASCII names under a database collation.
const privateKey = (key: string) => {const normalized=key.toLowerCase();return /[^\x21-\x7e]/.test(key) || SERVER_KEYS.has(normalized) || normalized==='auth_password_reset_v1' || normalized.startsWith('auth_session:');};

async function saveUserLLMConfig(db: AppDatabase, userId: string, value: unknown) {
  const sqlite = db.getDialect() === 'sqlite';
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = await db.getConfig(userId, LLM_CONFIG_KEY);
    const stored = mergeUserLLMConfig(value, previous);
    const serialized = JSON.stringify(stored);
    if (previous === serialized) return stored;
    if (previous === undefined) {
      await db.run(`${sqlite ? 'INSERT OR IGNORE' : 'INSERT IGNORE'} INTO user_config (user_id, \`key\`, value, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)`, [userId, LLM_CONFIG_KEY, serialized]);
    } else {
      await db.run(`UPDATE user_config SET value=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND \`key\`=?
        AND ${sqlite ? 'value=?' : 'BINARY value=BINARY ?'}`, [serialized, userId, LLM_CONFIG_KEY, previous]);
    }
    if (await db.getConfig(userId, LLM_CONFIG_KEY) === serialized) return stored;
  }
  throw new Error('模型配置同时发生了修改，请重试');
}

export function createUserRouter(db: AppDatabase, subscriptionService?: SubscriptionService): Router {
  const router = Router();
  router.param('key',(_req,res,next,key)=>{
    if(privateKey(key)){res.status(403).json({error:'服务器配置或会话凭证不可通过用户设置访问'});return;}
    next();
  });
  router.use('/me/config',(req,res,next)=>{
    let key:string;try{key=decodeURIComponent(req.path.replace(/^\//,''));}catch{res.status(400).json({error:'无效配置名称'});return;}
    if(privateKey(key) || (req.method!=='GET' && Object.keys(req.body??{}).some(privateKey))){
      res.status(403).json({error:'服务器配置或会话凭证不可通过用户设置访问'});return;
    }next();
  });

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

  /** PATCH /api/users/me/profile - 更新用户资料（display_name + profile JSON） */
  router.patch('/me/profile', async (req, res) => {
    const userId = req.userId;
    const user = await db.ensureUser(userId);
    const { displayName, bio, timezone, language } = req.body ?? {};

    // Update display_name in users table
    if (typeof displayName === 'string') {
      await db.updateUserDisplayName(userId, displayName.trim().slice(0, 100));
    }

    // Merge profile into user_config
    const PROFILE_KEY = 'user_profile';
    const existing = await db.getConfig(userId, PROFILE_KEY);
    let profile: Record<string, string> = {};
    try { profile = existing ? JSON.parse(existing) : {}; } catch { /* use empty */ }

    if (typeof bio === 'string') profile.bio = bio.trim().slice(0, 500);
    else if (bio === null || bio === '') profile.bio = '';
    if (typeof timezone === 'string') profile.timezone = timezone.slice(0, 64);
    else if (timezone === null || timezone === '') profile.timezone = '';
    if (typeof language === 'string') profile.language = language.slice(0, 16);
    else if (language === null || language === '') profile.language = '';

    await db.setConfig(userId, PROFILE_KEY, JSON.stringify(profile));
    res.json({ success: true });
  });

  /** GET /api/users/me/profile - 获取用户资料 */
  router.get('/me/profile', async (req, res) => {
    const userId = req.userId;
    const user = await db.ensureUser(userId);
    const PROFILE_KEY = 'user_profile';
    const raw = await db.getConfig(userId, PROFILE_KEY);
    let profile: Record<string, string> = {};
    try { profile = raw ? JSON.parse(raw) : {}; } catch { /* use empty */ }
    res.json({
      displayName: user.display_name ?? null,
      bio: profile.bio ?? null,
      timezone: profile.timezone ?? null,
      language: profile.language ?? null,
    });
  });

  /** GET /api/users/me/config - 获取所有配置，缺失项合并 .x-config.json 默认值 */
  router.get('/me/config', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const canEditLLM = await canConfigureUserLLM(userId, db, subscriptionService);
    const configs = await db.getAllConfig(userId);
    const parsed: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(configs)) {
      if(privateKey(key))continue;
      if (key === LLM_CONFIG_KEY && !canEditLLM) continue; // 非专业版不返回用户存储的 llm_config
      try {
        parsed[key] = key === LLM_CONFIG_KEY ? publicLLMConfig(JSON.parse(value)) : JSON.parse(value);
      } catch {
        parsed[key] = key === LLM_CONFIG_KEY ? publicLLMConfig(undefined) : value;
      }
    }
    const defaults = loadDefaultConfig();
    if (parsed[LLM_CONFIG_KEY] == null && defaults.llm_config != null) parsed[LLM_CONFIG_KEY] = publicLLMConfig(defaults.llm_config);
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
    const canEditLLM = await canConfigureUserLLM(userId, db, subscriptionService);
    if (key === LLM_CONFIG_KEY && !canEditLLM) {
      const defaults = loadDefaultConfig();
      const defVal = defaults[LLM_CONFIG_KEY];
      return res.json({ key, value: publicLLMConfig(defVal) });
    }
    let value = await db.getConfig(userId, key);
    if (value === undefined) {
      const defaults = loadDefaultConfig();
      const defVal = key === LLM_CONFIG_KEY ? publicLLMConfig(defaults.llm_config) : undefined;
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
      res.json({ key, value: key === LLM_CONFIG_KEY ? publicLLMConfig(JSON.parse(value)) : JSON.parse(value) });
    } catch {
      res.json({ key, value: key === LLM_CONFIG_KEY ? publicLLMConfig(undefined) : value });
    }
  });

  /** PUT /api/users/me/config - 批量更新配置 */
  router.put('/me/config', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Body must be a JSON object' });
      return;
    }
    const canEditLLM = await canConfigureUserLLM(userId, db, subscriptionService);
    if (LLM_CONFIG_KEY in body && !canEditLLM) {
      res.status(403).json({ error: '当前账号无权配置个人模型' });
      return;
    }
    if (LLM_CONFIG_KEY in body) {
      try { await saveUserLLMConfig(db, userId, body[LLM_CONFIG_KEY]); }
      catch { return res.status(400).json({ error: '模型配置无效' }); }
    }
    for (const [key, value] of Object.entries(body)) {
      if (key === LLM_CONFIG_KEY) continue;
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
    const canEditLLM = await canConfigureUserLLM(userId, db, subscriptionService);
    if (key === LLM_CONFIG_KEY && !canEditLLM) {
      res.status(403).json({ error: '当前账号无权配置个人模型' });
      return;
    }
    const { value } = req.body ?? {};
    if (value === undefined) {
      res.status(400).json({ error: 'Missing value in body' });
      return;
    }
    if (key === LLM_CONFIG_KEY) {
      try {
        const stored = await saveUserLLMConfig(db, userId, value);
        return res.json({ success: true, key, value: publicLLMConfig(stored) });
      } catch {
        return res.status(400).json({ error: '模型配置保存失败，请检查配置或重试' });
      }
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
    const canEditLLM = await canConfigureUserLLM(userId, db, subscriptionService);
    if (key === LLM_CONFIG_KEY && !canEditLLM) {
      res.status(403).json({ error: '当前账号无权配置个人模型' });
      return;
    }
    await db.deleteConfig(userId, key);
    res.json({ success: true, key });
  });

  return router;
}
