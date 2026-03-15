import { describe, it, expect, beforeEach } from 'vitest';
import { VectorStore } from './vectorStore.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

describe('VectorStore', () => {
  let sandboxFS: SandboxFS;
  let vectorStore: VectorStore;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = path.join(os.tmpdir(), `vectorstore-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });
    sandboxFS = new SandboxFS(testRoot);
    await sandboxFS.init();
    vectorStore = new VectorStore(sandboxFS);
  });

  it('should not duplicate entries when saving multiple times', async () => {
    const entry = {
      filePath: 'memory/test.md',
      date: '2026-02-28',
      text: 'Test content',
      vector: [0.1, 0.2, 0.3],
    };

    // 添加第一次
    await vectorStore.add(entry, 'test-workspace');
    let count1 = await vectorStore.count('test-workspace');
    expect(count1).toBe(1);

    // 添加第二次（不同内容）
    await vectorStore.add({ ...entry, text: 'Different content' }, 'test-workspace');
    let count2 = await vectorStore.count('test-workspace');
    expect(count2).toBe(2);

    // 验证文件内容不重复
    const indexPath = 'memory/.vector_index_test-workspace.json';
    const content = await sandboxFS.read(indexPath);
    const parsed = JSON.parse(content);
    
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0].text).toBe('Test content');
    expect(parsed.entries[1].text).toBe('Different content');

    // 确保文件只有一个 JSON 对象，不是追加的多个
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(1); // 应该只有一行，不是多行追加
  });

  it('should overwrite index file instead of appending', async () => {
    const entry1 = {
      filePath: 'memory/test1.md',
      date: '2026-02-28',
      text: 'First entry',
      vector: [0.1, 0.2, 0.3],
    };

    const entry2 = {
      filePath: 'memory/test2.md',
      date: '2026-02-28',
      text: 'Second entry',
      vector: [0.4, 0.5, 0.6],
    };

    // 添加两次
    await vectorStore.add(entry1, 'test-workspace');
    await vectorStore.add(entry2, 'test-workspace');

    // 读取文件内容
    const indexPath = 'memory/.vector_index_test-workspace.json';
    const content = await sandboxFS.read(indexPath);
    
    // 应该能正常解析为单个 JSON 对象
    expect(() => JSON.parse(content)).not.toThrow();
    
    const parsed = JSON.parse(content);
    expect(parsed.entries).toHaveLength(2);

    // 验证不是 NDJSON 格式（每行一个 JSON）
    const lines = content.trim().split('\n').filter(l => l.trim());
    expect(lines.length).toBe(1); // 应该是单行 JSON，不是多行
  });
});
