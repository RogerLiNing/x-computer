import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { ChatRunService } from './ChatRunService.js';

describe('native images remain stable across the handoff lifecycle', () => {
  it('resumes and revises with captured bytes while checkpoints remain text-only', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chat-images-'));
    const native = new SqliteAppDatabase(root), db = new SqliteDatabaseAdapter(native);
    const sandbox = new SandboxFS(path.join(root, 'workspace'));
    await sandbox.init();
    const original = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from('original image fixture')]);
    await sandbox.writeBinaryNew('photo.png', original);
    await db.ensureUser('owner');
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const first = vi.fn(async params => {
      await params.onCheckpoint(params.messages);
      entered();
      await new Promise((_resolve, reject) => params.signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
      return { content: '', stopReason: 'completed' };
    });
    const make = (loop: typeof first) => new ChatRunService({
      db, orchestrator: { runChatAgentLoop: loop } as never, getSandboxFS: async () => sandbox,
      getLLMConfig: async () => ({ providerId: 'fixture', modelId: 'fixture' }),
    });
    const runs = make(first), session = await db.createSession('owner');
    const run = await runs.accept({
      userId: 'owner', sessionId: session.id, requestId: 'image-input',
      providerId: 'fixture', modelId: 'fixture', systemPrompt: '',
      messages: [{ role: 'user', content: '帮我看看图片' }], userMessage: { content: '帮我看看图片', images: ['photo.png'] },
    });
    try {
      const execution = runs.launch('owner', run.id);
      await started;
      await runs.stop('owner', run.id);
      await execution;
      await sandbox.writeBinary('photo.png', Buffer.concat([original.subarray(0, 8), Buffer.from('changed original')]));
      const resumed = vi.fn(async params => {
        expect(params.inputImages).toEqual([{ mediaType: 'image/png', data: original.toString('base64') }]);
        await params.onCheckpoint([...params.messages, { role: 'assistant', content: '我已看过图片' }]);
        return { content: '我已看过图片', stopReason: 'completed' };
      });
      const restored = make(resumed);
      await restored.resume('owner', run.id);
      await restored.wait(run.id);
      const done = await restored.get('owner', run.id);
      expect(done.status).toBe('completed');
      await restored.reviewRun('owner', run.id, { decision: 'changes_requested', feedback: '请说得简单一些', expectedUpdatedAt: done.updatedAt });
      const revised = await restored.revise('owner', run.id);
      await restored.wait(revised.id);
      expect((await restored.get('owner', revised.id)).status).toBe('completed');
      expect(resumed).toHaveBeenCalledTimes(2);
      for (const record of await db.getAllTasks()) {
        expect(record.metadata_json).not.toContain(original.toString('base64'));
        expect(record.metadata_json).not.toContain('data:image/');
      }
    } finally {
      native.close();
    }
  });
});
