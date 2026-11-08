import { describe, expect, it } from 'vitest';
import { channelRunPolicy, CHANNEL_OWNER_TOOLS } from './channelRunPolicy.js';

describe('channelRunPolicy', () => {
  it('私聊是机器人主人本人，可以用空间和记忆工具', () => {
    const policy = channelRunPolicy({ targetType: 'private' });
    expect(policy.allowedToolNames).toEqual(CHANNEL_OWNER_TOOLS);
    expect(policy.allowedToolNames).toEqual(expect.arrayContaining(['x.space_create', 'x.space_join', 'memory_search']));
    expect(policy.systemPrompt).toContain('工具');
    expect(policy.systemPrompt).not.toContain('无权');
  });

  it('私聊也不开放高风险工具', () => {
    const tools = channelRunPolicy({ targetType: 'private' }).allowedToolNames;
    for (const risky of ['shell.run', 'file.write', 'x.send_qq', 'x.send_email', 'capability.load', 'x.schedule_reminder']) {
      expect(tools).not.toContain(risky);
    }
  });

  it('群聊和频道仍然只能聊天', () => {
    for (const targetType of ['group', 'guild', undefined] as const) {
      const policy = channelRunPolicy({ targetType });
      expect(policy.allowedToolNames).toEqual([]);
      expect(policy.systemPrompt).toContain('无权');
    }
  });
});
