import { createHash } from 'node:crypto';
import type { ChannelReplyAddress } from '../scheduler/ScheduledOccurrenceService.js';
import { SendExecutionDeniedError } from '../tooling/sendApproval.js';
import { getQQConnection, sendQQMessage } from '../qq/qqService.js';
import { getWhatsAppConnection, sendWhatsAppMessage } from '../whatsapp/whatsappService.js';
import { getTelegramConnection, sendTelegramMessage } from '../telegram/telegramService.js';
import { getDiscordConnection, sendDiscordMessage } from '../discord/discordService.js';
import { getSlackConnection, sendSlackMessage } from '../slack/slackService.js';

type ConfigReader = (userId: string, key: string) => string | undefined | Promise<string | undefined>;
export function createChannelReplyTransport(getConfig: ConfigReader) {
  const connections = { qq: getQQConnection, whatsapp: getWhatsAppConnection, telegram: getTelegramConnection, discord: getDiscordConnection, slack: getSlackConnection };
  const ready = async (userId: string, address: ChannelReplyAddress) => {
    if (typeof address.accountId !== 'string' || !address.accountId || address.legacyUnbound || !Object.hasOwn(connections,address.channel)) throw new SendExecutionDeniedError('来源账号无法核对，自动回复尚未发送，请人工核对历史消息');
    const raw = await getConfig(userId, address.channel + '_config');
    let enabled = false; try { enabled = !!raw && JSON.parse(raw).enabled === true; } catch { /* Invalid settings cannot authorize replies. */ }
    if (!raw || !enabled || createHash('sha256').update(raw).digest('hex') !== address.configDigest) throw new SendExecutionDeniedError('渠道配置已变化，自动回复尚未发送，请恢复原配置后重试');
    const sender = connections[address.channel](userId, getConfig).getSendIdentity();
    if (!sender || sender.accountId !== address.accountId) throw new SendExecutionDeniedError('发送账号已变化或未连接，自动回复尚未发送，请切回原账号');
    return { sender, raw };
  };
  return {
    validate: async (userId: string, address: ChannelReplyAddress) => { await ready(userId, address); },
    send: async (userId: string, address: ChannelReplyAddress, text: string, assertActive?: () => Promise<void>): Promise<boolean> => {
      await ready(userId, address);
      await assertActive?.();
      const { sender, raw } = await ready(userId, address);
      await assertActive?.();
      const scopedConfig: ConfigReader = (uid, key) => uid === userId && key === address.channel + '_config' ? raw : getConfig(uid, key);
      switch (address.channel) {
        case 'qq':
          if (!address.targetType) throw new SendExecutionDeniedError('回复地址类型缺失，消息尚未发送');
          return (await sendQQMessage(scopedConfig, userId, { type: address.targetType, id: address.target }, text, sender.binding)).ok;
        case 'whatsapp': return (await sendWhatsAppMessage(scopedConfig, userId, address.target, text, sender.binding)).ok;
        case 'telegram': return (await sendTelegramMessage(scopedConfig, userId, address.target, text, sender.binding)).ok;
        case 'discord': return (await sendDiscordMessage(scopedConfig, userId, address.target, text, sender.binding)).ok;
        case 'slack': return (await sendSlackMessage(scopedConfig, userId, address.target, text, address.thread, sender.binding)).ok;
      }
    },
  };
}
