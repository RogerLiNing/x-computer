/**
 * 通知（邮件/WhatsApp/Telegram/Discord/Slack/QQ）、MCP 配置管理、
 * MiniApp 后端 KV/队列/推送 工具。
 *
 * 从 ToolExecutor.ts 提取，减少主文件体积。
 */

import { v4 as uuid } from 'uuid';
import type { ToolDefinition } from '@x-computer/shared';
import type { AppDatabase } from '../../db/database.js';
import type { SandboxFS } from '../../tooling/SandboxFS.js';
import type { McpServerConfig } from '../../mcp/types.js';

// ── 通知服务 ───────────────────────────────────────────────────────────────────

import { sendEmail, getEmailSendIdentity, parseSmtpConfigExport, fetchEmails, parseImapConfig } from '../../email/emailService.js';
import { sendWhatsAppMessage, parseWhatsAppConfig, getWhatsAppConnection } from '../../whatsapp/whatsappService.js';
import { sendTelegramMessage, parseTelegramConfig, getTelegramConnection } from '../../telegram/telegramService.js';
import { sendDiscordMessage, parseDiscordConfig, getDiscordConnection } from '../../discord/discordService.js';
import { sendSlackMessage, parseSlackConfig, getSlackConnection } from '../../slack/slackService.js';
import { sendQQMessage, parseQQConfig, getQQConnection } from '../../qq/qqService.js';
import { normalizeMcpConfig } from '../../mcp/loadAndRegister.js';
import { broadcastToAppChannel } from '../../wsBroadcast.js';
import { markReadWithHistory } from '../../x/XProactiveMessages.js';
import { getConfigValue } from './utils.js';
import { requireSendApproval, sendWithReceipt, SendExecutionDeniedError } from '../../tooling/sendApproval.js';
import { channelProcessedKey } from '../../messaging/channelIdentity.js';

// ── Config key constants ────────────────────────────────────────────────────────

const EMAIL_SMTP_CONFIG_KEY = 'email_smtp_config';
const EMAIL_IMAP_CONFIG_KEY = 'email_imap_config';
const EMAIL_FROM_FILTER_KEY = 'email_from_filter';
const MCP_CONFIG_KEY = 'mcp_config';

const SEND_CONFIRMATION = '参数齐全时直接调用本工具；系统会先展示收件人、发送内容并暂停，用户确认后才会发送。不要先用 x.ask_user 重复询问是否发送。';

// ── Tool Definitions ──────────────────────────────────────────────────────────

export const sendEmailDef: ToolDefinition = {
  name: 'x.send_email',
  displayName: '发送邮件',
  description: SEND_CONFIRMATION + '通过邮件触达用户。需先配置 SMTP（x.set_email_config 或 设置 → 通知/邮件）。to 不填时默认发给当前登录用户；subject、body 必填。',
  domain: ['chat', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'to', type: 'string', description: '收件人邮箱；不填时发给当前登录用户', required: false },
    { name: 'subject', type: 'string', description: '邮件主题', required: true },
    { name: 'body', type: 'string', description: '正文内容（Markdown），将转成 HTML 富文本发送', required: true },
  ],
  requiredPermissions: [],
};

export const sendWhatsAppDef: ToolDefinition = {
  name: 'x.send_whatsapp',
  displayName: '发送 WhatsApp',
  description: SEND_CONFIRMATION + '通过 WhatsApp 发送消息。需先在 设置 → 通知/WhatsApp 中扫码登录并配置白名单。to 为收件人号码（E.164 格式，如 +8613800138000 或 13800138000）。',
  domain: ['chat', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'to', type: 'string', description: '收件人号码，E.164 格式（如 +8613800138000）', required: true },
    { name: 'message', type: 'string', description: '消息内容', required: true },
  ],
  requiredPermissions: [],
};

export const sendTelegramDef: ToolDefinition = {
  name: 'x.send_telegram',
  displayName: '发送 Telegram',
  description: SEND_CONFIRMATION + '通过 Telegram Bot 发送消息。需先在 设置 → 通知/Telegram 中配置 Bot Token 并连接。chatId 为接收者的 Chat ID。',
  domain: ['chat', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'chatId', type: 'string', description: '目标 Chat ID', required: true },
    { name: 'message', type: 'string', description: '消息内容', required: true },
  ],
  requiredPermissions: [],
};

export const sendDiscordDef: ToolDefinition = {
  name: 'x.send_discord',
  displayName: '发送 Discord',
  description: SEND_CONFIRMATION + '通过 Discord Bot 发送消息。需先在 设置 → 通知/Discord 中配置 Bot Token 并连接。channelId 为目标频道或 DM 的 Channel ID。',
  domain: ['chat', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'channelId', type: 'string', description: '目标 Channel ID', required: true },
    { name: 'message', type: 'string', description: '消息内容', required: true },
  ],
  requiredPermissions: [],
};

export const sendSlackDef: ToolDefinition = {
  name: 'x.send_slack',
  displayName: '发送 Slack',
  description: SEND_CONFIRMATION + '通过 Slack Bot 发送消息。需先在 设置 → 通知/Slack 中配置 Token 并连接。channelId 为频道或 DM 的 Channel ID，可选 threadTs 进行线程回复。',
  domain: ['chat', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'channelId', type: 'string', description: '目标 Channel ID', required: true },
    { name: 'message', type: 'string', description: '消息内容', required: true },
    { name: 'threadTs', type: 'string', description: '（可选）线程 ts，回复到特定线程', required: false },
  ],
  requiredPermissions: [],
};

export const sendQQDef: ToolDefinition = {
  name: 'x.send_qq',
  displayName: '发送 QQ 消息',
  description: SEND_CONFIRMATION + '通过 QQ 官方 Bot 发送消息。需先在 设置 → 通知/QQ 中配置 AppID+Secret 并连接。targetType 为 private/group/guild 或 self（发给自己）。targetId 为对应的用户ID/群ID/频道ID。使用 self 时会自动使用用户已记录的 OpenID（用户首次私聊时会自动记录）。',
  domain: ['chat', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'targetType', type: 'string', description: '消息目标类型：private（私聊）、group（群聊）、guild（频道）或 self（发给自己）', required: true },
    { name: 'targetId', type: 'string', description: '目标 ID（用户 openid、群 openid 或频道 channel_id）。当 targetType 为 self 时此参数可选', required: false },
    { name: 'message', type: 'string', description: '消息内容', required: true },
  ],
  requiredPermissions: [],
};

export const listEmailConfigsDef: ToolDefinition = {
  name: 'x.list_email_configs',
  displayName: '列出邮箱配置',
  description: '查看当前 SMTP 配置（host、port、user 等），密码以 *** 脱敏。未配置时返回 configured: false。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: [],
};

export const setEmailConfigDef: ToolDefinition = {
  name: 'x.set_email_config',
  displayName: '新增或更新邮箱配置',
  description: '新增或覆盖 SMTP 配置。host（如 smtp.qq.com）、port（465 或 587）、user（邮箱）、pass（授权码）必填；secure 默认 true；from 可选。QQ 邮箱需在账户中生成授权码。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'host', type: 'string', description: 'SMTP 服务器，如 smtp.qq.com', required: true },
    { name: 'port', type: 'number', description: '端口，465（SSL）或 587（TLS）', required: true },
    { name: 'secure', type: 'boolean', description: '是否使用 SSL，465 一般为 true', required: false },
    { name: 'user', type: 'string', description: '发件邮箱，如 xxx@qq.com', required: true },
    { name: 'pass', type: 'string', description: '授权码（QQ 邮箱为 SMTP 授权码）', required: true },
    { name: 'from', type: 'string', description: '发件人显示名，如 X Computer <xxx@qq.com>', required: false },
  ],
  requiredPermissions: [],
};

export const deleteEmailConfigDef: ToolDefinition = {
  name: 'x.delete_email_config',
  displayName: '删除邮箱配置',
  description: '删除当前 SMTP 配置，删除后将无法使用 x.send_email。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: [],
};

export const checkEmailDef: ToolDefinition = {
  name: 'x.check_email',
  displayName: '检查收件箱',
  description: '从 IMAP 收件箱拉取邮件。from_user_only 为 true 时仅拉取当前用户发来的邮件（用于用户通过邮箱与 X 沟通）。limit 默认 10；unseen_only 为 true 时仅拉未读。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'limit', type: 'number', description: '拉取数量，默认 10，最多 50', required: false },
    { name: 'unseen_only', type: 'boolean', description: '仅拉取未读邮件', required: false },
    { name: 'from_user_only', type: 'boolean', description: '仅拉取当前用户发来的邮件', required: false },
  ],
  requiredPermissions: [],
};

export const listEmailImapConfigDef: ToolDefinition = {
  name: 'x.list_email_imap_config',
  displayName: '列出 IMAP 配置',
  description: '查看当前 IMAP 收信配置（host、port、user），密码脱敏。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: [],
};

export const setEmailImapConfigDef: ToolDefinition = {
  name: 'x.set_email_imap_config',
  displayName: '新增或更新 IMAP 配置',
  description: '配置 IMAP 收信。host（如 imap.qq.com）、port（993）、user、pass 必填。QQ 邮箱 user/pass 可与 SMTP 相同。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'host', type: 'string', description: 'IMAP 服务器，如 imap.qq.com', required: true },
    { name: 'port', type: 'number', description: '端口，通常 993', required: true },
    { name: 'secure', type: 'boolean', description: '是否 SSL', required: false },
    { name: 'user', type: 'string', description: '邮箱账号', required: true },
    { name: 'pass', type: 'string', description: '授权码', required: true },
  ],
  requiredPermissions: [],
};

export const setEmailFromFilterDef: ToolDefinition = {
  name: 'x.set_email_from_filter',
  displayName: '设置邮件发件人过滤',
  description: '设置只处理来自指定发件人的新邮件。传入 emails 数组（如 ["user@gmail.com"]），未配置则处理所有。用于「只监听来自某邮箱的邮件」场景。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'emails', type: 'string', description: '发件人邮箱列表，逗号分隔或 JSON 数组', required: true },
  ],
  requiredPermissions: [],
};

export const listEmailFromFilterDef: ToolDefinition = {
  name: 'x.list_email_from_filter',
  displayName: '查看邮件发件人过滤',
  description: '查看当前发件人过滤配置。若已配置，仅来自这些邮箱的新邮件会触发 email_received。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: [],
};

export const listMcpConfigDef: ToolDefinition = {
  name: 'x.list_mcp_config',
  displayName: '列出 MCP 配置',
  description: '查看当前 MCP 服务器列表（id、name、url 或 command+args、工具数）。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: [],
};

export const addMcpServerDef: ToolDefinition = {
  name: 'x.add_mcp_server',
  displayName: '添加 MCP 服务器',
  description: '添加一个 MCP 服务器。方式一：传 id、url（HTTP）或 id、command、args（Stdio），可选 name、headers。方式二：传 config（JSON），格式为 {"serverId":{"url":"...","headers":{...}} } 或 {"serverId":{"type":"streamableHttp","url":"...","headers":{...}} }，从 config 中解析 id、url、headers。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'id', type: 'string', description: '唯一标识；若传 config 则可省略（从 config 的 key 提取）', required: false },
    { name: 'config', type: 'string', description: '可选。完整配置 JSON，如 {"metaso":{"url":"https://...","headers":{"Authorization":"Bearer xxx"}}}', required: false },
    { name: 'name', type: 'string', description: '显示名称', required: false },
    { name: 'url', type: 'string', description: 'HTTP 传输：JSON-RPC 端点 URL', required: false },
    { name: 'headers', type: 'string', description: 'HTTP 传输：请求头 JSON，如 {"Authorization":"Bearer xxx"}', required: false },
    { name: 'command', type: 'string', description: 'Stdio 传输：启动命令，如 npx', required: false },
    { name: 'args', type: 'string', description: 'Stdio 传输：参数 JSON 数组，如 ["bing-cn-mcp"]', required: false },
  ],
  requiredPermissions: [],
};

export const updateMcpServerDef: ToolDefinition = {
  name: 'x.update_mcp_server',
  displayName: '更新 MCP 服务器',
  description: '按 id 更新已有 MCP 服务器。可更新 name、url、headers、command、args，未传的字段保持不变。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'id', type: 'string', description: '要更新的服务器 id', required: true },
    { name: 'name', type: 'string', description: '显示名称', required: false },
    { name: 'url', type: 'string', description: 'HTTP：JSON-RPC 端点 URL', required: false },
    { name: 'headers', type: 'string', description: 'HTTP：请求头 JSON', required: false },
    { name: 'command', type: 'string', description: 'Stdio：启动命令', required: false },
    { name: 'args', type: 'string', description: 'Stdio：参数 JSON 数组', required: false },
  ],
  requiredPermissions: [],
};

export const removeMcpServerDef: ToolDefinition = {
  name: 'x.remove_mcp_server',
  displayName: '删除 MCP 服务器',
  description: '按 id 删除 MCP 服务器，删除后立即重载。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [{ name: 'id', type: 'string', description: '要删除的服务器 id', required: true }],
  requiredPermissions: [],
};

export const markProactiveReadDef: ToolDefinition = {
  name: 'x.mark_proactive_read',
  displayName: '标记消息已读',
  description: '将指定的一条或若干条「X 主动找用户」的消息标记为已读。用户看到通知后可自行点击已读，或你在跟进处理（如已配置 Key、已答复用户）后调用本工具标记，无需用户再操作。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'message_id', type: 'string', description: '单条消息 id（从 x.notify_user 返回或上下文可知）', required: false },
    { name: 'message_ids', type: 'string', description: '多条消息 id，JSON 数组字符串，如 ["id1","id2"]；与 message_id 二选一', required: false },
  ],
  requiredPermissions: [],
};

export const backendKvSetDef: ToolDefinition = {
  name: 'backend.kv_set',
  displayName: '写入键值',
  description: '为指定小程序/小游戏写入一条键值数据（后端存储）。前端可通过 GET/PUT /api/x-apps/backend/kv/:appId?key=xxx 读写同一数据。用于排行榜、用户进度、配置等。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'app_id', type: 'string', description: '小程序 id（与 x.create_app 的 app_id 一致）', required: true },
    { name: 'key', type: 'string', description: '键名', required: true },
    { name: 'value', type: 'string', description: '值（字符串；存 JSON 时请先 JSON.stringify）', required: true },
  ],
  requiredPermissions: [],
};

export const backendKvGetDef: ToolDefinition = {
  name: 'backend.kv_get',
  displayName: '读取键值',
  description: '读取指定小程序/小游戏的键值数据。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'app_id', type: 'string', description: '小程序 id', required: true },
    { name: 'key', type: 'string', description: '键名', required: true },
  ],
  requiredPermissions: [],
};

export const backendKvDeleteDef: ToolDefinition = {
  name: 'backend.kv_delete',
  displayName: '删除键值',
  description: '删除指定小程序/小游戏的键值数据。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'app_id', type: 'string', description: '小程序 id', required: true },
    { name: 'key', type: 'string', description: '键名', required: true },
  ],
  requiredPermissions: [],
};

export const backendKvListDef: ToolDefinition = {
  name: 'backend.kv_list',
  displayName: '列出键',
  description: '列出指定小程序/小游戏的键（可选 prefix 前缀过滤）。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'app_id', type: 'string', description: '小程序 id', required: true },
    { name: 'prefix', type: 'string', description: '可选，只返回以此前缀开头的 key', required: false },
  ],
  requiredPermissions: [],
};

export const backendQueuePushDef: ToolDefinition = {
  name: 'backend.queue_push',
  displayName: '队列推入',
  description: '向指定小程序/小游戏的队列推入一条消息（FIFO）。前端可通过 POST /api/x-apps/backend/queue/:appId/:queueName/push 与 GET .../pop 读写同一队列。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'app_id', type: 'string', description: '小程序 id', required: true },
    { name: 'queue_name', type: 'string', description: '队列名', required: true },
    { name: 'payload', type: 'string', description: '消息内容（字符串）', required: true },
  ],
  requiredPermissions: [],
};

export const backendQueuePopDef: ToolDefinition = {
  name: 'backend.queue_pop',
  displayName: '队列弹出',
  description: '从指定小程序/小游戏队列弹出一条消息（FIFO）。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'app_id', type: 'string', description: '小程序 id', required: true },
    { name: 'queue_name', type: 'string', description: '队列名', required: true },
  ],
  requiredPermissions: [],
};

export const backendQueueLenDef: ToolDefinition = {
  name: 'backend.queue_len',
  displayName: '队列长度',
  description: '查询指定小程序/小游戏队列当前长度。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'app_id', type: 'string', description: '小程序 id', required: true },
    { name: 'queue_name', type: 'string', description: '队列名', required: true },
  ],
  requiredPermissions: [],
};

export const backendBroadcastDef: ToolDefinition = {
  name: 'backend.broadcast_to_app',
  displayName: '向小程序推送消息',
  description: '向当前已打开该小程序的用户推送一条实时消息（WebSocket）。用户需已打开该应用窗口；消息会通过 app_channel 发到前端，小程序 iframe 内可用 window.addEventListener("message", e => e.data?.type === "x_app_channel" 处理)。用于游戏状态同步、通知、实时更新等。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'app_id', type: 'string', description: '小程序 id', required: true },
    { name: 'message', type: 'string', description: '要推送的内容（建议 JSON 字符串，前端解析）', required: true },
  ],
  requiredPermissions: [],
};

// ── Shared helpers ─────────────────────────────────────────────────────────────

function requireUserId(ctx: any, toolName: string): string {
  const uid = ctx?.userId;
  if (!uid || uid === 'anonymous') throw new Error(`${toolName}: 需要已登录用户`);
  return uid;
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createBoardHandlers(ctx: {
  resolveDB: () => AppDatabase | null;
  resolveFS: (ctx: any) => Promise<SandboxFS | undefined>;
}) {
  const { resolveDB, resolveFS } = ctx;

  // ── Notification helpers ────────────────────────────────────────────────────


  // ── Email ─────────────────────────────────────────────────────────────────

  const sendEmailHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.send_email: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.send_email: 配置不可用');
    const db = resolveDB();
    let to = typeof input.to === 'string' ? input.to.trim() : '';
    if (!to && db) to = (await db.getEmailByUserId(userId)) ?? '';
    const subject = String(input.subject ?? '').trim();
    const body = String(input.body ?? '').trim();
    if (!subject || !body) throw new Error('x.send_email: subject 与 body 必填');
    if (!to) throw new Error('x.send_email: 未指定收件人且当前用户无绑定邮箱，请传入 to 参数');
    const rawConfig = await getConfigValue(getConfig, userId, EMAIL_SMTP_CONFIG_KEY);
    const sender = getEmailSendIdentity(rawConfig);
    if (!rawConfig || !sender) throw new Error('未配置有效的 SMTP');
    await requireSendApproval(ctx, 'x.send_email', { to, subject, body }, rawConfig, sender);
    const result = await sendWithReceipt(() => sendEmail(
      (uid, key) => uid === userId && key === EMAIL_SMTP_CONFIG_KEY ? rawConfig : getConfig(uid, key),
      userId, { to, subject, body, signal: ctx.signal, assertSendActive: async () => {
        await ctx.assertSendActive();
        if (await getConfigValue(getConfig, userId, EMAIL_SMTP_CONFIG_KEY) !== rawConfig) throw new SendExecutionDeniedError('SMTP 配置已变化，邮件尚未发送，请重新交办并确认');
      } },
    ));
    return { ok: true, messageId: result.messageId, accepted: result.accepted, message: 'SMTP 已接受邮件，是否送达收件箱仍需核对' };
  };

  const listEmailConfigsHandler = async (_input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.list_email_configs: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.list_email_configs: 配置不可用');
    const config = parseSmtpConfigExport(await getConfigValue(getConfig, userId, EMAIL_SMTP_CONFIG_KEY));
    if (!config) return { configured: false, message: '未配置 SMTP' };
    return {
      configured: true,
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      pass: config.pass ? '***' : undefined,
      from: config.from,
    };
  };

  const setEmailConfigHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.set_email_config: 需要已登录用户');
    const setConfig = ctx?.setConfig;
    if (!setConfig) throw new Error('x.set_email_config: 配置不可用');
    const host = String(input.host ?? '').trim();
    const port = Number(input.port);
    const user = String(input.user ?? '').trim();
    const pass = String(input.pass ?? '').trim();
    if (!host || !user || !pass) throw new Error('x.set_email_config: host、user、pass 必填');
    if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('x.set_email_config: port 须为 1–65535');
    const secure = input.secure !== false;
    const from = typeof input.from === 'string' ? input.from.trim() : undefined;
    const config = { host, port, secure, user, pass, ...(from ? { from } : {}) };
    const setResult = setConfig(userId, EMAIL_SMTP_CONFIG_KEY, JSON.stringify(config));
    if (setResult instanceof Promise) await setResult;
    return { ok: true, message: '邮箱配置已保存，可使用 x.send_email 发信' };
  };

  const deleteEmailConfigHandler = async (_input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.delete_email_config: 需要已登录用户');
    const setConfig = ctx?.setConfig;
    const getConfig = ctx?.getConfig;
    if (!setConfig || !getConfig) throw new Error('x.delete_email_config: 配置不可用');
    const config = parseSmtpConfigExport(await getConfigValue(getConfig, userId, EMAIL_SMTP_CONFIG_KEY));
    if (!config) return { ok: true, message: '当前未配置邮箱' };
    const setResult = setConfig(userId, EMAIL_SMTP_CONFIG_KEY, '{}');
    if (setResult instanceof Promise) await setResult;
    return { ok: true, message: '邮箱配置已删除' };
  };

  // ── IMAP ─────────────────────────────────────────────────────────────────

  const checkEmailHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.check_email: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.check_email: 配置不可用');
    const db = resolveDB();
    const limit = typeof input.limit === 'number' ? Math.min(50, Math.max(1, input.limit)) : 10;
    const unseenOnly = input.unseen_only === true;
    const fromUserOnly = input.from_user_only === true;
    let fromFilter: string | undefined;
    if (fromUserOnly && db) {
      fromFilter = (await db.getEmailByUserId(userId)) ?? undefined;
      if (!fromFilter) throw new Error('x.check_email: from_user_only 需要当前用户已绑定邮箱');
    }
    const result = await fetchEmails(getConfig, userId, { limit, unseenOnly, fromFilter });
    if (!result.ok) throw new Error(result.error ?? '收信失败');
    return { ok: true, emails: result.emails ?? [], count: (result.emails ?? []).length };
  };

  const listEmailImapConfigHandler = async (_input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.list_email_imap_config: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.list_email_imap_config: 配置不可用');
    const config = parseImapConfig(await getConfigValue(getConfig, userId, EMAIL_IMAP_CONFIG_KEY));
    if (!config) return { configured: false, message: '未配置 IMAP 收信' };
    return {
      configured: true,
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      pass: config.pass ? '***' : undefined,
    };
  };

  const setEmailImapConfigHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.set_email_imap_config: 需要已登录用户');
    const setConfig = ctx?.setConfig;
    if (!setConfig) throw new Error('x.set_email_imap_config: 配置不可用');
    const host = String(input.host ?? '').trim();
    const port = Number(input.port);
    const user = String(input.user ?? '').trim();
    const pass = String(input.pass ?? '').trim();
    if (!host || !user || !pass) throw new Error('x.set_email_imap_config: host、user、pass 必填');
    if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('x.set_email_imap_config: port 须为 1–65535');
    const secure = input.secure !== false;
    const config = { host, port, secure, user, pass };
    setConfig(userId, EMAIL_IMAP_CONFIG_KEY, JSON.stringify(config));
    return { ok: true, message: 'IMAP 配置已保存，可使用 x.check_email 收信' };
  };

  const setEmailFromFilterHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.set_email_from_filter: 需要已登录用户');
    const setConfig = ctx?.setConfig;
    if (!setConfig) throw new Error('x.set_email_from_filter: 配置不可用');
    const raw = String(input.emails ?? '').trim();
    if (!raw) {
      setConfig(userId, EMAIL_FROM_FILTER_KEY, '');
      return { ok: true, message: '已清除发件人过滤，将处理所有新邮件' };
    }
    let arr: string[];
    if (raw.startsWith('[')) {
      try {
        arr = JSON.parse(raw) as string[];
        if (!Array.isArray(arr)) arr = [raw];
      } catch {
        arr = raw.split(',').map((e) => e.trim()).filter(Boolean);
      }
    } else {
      arr = raw.split(',').map((e) => e.trim()).filter(Boolean);
    }
    setConfig(userId, EMAIL_FROM_FILTER_KEY, JSON.stringify(arr));
    return { ok: true, message: `已设置发件人过滤：${arr.join(', ')}，仅这些地址的来信会触发回复` };
  };

  const listEmailFromFilterHandler = async (_input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.list_email_from_filter: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.list_email_from_filter: 配置不可用');
    const raw = await getConfigValue(getConfig, userId, EMAIL_FROM_FILTER_KEY);
    if (!raw?.trim()) return { emails: [], message: '未设置过滤，处理所有新邮件' };
    try {
      const arr = JSON.parse(raw) as unknown[];
      const emails = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : raw.split(',').map((e) => e.trim()).filter(Boolean);
      return { emails, message: emails.length ? `仅处理来自 ${emails.join(', ')} 的邮件` : '未设置过滤' };
    } catch {
      return { emails: raw.split(',').map((e) => e.trim()).filter(Boolean), message: '' };
    }
  };

  // ── WhatsApp ──────────────────────────────────────────────────────────────

  const sendWhatsAppHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.send_whatsapp: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.send_whatsapp: 配置不可用');
    const to = String(input.to ?? '').trim();
    const message = String(input.message ?? input.content ?? '').trim();
    if (!to || !message) throw new Error('x.send_whatsapp: to 与 message 必填');
    const rawConfig = await getConfigValue(getConfig, userId, 'whatsapp_config');
    const config = parseWhatsAppConfig(rawConfig);
    if (!rawConfig || !config?.enabled) throw new Error('x.send_whatsapp: 未启用 WhatsApp，请在 设置 → 通知/WhatsApp 中配置并扫码登录');
    const sender = getWhatsAppConnection(userId, getConfig).getSendIdentity();
    if (!sender) throw new SendExecutionDeniedError('WhatsApp 尚未连接登录账号，尚未发送，请先扫码连接后重新交办');
    await requireSendApproval(ctx, 'x.send_whatsapp', { to, message }, rawConfig, sender);
    await sendWithReceipt(() => sendWhatsAppMessage(
      (uid, key) => uid === userId && key === 'whatsapp_config' ? rawConfig : getConfig(uid, key),
      userId, to, message, sender.binding,
    ));
    return { ok: true, message: 'WhatsApp 消息已发送' };
  };

  // ── Telegram ─────────────────────────────────────────────────────────────

  const sendTelegramHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.send_telegram: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.send_telegram: 配置不可用');
    const chatId = String(input.chatId ?? '').trim();
    const message = String(input.message ?? input.content ?? '').trim();
    if (!chatId || !message) throw new Error('x.send_telegram: chatId 与 message 必填');
    const rawConfig = await getConfigValue(getConfig, userId, 'telegram_config');
    const config = parseTelegramConfig(rawConfig);
    if (!rawConfig || !config?.enabled) throw new Error('x.send_telegram: 未启用 Telegram，请在设置中配置');
    const sender = getTelegramConnection(userId, getConfig).getSendIdentity();
    if (!sender) throw new SendExecutionDeniedError('Telegram 尚未连接可确认的发送账号，请先连接后重新交办');
    await requireSendApproval(ctx, 'x.send_telegram', { chatId, message }, rawConfig, sender);
    await sendWithReceipt(() => sendTelegramMessage(
      (uid, key) => uid === userId && key === 'telegram_config' ? rawConfig : getConfig(uid, key),
      userId, chatId, message, sender.binding,
    ));
    return { ok: true, message: 'Telegram 消息已发送' };
  };

  // ── Discord ─────────────────────────────────────────────────────────────

  const sendDiscordHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.send_discord: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.send_discord: 配置不可用');
    const channelId = String(input.channelId ?? '').trim();
    const message = String(input.message ?? input.content ?? '').trim();
    if (!channelId || !message) throw new Error('x.send_discord: channelId 与 message 必填');
    const rawConfig = await getConfigValue(getConfig, userId, 'discord_config');
    const config = parseDiscordConfig(rawConfig);
    if (!rawConfig || !config?.enabled) throw new Error('x.send_discord: 未启用 Discord，请在设置中配置');
    const sender = getDiscordConnection(userId, getConfig).getSendIdentity();
    if (!sender) throw new SendExecutionDeniedError('Discord 尚未连接可确认的发送账号，请先连接后重新交办');
    await requireSendApproval(ctx, 'x.send_discord', { channelId, message }, rawConfig, sender);
    await sendWithReceipt(() => sendDiscordMessage(
      (uid, key) => uid === userId && key === 'discord_config' ? rawConfig : getConfig(uid, key),
      userId, channelId, message, sender.binding,
    ));
    return { ok: true, message: 'Discord 消息已发送' };
  };

  // ── Slack ────────────────────────────────────────────────────────────────

  const sendSlackHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.send_slack: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.send_slack: 配置不可用');
    const channelId = String(input.channelId ?? '').trim();
    const message = String(input.message ?? input.content ?? '').trim();
    const threadTs = input.threadTs ? String(input.threadTs).trim() : undefined;
    if (!channelId || !message) throw new Error('x.send_slack: channelId 与 message 必填');
    const rawConfig = await getConfigValue(getConfig, userId, 'slack_config');
    const config = parseSlackConfig(rawConfig);
    if (!rawConfig || !config?.enabled) throw new Error('x.send_slack: 未启用 Slack，请在设置中配置');
    const sender = getSlackConnection(userId, getConfig).getSendIdentity();
    if (!sender) throw new SendExecutionDeniedError('Slack 尚未连接可确认的发送账号，请先连接后重新交办');
    await requireSendApproval(ctx, 'x.send_slack', threadTs ? { channelId, message, threadTs } : { channelId, message }, rawConfig, sender);
    await sendWithReceipt(() => sendSlackMessage(
      (uid, key) => uid === userId && key === 'slack_config' ? rawConfig : getConfig(uid, key),
      userId, channelId, message, threadTs, sender.binding,
    ));
    return { ok: true, message: 'Slack 消息已发送' };
  };

  // ── QQ ─────────────────────────────────────────────────────────────────

  const sendQQHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.send_qq: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.send_qq: 配置不可用');
    let targetTypeRaw = String(input.targetType ?? '').trim();
    let targetId = String(input.targetId ?? '').trim();
    const message = String(input.message ?? input.content ?? '').trim();

    let targetType: 'private' | 'group' | 'guild' = 'private';
    if (targetTypeRaw === 'self') {
      const account = getQQConnection(userId, getConfig).getSendIdentity()?.accountId;
      const selfOpenid = account ? await getConfigValue(getConfig, userId, channelProcessedKey('qq_self_openid', account)) : undefined;
      if (!selfOpenid) {
        throw new Error('x.send_qq: 尚未记录您的 QQ OpenID。请先通过 QQ 私聊发送一条消息，系统会自动记录。');
      }
      targetId = selfOpenid;
      targetType = 'private';
    } else {
      targetType = targetTypeRaw as 'private' | 'group' | 'guild';
      if (!targetType || !targetId || !message) throw new Error('x.send_qq: targetType、targetId、message 必填');
      if (!['private', 'group', 'guild'].includes(targetType)) throw new Error('x.send_qq: targetType 必须为 private、group、guild 或 self');
    }

    if (!targetId || !message) throw new Error('x.send_qq: targetId 和 message 必填');

    if (!targetId || targetId === 'user' || targetId === 'chat') {
      const taskMetadata = ctx?.taskMetadata as { sourceMessage?: { fromId?: string; chatId?: string } } | undefined;
      if (taskMetadata?.sourceMessage?.fromId) {
        targetId = taskMetadata.sourceMessage.fromId;
      } else if (targetTypeRaw !== 'self') {
        throw new Error('x.send_qq: targetId 无效。请确保使用发送者的 QQ ID（openid）作为 targetId，或使用 targetType:"self" 发送给用户自己。');
      }
    }

    const rawConfig = await getConfigValue(getConfig, userId, 'qq_config');
    const config = parseQQConfig(rawConfig);
    if (!rawConfig || !config?.enabled) throw new Error('x.send_qq: 未启用 QQ，请在设置中配置');
    const sender = getQQConnection(userId, getConfig).getSendIdentity();
    if (!sender) throw new SendExecutionDeniedError('QQ 尚未连接可确认的发送账号，请先连接后重新交办');
    await requireSendApproval(ctx, 'x.send_qq', { targetType, targetId, message }, rawConfig, sender);
    await sendWithReceipt(() => sendQQMessage(
      (uid, key) => uid === userId && key === 'qq_config' ? rawConfig : getConfig(uid, key),
      userId, { type: targetType, id: targetId }, message, sender.binding,
    ));
    return { ok: true, message: 'QQ 消息已发送' };
  };

  // ── MCP ─────────────────────────────────────────────────────────────────

  const listMcpConfigHandler = async (_input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.list_mcp_config: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    if (!getConfig) throw new Error('x.list_mcp_config: 配置不可用');
    const raw = await getConfigValue(getConfig, userId, MCP_CONFIG_KEY);
    const servers = raw?.trim()
      ? normalizeMcpConfig(
          (() => {
            try {
              const p = JSON.parse(raw) as unknown;
              return Array.isArray(p) ? { servers: p } : (typeof p === 'object' && p !== null ? p : {});
            } catch {
              return {};
            }
          })(),
        )
      : [];
    return {
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name ?? s.id,
        url: s.url,
        command: s.command,
        args: s.args,
      })),
      count: servers.length,
    };
  };

  const addMcpServerHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.add_mcp_server: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    const reloadMcp = ctx?.reloadMcpForUser;
    if (!getConfig || !setConfig) throw new Error('x.add_mcp_server: 配置不可用');
    let id = String(input.id ?? '').trim();
    let url = typeof input.url === 'string' ? input.url.trim() || undefined : undefined;
    let headers: Record<string, string> | undefined;
    let name = typeof input.name === 'string' ? input.name.trim() || undefined : undefined;
    let command = typeof input.command === 'string' ? input.command.trim() || undefined : undefined;
    let args: string[] | undefined;
    const configStr = typeof input.config === 'string' ? input.config.trim() : undefined;
    if (configStr) {
      try {
        const cfg = JSON.parse(configStr) as Record<string, unknown>;
        if (!cfg || typeof cfg !== 'object') throw new Error('config 须为 JSON 对象');
        const entries = Object.entries(cfg);
        if (entries.length === 0) throw new Error('config 不能为空');
        const [serverId, serverCfg] = entries[0]!;
        const c = serverCfg && typeof serverCfg === 'object' ? (serverCfg as Record<string, unknown>) : {};
        if (!id) id = serverId;
        if (!url) url = typeof c.url === 'string' ? c.url.trim() : undefined;
        if (c.headers && typeof c.headers === 'object') {
          headers = Object.fromEntries(Object.entries(c.headers).map(([k, v]) => [String(k), String(v)]));
        }
        if (!name && typeof c.name === 'string') name = c.name.trim();
      } catch (e) {
        throw new Error(`x.add_mcp_server: config 解析失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!id) throw new Error('x.add_mcp_server: id 必填，或通过 config 传入 {"serverId":{...}}');
    const raw = await getConfigValue(getConfig, userId, MCP_CONFIG_KEY);
    const servers = raw?.trim()
      ? normalizeMcpConfig((() => {
          try {
            const p = JSON.parse(raw) as unknown;
            return Array.isArray(p) ? { servers: p } : (typeof p === 'object' && p !== null ? p : {});
          } catch {
            return {};
          }
        })())
      : [];
    if (servers.some((s) => s.id === id)) throw new Error(`x.add_mcp_server: id "${id}" 已存在`);
    if (!url) url = typeof input.url === 'string' ? input.url.trim() || undefined : undefined;
    if (!name && typeof input.name === 'string') name = input.name.trim() || undefined;
    if (headers === undefined && typeof input.headers === 'string' && input.headers.trim()) {
      try {
        const h = JSON.parse(input.headers);
        if (h && typeof h === 'object') headers = Object.fromEntries(Object.entries(h).map(([k, v]) => [String(k), String(v)]));
      } catch {
        throw new Error('x.add_mcp_server: headers 须为 JSON 对象');
      }
    }
    if (!command) command = typeof input.command === 'string' ? input.command.trim() || undefined : undefined;
    if (args === undefined && typeof input.args === 'string' && input.args.trim()) {
      try {
        const a = JSON.parse(input.args);
        args = Array.isArray(a) ? a.map(String) : undefined;
      } catch {
        throw new Error('x.add_mcp_server: args 须为 JSON 数组');
      }
    }
    if (url) {
      const s: McpServerConfig = { id, name, url, headers };
      servers.push(s);
    } else if (command) {
      const s: McpServerConfig = { id, name, command, args };
      servers.push(s);
    } else {
      throw new Error('x.add_mcp_server: 需提供 url（HTTP）或 command+args（Stdio）');
    }
    const setResult = setConfig(userId, MCP_CONFIG_KEY, JSON.stringify(servers));
    if (setResult instanceof Promise) await setResult;
    if (reloadMcp) await reloadMcp(userId);
    return { ok: true, message: `已添加 MCP 服务器 ${id}，配置已重载` };
  };

  const updateMcpServerHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.update_mcp_server: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    const reloadMcp = ctx?.reloadMcpForUser;
    if (!getConfig || !setConfig) throw new Error('x.update_mcp_server: 配置不可用');
    const id = String(input.id ?? '').trim();
    if (!id) throw new Error('x.update_mcp_server: id 必填');
    const raw = await getConfigValue(getConfig, userId, MCP_CONFIG_KEY);
    const servers = raw?.trim()
      ? normalizeMcpConfig((() => {
          try {
            const p = JSON.parse(raw) as unknown;
            return Array.isArray(p) ? { servers: p } : (typeof p === 'object' && p !== null ? p : {});
          } catch {
            return {};
          }
        })())
      : [];
    const idx = servers.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`x.update_mcp_server: 未找到 id "${id}"`);
    const s = servers[idx];
    if (typeof input.name === 'string') s.name = input.name.trim() || s.id;
    if (typeof input.url === 'string') s.url = input.url.trim() || undefined;
    if (typeof input.headers === 'string' && input.headers.trim()) {
      try {
        const h = JSON.parse(input.headers);
        if (h && typeof h === 'object') s.headers = Object.fromEntries(Object.entries(h).map(([k, v]) => [String(k), String(v)]));
      } catch {
        throw new Error('x.update_mcp_server: headers 须为 JSON 对象');
      }
    }
    if (typeof input.command === 'string') s.command = input.command.trim() || undefined;
    if (typeof input.args === 'string' && input.args.trim()) {
      try {
        const a = JSON.parse(input.args);
        s.args = Array.isArray(a) ? a.map(String) : undefined;
      } catch {
        throw new Error('x.update_mcp_server: args 须为 JSON 数组');
      }
    }
    const setResult = setConfig(userId, MCP_CONFIG_KEY, JSON.stringify(servers));
    if (setResult instanceof Promise) await setResult;
    if (reloadMcp) await reloadMcp(userId);
    return { ok: true, message: `已更新 MCP 服务器 ${id}，配置已重载` };
  };

  const removeMcpServerHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.remove_mcp_server: 需要已登录用户');
    const getConfig = ctx?.getConfig;
    const setConfig = ctx?.setConfig;
    const reloadMcp = ctx?.reloadMcpForUser;
    if (!getConfig || !setConfig) throw new Error('x.remove_mcp_server: 配置不可用');
    const id = String(input.id ?? '').trim();
    if (!id) throw new Error('x.remove_mcp_server: id 必填');
    const raw = await getConfigValue(getConfig, userId, MCP_CONFIG_KEY);
    const servers = raw?.trim()
      ? normalizeMcpConfig((() => {
          try {
            const p = JSON.parse(raw) as unknown;
            return Array.isArray(p) ? { servers: p } : (typeof p === 'object' && p !== null ? p : {});
          } catch {
            return {};
          }
        })())
      : [];
    const next = servers.filter((s) => s.id !== id);
    if (next.length === servers.length) throw new Error(`x.remove_mcp_server: 未找到 id "${id}"`);
    const setResult = setConfig(userId, MCP_CONFIG_KEY, JSON.stringify(next));
    if (setResult instanceof Promise) await setResult;
    if (reloadMcp) await reloadMcp(userId);
    return { ok: true, message: `已删除 MCP 服务器 ${id}，配置已重载` };
  };

  // ── Proactive read ────────────────────────────────────────────────────────

  const markProactiveReadHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') throw new Error('x.mark_proactive_read: 需要已登录用户');
    let ids: string[] = [];
    if (input.message_id && typeof input.message_id === 'string') ids = [input.message_id.trim()];
    if (ids.length === 0 && input.message_ids) {
      try {
        const raw = typeof input.message_ids === 'string' ? input.message_ids : JSON.stringify(input.message_ids);
        const arr = JSON.parse(raw);
        ids = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
      } catch {
        throw new Error('x.mark_proactive_read: message_ids 须为 JSON 数组字符串');
      }
    }
    for (const id of ids) if (id) await markReadWithHistory(resolveDB()??undefined,userId,id);
    return { ok: true, marked: ids.length };
  };

  // ── MiniApp Backend ──────────────────────────────────────────────────────

  const backendKvSetHandler = async (input: any, ctx: any): Promise<unknown> => {
    const db = resolveDB();
    if (!db) throw new Error('backend.kv_set: 数据库不可用');
    const userId = requireUserId(ctx, 'backend.kv_set');
    const appId = String(input.app_id ?? '').trim();
    const key = String(input.key ?? '').trim();
    const value = String(input.value ?? '');
    if (!appId || !key) throw new Error('backend.kv_set: app_id 与 key 必填');
    db.appBackendKvSet(userId, appId, key, value);
    return { ok: true };
  };

  const backendKvGetHandler = async (input: any, ctx: any): Promise<unknown> => {
    const db = resolveDB();
    if (!db) throw new Error('backend.kv_get: 数据库不可用');
    const userId = requireUserId(ctx, 'backend.kv_get');
    const appId = String(input.app_id ?? '').trim();
    const key = String(input.key ?? '').trim();
    if (!appId || !key) throw new Error('backend.kv_get: app_id 与 key 必填');
    const value = db.appBackendKvGet(userId, appId, key);
    if (value === undefined) return { found: false };
    return { found: true, value };
  };

  const backendKvDeleteHandler = async (input: any, ctx: any): Promise<unknown> => {
    const db = resolveDB();
    if (!db) throw new Error('backend.kv_delete: 数据库不可用');
    const userId = requireUserId(ctx, 'backend.kv_delete');
    const appId = String(input.app_id ?? '').trim();
    const key = String(input.key ?? '').trim();
    if (!appId || !key) throw new Error('backend.kv_delete: app_id 与 key 必填');
    db.appBackendKvDelete(userId, appId, key);
    return { ok: true };
  };

  const backendKvListHandler = async (input: any, ctx: any): Promise<unknown> => {
    const db = resolveDB();
    if (!db) throw new Error('backend.kv_list: 数据库不可用');
    const userId = requireUserId(ctx, 'backend.kv_list');
    const appId = String(input.app_id ?? '').trim();
    const prefix = (input.prefix as string)?.trim() || undefined;
    if (!appId) throw new Error('backend.kv_list: app_id 必填');
    const keys = db.appBackendKvList(userId, appId, prefix);
    return { keys };
  };

  const backendQueuePushHandler = async (input: any, ctx: any): Promise<unknown> => {
    const db = resolveDB();
    if (!db) throw new Error('backend.queue_push: 数据库不可用');
    const userId = requireUserId(ctx, 'backend.queue_push');
    const appId = String(input.app_id ?? '').trim();
    const queueName = String(input.queue_name ?? '').trim();
    const payload = String(input.payload ?? '');
    if (!appId || !queueName) throw new Error('backend.queue_push: app_id 与 queue_name 必填');
    db.appBackendQueuePush(userId, appId, queueName, payload);
    return { ok: true };
  };

  const backendQueuePopHandler = async (input: any, ctx: any): Promise<unknown> => {
    const db = resolveDB();
    if (!db) throw new Error('backend.queue_pop: 数据库不可用');
    const userId = requireUserId(ctx, 'backend.queue_pop');
    const appId = String(input.app_id ?? '').trim();
    const queueName = String(input.queue_name ?? '').trim();
    if (!appId || !queueName) throw new Error('backend.queue_pop: app_id 与 queue_name 必填');
    const payload = db.appBackendQueuePop(userId, appId, queueName);
    if (payload === null) return { empty: true };
    return { empty: false, payload };
  };

  const backendQueueLenHandler = async (input: any, ctx: any): Promise<unknown> => {
    const db = resolveDB();
    if (!db) throw new Error('backend.queue_len: 数据库不可用');
    const userId = requireUserId(ctx, 'backend.queue_len');
    const appId = String(input.app_id ?? '').trim();
    const queueName = String(input.queue_name ?? '').trim();
    if (!appId || !queueName) throw new Error('backend.queue_len: app_id 与 queue_name 必填');
    const length = db.appBackendQueueLen(userId, appId, queueName);
    return { length };
  };

  const backendBroadcastHandler = async (input: any, ctx: any): Promise<unknown> => {
    const userId = requireUserId(ctx, 'backend.broadcast_to_app');
    const appId = String(input.app_id ?? '').trim();
    const message = input.message != null ? String(input.message) : '';
    if (!appId) throw new Error('backend.broadcast_to_app: app_id 必填');
    broadcastToAppChannel(userId, appId, message);
    return { ok: true };
  };

  return {
    // Email
    sendEmailHandler,
    listEmailConfigsHandler,
    setEmailConfigHandler,
    deleteEmailConfigHandler,
    // IMAP
    checkEmailHandler,
    listEmailImapConfigHandler,
    setEmailImapConfigHandler,
    setEmailFromFilterHandler,
    listEmailFromFilterHandler,
    // Notifications
    sendWhatsAppHandler,
    sendTelegramHandler,
    sendDiscordHandler,
    sendSlackHandler,
    sendQQHandler,
    // MCP
    listMcpConfigHandler,
    addMcpServerHandler,
    updateMcpServerHandler,
    removeMcpServerHandler,
    // Proactive
    markProactiveReadHandler,
    // MiniApp backend
    backendKvSetHandler,
    backendKvGetHandler,
    backendKvDeleteHandler,
    backendKvListHandler,
    backendQueuePushHandler,
    backendQueuePopHandler,
    backendQueueLenHandler,
    backendBroadcastHandler,
  };
}
