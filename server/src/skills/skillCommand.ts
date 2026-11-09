import type { ChatMessage } from '../chat/chatService.js';
import { getSkillContentByName, parseSkillCommand } from './discovery.js';

const MAX_SKILL_CHARS = 24_000;

/**
 * `/skill:name request` in the newest user message loads that skill's SKILL.md into the message itself,
 * so a skill marked `disable-model-invocation` is still reachable when the person asks for it by name.
 * Returns the same array when there is nothing to expand.
 */
export function expandSkillCommand(messages: readonly ChatMessage[], userId: string | undefined, load: typeof getSkillContentByName = getSkillContentByName): ChatMessage[] {
  const index = messages.map((message) => message.role).lastIndexOf('user');
  if (index < 0) return [...messages];
  const command = parseSkillCommand(messages[index]!.content ?? '');
  if (!command) return [...messages];
  const skill = load(command.name, userId);
  const content = skill
    ? [`【用户显式调用 Skill「${skill.name}」，请按其说明执行】`, skill.content.slice(0, MAX_SKILL_CHARS), command.args ? `\n用户的要求：${command.args}` : '\n用户没有附加要求，请按 Skill 的默认流程开始。'].join('\n\n')
    : `用户想使用 Skill「${command.name}」，但当前没有这个 Skill。请如实告诉用户，并列出可用的 Skill。${command.args ? `\n用户原本的要求：${command.args}` : ''}`;
  return messages.map((message, position) => (position === index ? { ...message, content } : message));
}
