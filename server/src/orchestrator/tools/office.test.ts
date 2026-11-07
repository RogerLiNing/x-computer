import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SandboxFS } from '../../tooling/SandboxFS.js';
import { createOfficeHandlers, officeDefinitions } from './office.js';
import { createHash } from 'node:crypto';

describe('office tools', () => {
  let root = '';
  let sandbox: SandboxFS;
  let handlers: ReturnType<typeof createOfficeHandlers>;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'x-computer-office-tools-'));
    sandbox = new SandboxFS(root);
    await sandbox.init();
    handlers = createOfficeHandlers({
      resolveFS: async () => sandbox,
    } as any);
  });

  // Retain generated Office fixtures for visual inspection and provenance.

  it('registers the complete Office tool set', () => {
    expect(officeDefinitions.map((definition) => definition.name)).toEqual([
      'office.edit_copy',
      'office.create_docx',
      'office.read_docx',
      'office.create_xlsx',
      'office.read_xlsx',
      'office.create_pptx',
      'office.read_pptx',
    ]);
  });

  it('creates and reads a real DOCX file', async () => {
    const created = await handlers.get('office.create_docx')!({
      path: '文档/测试报告.docx',
      title: '测试报告',
      content: '# 摘要\n---\n这是**重要**正文。\n- 第一项\n- 第二项',
    });
    expect(created).toMatchObject({ ok: true, created: true, path: '文档/测试报告.docx' });

    const binary = await sandbox.readBinary('文档/测试报告.docx');
    expect(binary.subarray(0, 2).toString()).toBe('PK');

    const read = await handlers.get('office.read_docx')!({ path: '文档/测试报告.docx' });
    expect(read).toMatchObject({ ok: true, path: '文档/测试报告.docx' });
    expect((read as { content: string }).content).toContain('测试报告');
    expect((read as { content: string }).content).toContain('第一项');
    expect((read as { content: string }).content).toContain('这是重要正文');
    expect((read as { content: string }).content).not.toContain('**');
    expect((read as { content: string }).content).not.toContain('---');
  });

  it('creates and reads a real PPTX file', async () => {
    const created = await handlers.get('office.create_pptx')!({
      path: '文档/测试演示.pptx',
      slides: [
        { title: '封面', content: '真实 PPTX 测试' },
        { title: '结论', content: '第一点\n第二点' },
      ],
    });
    expect(created).toMatchObject({ ok: true, created: true, path: '文档/测试演示.pptx', slides: 2 });

    const binary = await sandbox.readBinary('文档/测试演示.pptx');
    expect(binary.subarray(0, 2).toString()).toBe('PK');

    const read = await handlers.get('office.read_pptx')!({ path: '文档/测试演示.pptx' });
    expect(read).toMatchObject({ ok: true, path: '文档/测试演示.pptx' });
    expect((read as { slides: Array<{ title?: string }> }).slides).toHaveLength(2);
    expect((read as { slides: Array<{ title?: string }> }).slides[0]?.title).toBe('封面');
    expect((read as { slides: Array<{ content?: string }> }).slides[1]?.content).toContain('第一点');
  });

  it('rejects mismatched file extensions', async () => {
    await expect(
      handlers.get('office.create_docx')!({
        path: '文档/错误.txt',
        content: '内容',
      }),
    ).rejects.toThrow('path 必须以 .docx 结尾');
  });
  it('edits a source by fingerprint into a copy and never overwrites existing Office creations', async () => {
    const create = handlers.get('office.create_docx')!;
    await create({path:'source.docx',content:'保持原稿 OLD'});
    const source = await sandbox.readBinary('source.docx');
    const result = await handlers.get('office.edit_copy')!({path:'source.docx',expected_sha256:createHash('sha256').update(source).digest('hex'),find:'OLD',replace:'NEW',expected_occurrences:1}) as {path:string;ok:boolean};
    expect(result.ok).toBe(true);expect(result.path).not.toBe('source.docx');
    expect(await sandbox.readBinary('source.docx')).toEqual(source);
    await expect(create({path:'source.docx',content:'overwrite'})).rejects.toMatchObject({code:'EEXIST'});
  });
});
