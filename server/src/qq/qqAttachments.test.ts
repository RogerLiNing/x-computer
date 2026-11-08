import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { describeQQMessage, extractQQAttachments, QQ_INBOX_DIR, saveQQAttachments } from './qqAttachments.js';

const FILE_URL = 'https://grouptalk.c2c.qq.com/asn.com/qqdownloadftnv5?fileType=4001&id=abc';
const NOW = new Date(2026, 10, 8, 22, 35, 44);

function sandbox(): { fs: SandboxFS; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x-qq-attach-'));
  return { fs: new SandboxFS(root), root };
}

function fakeFetch(body: string, status = 200): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const res = new Response(status === 200 ? body : null, { status });
    Object.defineProperty(res, 'url', { value: String(input) });
    return res;
  }) as unknown as typeof fetch;
}

describe('QQ 附件', () => {
  it('从 SDK 消息段里取出文件，忽略文字和格式不对的项', () => {
    const segments = [
      { type: 'text', data: { text: '看看' } },
      { type: 'file', url: FILE_URL, name: '记录.docx', size: '339832' },
      { type: 'image', url: 'https://multimedia.nt.qq.com.cn/download?x=1', size: 10 },
      { type: 'file' },
      null,
    ];
    expect(extractQQAttachments(segments)).toEqual([
      { kind: 'file', url: FILE_URL, name: '记录.docx', size: 339832 },
      { kind: 'image', url: 'https://multimedia.nt.qq.com.cn/download?x=1', size: 10 },
    ]);
    expect(extractQQAttachments(undefined)).toEqual([]);
  });

  it('下载后存到 QQ收到的文件/日期/ 下，同名文件不覆盖', async () => {
    const { fs: sandboxFs, root } = sandbox();
    const attachment = { kind: 'file' as const, url: FILE_URL, name: '记录.docx' };
    const first = await saveQQAttachments(sandboxFs, [attachment], { fetchImpl: fakeFetch('PK-1'), now: NOW });
    const second = await saveQQAttachments(sandboxFs, [attachment], { fetchImpl: fakeFetch('PK-2'), now: NOW });
    expect(first[0].path).toBe(`${QQ_INBOX_DIR}/2026-11-08/记录.docx`);
    expect(second[0].path).toBe(`${QQ_INBOX_DIR}/2026-11-08/记录 (2).docx`);
    expect(fs.readFileSync(path.join(root, QQ_INBOX_DIR, '2026-11-08', '记录.docx'), 'utf8')).toBe('PK-1');
  });

  it('没有文件名的图片按时间命名；文件名里的路径会被去掉', async () => {
    const { fs: sandboxFs } = sandbox();
    const saved = await saveQQAttachments(sandboxFs, [
      { kind: 'image', url: 'https://multimedia.nt.qq.com.cn/d?x=1' },
      { kind: 'file', url: FILE_URL, name: '../../etc/passwd' },
    ], { fetchImpl: fakeFetch('x'), now: NOW });
    expect(saved.map(s => s.path)).toEqual([
      `${QQ_INBOX_DIR}/2026-11-08/图片-223544.jpg`,
      `${QQ_INBOX_DIR}/2026-11-08/passwd`,
    ]);
  });

  it('不是 QQ 文件服务器的链接、过期链接和超大文件都不保存，并说明原因', async () => {
    const { fs: sandboxFs } = sandbox();
    const fetchImpl = fakeFetch('x');
    const saved = await saveQQAttachments(sandboxFs, [
      { kind: 'file', url: 'http://127.0.0.1/secret', name: 'a' },
      { kind: 'file', url: FILE_URL, name: 'big.zip', size: 2048 },
    ], { fetchImpl, now: NOW, maxBytes: 1024 });
    expect(saved[0].error).toContain('不是 QQ 文件服务器');
    expect(saved[1].error).toContain('超过');
    expect(fetchImpl).not.toHaveBeenCalled();

    const expired = await saveQQAttachments(sandboxFs, [{ kind: 'file', url: FILE_URL, name: 'b' }], { fetchImpl: fakeFetch('', 403), now: NOW });
    expect(expired[0].error).toContain('HTTP 403');
  });

  it('把附件标记换成保存位置说明，不把下载链接交给助手', () => {
    const text = `<file,size=339832,url=${FILE_URL},name=记录.docx>`;
    const attachment = { kind: 'file' as const, url: FILE_URL, name: '记录.docx' };
    const described = describeQQMessage(text, [attachment], [{ attachment, path: 'QQ收到的文件/2026-11-08/记录.docx' }]);
    expect(described).toBe('[用户发来文件「记录.docx」，已保存到 QQ收到的文件/2026-11-08/记录.docx]');
    expect(describeQQMessage(`帮我看看 ${text}`, [attachment], [])).toBe('帮我看看\n[对方发来文件「记录.docx」，这里不会自动保存]');
  });
});
