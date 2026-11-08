import { SPACE_FILE_TOOL_NAMES, SPACE_TOOL_NAMES } from '../orchestrator/tools/space.js';
import type { ChannelReplyAddress } from './ScheduledOccurrenceService.js';

/**
 * 渠道消息能用哪些工具。
 *
 * 每个用户配置的是自己的 QQ 机器人，私聊里说话的就是机器人主人本人（QQ 平台测试模式下只有测试者能私聊）。
 * 如果把机器人对外开放，必须在 QQ 设置里把私聊策略改成白名单，否则陌生人也能让助手动用这些工具。
 * 文件工具能读写本人的文件和所在空间的文件，同样只开放给私聊。
 * 群聊、频道里可能有其他人，仍然只聊天、不动用工具。
 * 提醒和定时任务到点后目前只送到网页对话，送不回 QQ，所以先不在这里开放，避免答应了却提醒不到。
 */
export const CHANNEL_OWNER_TOOLS: readonly string[] = Object.freeze([
  ...SPACE_TOOL_NAMES,
  ...SPACE_FILE_TOOL_NAMES,
  'memory_search',
  'read_recent_assistant_chat',
]);

const OWNER_PROMPT = [
  '你是用户本人在 QQ 私聊里的个人助手。',
  '可以用提供的工具帮用户办事；只有工具真实返回成功后才能说已经办好，没调用或调用失败就如实说明。',
  '不要把工具调用写成文字发给用户。提醒和定时任务在 QQ 里暂不支持，用户要设提醒时如实告知请在网页里设置。回复简短，适合在手机上阅读。',
].join('\n');

const PUBLIC_PROMPT = '你是外部渠道中的对话助手。仅依据当前会话中的消息回答。你无权读取工作区、账户资料或其他对话，也不能代替用户执行操作或声称已经执行。直接给出适合发回这个会话的回复。';

export interface ChannelRunPolicy {
  readonly systemPrompt: string;
  readonly allowedToolNames: string[];
}

export function channelRunPolicy(address: Pick<ChannelReplyAddress, 'targetType'>): ChannelRunPolicy {
  if (address.targetType === 'private') {
    return { systemPrompt: OWNER_PROMPT, allowedToolNames: [...CHANNEL_OWNER_TOOLS] };
  }
  return { systemPrompt: PUBLIC_PROMPT, allowedToolNames: [] };
}
