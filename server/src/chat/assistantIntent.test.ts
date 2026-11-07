import { describe, expect, it } from 'vitest';
import { classifyAssistantIntentFast } from './assistantIntent.js';

describe('classifyAssistantIntentFast', () => {
  it('routes ordinary chat without invoking a model classifier', () => {
    expect(classifyAssistantIntentFast('你好，介绍一下你自己', false)).toEqual({
      intent: 'normal_chat',
      source: 'rules',
    });
  });

  it('recognizes image generation in Chinese and English', () => {
    expect(classifyAssistantIntentFast('帮我生成一张未来城市图片', false)?.intent)
      .toBe('generate_image');
    expect(classifyAssistantIntentFast('draw an image of a robot', false)?.intent)
      .toBe('generate_image');
  });

  it('routes explicit document paths through the file-capable agent', () => {
    expect(classifyAssistantIntentFast('分析销售数据并保存到 文档/销售复盘.md', false))
      .toEqual({
        intent: 'normal_chat',
        source: 'rules',
      });
  });

  it('keeps explicit file-tool requests in the agent path', () => {
    expect(classifyAssistantIntentFast(
      '请使用文件工具真正写入文件 文档/能力测试.md',
      false,
    )).toEqual({
      intent: 'normal_chat',
      source: 'rules',
    });
  });

  it('distinguishes editor saving and current document editing', () => {
    expect(classifyAssistantIntentFast('把刚才的内容写入编辑器', false)?.intent)
      .toBe('save_to_editor');
    expect(classifyAssistantIntentFast('把当前文档的标题改成季度总结', true)?.intent)
      .toBe('edit_current_document');
  });

  it('only creates tasks when the user explicitly asks for one', () => {
    expect(classifyAssistantIntentFast('创建一个任务，后台持续跟进日报', false)?.intent)
      .toBe('create_task');
    expect(classifyAssistantIntentFast('帮我写一份日报', false)?.intent)
      .toBe('normal_chat');
  });

  it('falls back when special intent signals are ambiguous', () => {
    expect(classifyAssistantIntentFast('这个图片功能怎么配置？', false)).toBeNull();
  });
});
