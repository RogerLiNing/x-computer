import { describe, expect, it, vi } from 'vitest';
import { handleQQMessage, type QQLoopDeps } from './qqLoop.js';
import type { QQMessagePayload } from './qqService.js';

const URL = 'https://grouptalk.c2c.qq.com/asn.com/qqdownloadftnv5?fileType=4001&id=abc';
const attachment = { kind: 'file' as const, url: URL, name: '记录.docx', size: 10 };

function deps() {
  const config = new Map<string, string>();
  const chat = vi.fn(async () => {});
  const insert = vi.fn(async () => {});
  const saveAttachments = vi.fn(async () => [{ attachment, path: 'QQ收到的文件/2026-11-08/记录.docx' }]);
  const value: QQLoopDeps = {
    db: { insertChannelMessage: insert } as unknown as QQLoopDeps['db'],
    getConfig: (_u, k) => config.get(k),
    setConfig: (_u, k, v) => { config.set(k, v); },
    runIntent: () => {},
    runAgent: async () => {},
    handleChannelMessageAsChat: chat,
    saveAttachments,
  };
  return { value, chat, insert, saveAttachments };
}

function message(type: QQMessagePayload['messageType'], id: string): QQMessagePayload {
  return {
    messageType: type, chatId: 'chat', fromId: 'me', fromName: 'Roger', messageId: id, timestamp: 1,
    text: `<file,size=10,url=${URL},name=记录.docx>`, attachments: [attachment],
  };
}

describe('QQ 收到附件', () => {
  it('私聊里的文件会被保存，助手拿到的是保存路径而不是下载链接', async () => {
    const d = deps();
    await handleQQMessage(d.value, 'u1', message('private', 'm1'));
    expect(d.saveAttachments).toHaveBeenCalledWith('u1', [attachment]);
    const text = (d.chat.mock.calls[0] as unknown[])[2] as string;
    expect(text).toBe('[用户发来文件「记录.docx」，已保存到 QQ收到的文件/2026-11-08/记录.docx]');
    expect(text).not.toContain('http');
  });

  it('群聊里的文件不下载，只说明收到了文件', async () => {
    const d = deps();
    await handleQQMessage(d.value, 'u1', message('group', 'm2'));
    expect(d.saveAttachments).not.toHaveBeenCalled();
    expect((d.chat.mock.calls[0] as unknown[])[2]).toBe('[对方发来文件「记录.docx」，这里不会自动保存]');
  });

  it('同一条消息重复推送时不会重复下载', async () => {
    const d = deps();
    await handleQQMessage(d.value, 'u1', message('private', 'm3'));
    await handleQQMessage(d.value, 'u1', message('private', 'm3'));
    expect(d.saveAttachments).toHaveBeenCalledTimes(1);
  });
});
