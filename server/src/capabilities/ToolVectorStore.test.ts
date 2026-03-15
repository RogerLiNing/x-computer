import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';
import { ToolVectorStore, contentHash } from './ToolVectorStore.js';

describe('ToolVectorStore', () => {
  let store: ToolVectorStore;

  beforeEach(() => {
    const dir = path.join(os.tmpdir(), `tool-vector-test-${Date.now()}`);
    store = new ToolVectorStore(dir);
  });

  it('contentHash 相同能力列表得到相同哈希', () => {
    const list = [
      { name: 'a', description: 'desc a' },
      { name: 'b', description: 'desc b' },
    ];
    expect(contentHash(list)).toBe(contentHash([...list]));
    expect(contentHash(list)).toBe(contentHash([list[1], list[0]]));
  });

  it('contentHash 不同能力列表得到不同哈希', () => {
    const list1 = [{ name: 'a', description: 'desc' }];
    const list2 = [{ name: 'a', description: 'desc2' }];
    const list3 = [{ name: 'b', description: 'desc' }];
    expect(contentHash(list1)).not.toBe(contentHash(list2));
    expect(contentHash(list1)).not.toBe(contentHash(list3));
  });

  it('syncFull 后 search 返回向量相似结果', async () => {
    const capabilities = [
      { name: 'file.read', description: '读取文件内容' },
      { name: 'file.write', description: '写入文件' },
    ];
    await store.syncFull(capabilities, async (texts) => {
      return texts.map(() => Array(4).fill(0).map(() => Math.random()));
    });
    const queryVector = [0.1, 0.2, 0.3, 0.4];
    const results = await store.search(queryVector, 2);
    expect(results.length).toBeLessThanOrEqual(2);
    expect(results.every((r) => r.name && r.description)).toBe(true);
  });

  it('syncFull 空列表清空索引', async () => {
    await store.syncFull(
      [{ name: 'x', description: 'y' }],
      async (texts) => texts.map(() => [1, 2, 3]),
    );
    await store.syncFull([], async () => []);
    const results = await store.search([1, 2, 3], 10);
    expect(results).toEqual([]);
  });

  it('search 返回的每条结果包含 name 与 description，可提取为工具名列表', async () => {
    const capabilities = [
      { name: 'file.read', description: '从沙箱读取文件内容' },
      { name: 'file.write', description: '将内容写入沙箱文件' },
      { name: 'grep', description: '在沙箱文件中按正则搜索' },
    ];
    await store.syncFull(capabilities, async (texts) => {
      return texts.map((_, i) => Array(8).fill(0).map((_, j) => (i + 1) * 0.1 + j * 0.01));
    });
    const results = await store.search(Array(8).fill(0.15), 10);
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('description');
      expect(typeof r.name).toBe('string');
      expect(typeof r.description).toBe('string');
    }
    const toolNames = results.map((r) => r.name);
    expect(toolNames).toContain('file.read');
    expect(toolNames).toContain('file.write');
    expect(toolNames).toContain('grep');
  });
});
