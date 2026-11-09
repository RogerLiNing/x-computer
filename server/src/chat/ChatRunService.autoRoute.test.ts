import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChatRunService } from './ChatRunService.js';
import { SandboxFS } from '../tooling/SandboxFS.js';

describe('virtual model routing inside a run', () => {
  let rows: Map<string, any>; let configs: Map<string, string>; let db: any; let sandbox: SandboxFS; let loop: ReturnType<typeof vi.fn>; let getLLMConfig: ReturnType<typeof vi.fn>;
  const route = { cheap: { providerId: 'minimax', modelId: 'MiniMax-M3.1-Flash' }, strong: { providerId: 'deepseek', modelId: 'deepseek-chat' } };
  beforeEach(async () => {
    rows = new Map(); configs = new Map();
    db = {
      getConfig: async (user: string, key: string) => configs.get(`${user}:${key}`),
      setConfig: async (user: string, key: string, value: string) => { configs.set(`${user}:${key}`, value); },
      getAllTasks: async () => [...rows.values()],
      getSession: async (id: string) => ({ id, user_id: 'u1' }),
      insertTask: vi.fn(async (row: any) => { rows.set(row.id, structuredClone(row)); }),
      upsertRunMessage: vi.fn(async () => {}),
    };
    sandbox = new SandboxFS(await mkdtemp(path.join(os.tmpdir(), 'auto-route-')));
    loop = vi.fn(async (params) => { await params.onCheckpoint([...params.messages, { role: 'assistant', content: '好的' }]); return { content: '好的', stopReason: 'completed' }; });
    getLLMConfig = vi.fn(async (_user: string, providerId: string, modelId: string) => ({ providerId, modelId, apiKey: 'k' }));
  });
  const create = () => new ChatRunService({ db, orchestrator: { runChatAgentLoop: loop } as any, getSandboxFS: async () => sandbox, getLLMConfig });
  const accept = (service: ChatRunService, content: string, requestId = 'r1') => service.accept({ userId: 'u1', sessionId: 's1', requestId, messages: [{ role: 'user', content }], providerId: 'auto', modelId: 'auto', systemPrompt: 'sys' });

  it('sends a short greeting to the cheap model and a writing task to the strong one, remembering the choice', async () => {
    configs.set('u1:llm_config', JSON.stringify({ providers: [], autoRoute: route }));
    const service = create();
    const chat = await accept(service, '早上好');
    await service.launch('u1', chat.id);
    expect(getLLMConfig).toHaveBeenLastCalledWith('u1', 'minimax', 'MiniMax-M3.1-Flash');
    const writing = await accept(service, '帮我写一篇孕期饮食方案', 'r2');
    await service.launch('u1', writing.id);
    expect(getLLMConfig).toHaveBeenLastCalledWith('u1', 'deepseek', 'deepseek-chat');
    const stored = JSON.parse(rows.get(writing.id).metadata_json).chatRun;
    expect(stored.routedModel).toMatchObject({ tier: 'strong', modelId: 'deepseek-chat' });
    expect((await service.get('u1', writing.id)).status).toBe('completed');
  });

  it('blocks clearly when auto is selected but no route is configured', async () => {
    const service = create();
    const run = await accept(service, '你好');
    await service.launch('u1', run.id);
    const snapshot = await service.get('u1', run.id);
    expect(snapshot.status).toBe('blocked');
    expect(snapshot.error).toContain('autoRoute');
    expect(loop).not.toHaveBeenCalled();
  });

  it('leaves physical model selections untouched', async () => {
    const service = create();
    const run = await service.accept({ userId: 'u1', sessionId: 's1', requestId: 'r3', messages: [{ role: 'user', content: '写一篇文章' }], providerId: 'openai', modelId: 'gpt-4o', systemPrompt: 'sys' });
    await service.launch('u1', run.id);
    expect(getLLMConfig).toHaveBeenLastCalledWith('u1', 'openai', 'gpt-4o');
  });
});
