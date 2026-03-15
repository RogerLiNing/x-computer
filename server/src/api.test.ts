import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import path from 'path';
import os from 'os';
import { createApp } from './app.js';

vi.mock('./chat/chatService.js', () => ({
  callLLM: vi.fn().mockResolvedValue('mock-reply'),
  callLLMStream: vi.fn().mockImplementation(async function* () {
    yield 'stream';
  }),
  callLLMWithTools: vi.fn().mockResolvedValue({ content: '', toolCalls: [] }),
}));
import { callLLM, callLLMWithTools } from './chat/chatService.js';

/**
 * API 集成测试：覆盖 /api、/api/fs、/api/shell 下所有接口
 */
describe('API', () => {
  const workspaceRoot = path.join(os.tmpdir(), `x-computer-api-test-${Date.now()}`);
  let app: any, orchestrator: any, sandboxFS: any, db: any;
  const TEST_USER = 'test-api-user-' + Date.now();
  let createdTaskId: string;
  let createdStepId: string;

  beforeAll(async () => {
    const result = await createApp({ workspaceRoot, allowAnonymous: true, databaseType: 'sqlite' });
    app = result.app;
    orchestrator = result.orchestrator;
    sandboxFS = result.sandboxFS;
    db = result.db;
    await sandboxFS.init();
  });

  describe('GET /api/health', () => {
    it('返回 200 与 status ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('version', '0.1.0');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('tasks');
      expect(res.body).toHaveProperty('auditEntries');
    });
  });

  describe('GET /api/mode', () => {
    it('返回当前执行模式', async () => {
      const res = await request(app).get('/api/mode');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('mode');
      expect(['auto', 'approval']).toContain(res.body.mode);
    });
  });

  describe('POST /api/mode', () => {
    it('可设置为 auto', async () => {
      const res = await request(app).post('/api/mode').send({ mode: 'auto' });
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('auto');
    });
    it('可设置为 approval', async () => {
      const res = await request(app).post('/api/mode').send({ mode: 'approval' });
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('approval');
    });
    it('非法 mode 返回 400', async () => {
      const res = await request(app).post('/api/mode').send({ mode: 'invalid' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/context', () => {
    it('返回整机上下文或占位', async () => {
      const res = await request(app).get('/api/context');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/prompts/welcome', () => {
    it('返回主脑欢迎语', async () => {
      const res = await request(app)
        .get('/api/prompts/welcome')
        .set('X-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('content');
      expect(typeof res.body.content).toBe('string');
      expect(res.body.content).toContain('X-Computer');
    });
  });

  describe('POST /api/chat/classify-writing-intent', () => {
    it('缺少 userMessage/providerId/modelId 返回 400', async () => {
      const res = await request(app)
        .post('/api/chat/classify-writing-intent')
        .set('X-User-Id', TEST_USER)
        .send({});
      expect(res.status).toBe(400);
    }, 3000);
    it('缺少 providerId 返回 400', async () => {
      const res = await request(app)
        .post('/api/chat/classify-writing-intent')
        .set('X-User-Id', TEST_USER)
        .send({ userMessage: '写一篇文章', modelId: 'gpt-4o-mini' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/prompt/evolved', () => {
    it('返回当前用户自我进化的核心提示词片段', async () => {
      const res = await request(app).get('/api/prompt/evolved');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('evolvedCorePrompt');
      expect(typeof res.body.evolvedCorePrompt).toBe('string');
    });
  });

  describe('GET /api/x/proactive-messages', () => {
    it('返回 X 主脑主动消息列表', async () => {
      const res = await request(app).get('/api/x/proactive-messages');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('messages');
      expect(Array.isArray(res.body.messages)).toBe(true);
    });
  });

  describe('GET /api/x/scheduled-jobs', () => {
    it('返回 X 主脑定时任务列表', async () => {
      const res = await request(app).get('/api/x/scheduled-jobs');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('jobs');
      expect(Array.isArray(res.body.jobs)).toBe(true);
    });
  });

  describe('GET /api/memory/status', () => {
    it('返回向量索引条数、memory 文件数、工作区根路径', async () => {
      const res = await request(app).get('/api/memory/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('vectorEnabled');
      expect(res.body).toHaveProperty('indexCount');
      expect(res.body).toHaveProperty('filesInMemory');
      expect(res.body).toHaveProperty('workspaceRoot');
      expect(typeof res.body.indexCount).toBe('number');
      expect(typeof res.body.filesInMemory).toBe('number');
      expect(typeof res.body.workspaceRoot).toBe('string');
    });
  });

  describe('GET /api/memory/recall', () => {
    it('返回 200 与 content 字段', async () => {
      const res = await request(app).get('/api/memory/recall');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('content');
      expect(typeof res.body.content).toBe('string');
    });
    it('支持 query 参数 q 与 days', async () => {
      const res = await request(app).get('/api/memory/recall?q=test&days=1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('content');
    });
  });

  describe('POST /api/memory/capture', () => {
    it('缺少 content 返回 400', async () => {
      const res = await request(app).post('/api/memory/capture').send({});
      expect(res.status).toBe(400);
    });
    it('提供 content 返回 200 与 success', async () => {
      const res = await request(app)
        .post('/api/memory/capture')
        .send({ content: '测试记忆写入 ' + Date.now() });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/tasks', () => {
    it('缺少 domain/title/description 返回 400', async () => {
      const res = await request(app).post('/api/tasks').send({});
      expect(res.status).toBe(400);
    });
    it('创建任务并返回 201', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({
          domain: 'chat',
          title: '测试任务',
          description: '用于 API 测试',
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.domain).toBe('chat');
      expect(res.body.title).toBe('测试任务');
      expect(res.body.steps).toBeInstanceOf(Array);
      expect(res.body.steps.length).toBeGreaterThan(0);
      createdTaskId = res.body.id;
      createdStepId = res.body.steps[0]?.id;
    });
  });

  describe('GET /api/tasks', () => {
    it('返回任务列表', async () => {
      const res = await request(app).get('/api/tasks');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((t: { id: string }) => t.id === createdTaskId)).toBe(true);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('存在任务返回 200', async () => {
      const res = await request(app).get(`/api/tasks/${createdTaskId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdTaskId);
    });
    it('不存在任务返回 404', async () => {
      const res = await request(app).get('/api/tasks/non-existent-id');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/tasks/:id/pause', () => {
    it('暂停运行中任务返回 success true', async () => {
      const res = await request(app).post(`/api/tasks/${createdTaskId}/pause`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success');
    });
  });

  describe('POST /api/tasks/:id/resume', () => {
    it('恢复任务返回 200 与 success 字段', async () => {
      const res = await request(app).post(`/api/tasks/${createdTaskId}/resume`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success');
    });
  });

  describe('POST /api/tasks/:id/steps/:stepId/approve', () => {
    it('批准步骤返回 200 与 success', async () => {
      const res = await request(app)
        .post(`/api/tasks/${createdTaskId}/steps/${createdStepId}/approve`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success');
    });
  });

  describe('POST /api/tasks/:id/steps/:stepId/reject', () => {
    it('拒绝不存在的步骤仍返回 200（业务上 false）', async () => {
      const res = await request(app)
        .post(`/api/tasks/${createdTaskId}/steps/${createdStepId}/reject`);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/tasks/:id/retry', () => {
    it('对非失败任务重试返回 400', async () => {
      const res = await request(app)
        .post(`/api/tasks/${createdTaskId}/retry`)
        .send({ mode: 'restart' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
    it('对不存在的任务重试返回 400', async () => {
      const res = await request(app)
        .post('/api/tasks/non-existent-id/retry')
        .send({ mode: 'from_failure' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/tools', () => {
    it('返回工具定义数组', async () => {
      const res = await request(app).get('/api/tools');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      const names = (res.body as { name: string }[]).map((t) => t.name);
      expect(names).toContain('llm.generate_sound_effect');
      expect(names).toContain('llm.generate_music');
    });
  });

  describe('GET /api/capabilities', () => {
    it('返回能力列表（内置+注册）', async () => {
      const res = await request(app).get('/api/capabilities');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty('name');
      expect(res.body[0]).toHaveProperty('description');
    });
  });

  describe('GET /api/mcp/status', () => {
    it('返回 MCP 状态（servers + totalTools）', async () => {
      const res = await request(app).get('/api/mcp/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('servers');
      expect(res.body).toHaveProperty('totalTools');
      expect(Array.isArray(res.body.servers)).toBe(true);
      expect(typeof res.body.totalTools).toBe('number');
    });
  });

  describe('GET /api/mcp/config', () => {
    it('返回 MCP 配置（servers, configPath, fromEnv）', async () => {
      const res = await request(app).get('/api/mcp/config');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('servers');
      expect(res.body).toHaveProperty('configPath');
      expect(res.body).toHaveProperty('fromEnv');
      expect(Array.isArray(res.body.servers)).toBe(true);
      expect(typeof res.body.configPath).toBe('string');
      expect(typeof res.body.fromEnv).toBe('boolean');
    });
  });

  describe('POST /api/mcp/config', () => {
    it('servers 非数组时返回 400', async () => {
      const res = await request(app).post('/api/mcp/config').send({ servers: 'invalid' });
      expect(res.status).toBe(400);
    });
    it('保存空数组并重载返回 200', async () => {
      const res = await request(app).post('/api/mcp/config').send({ servers: [] });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('configPath');
      expect(res.body).toHaveProperty('result');
    });
  });

  describe('POST /api/mcp/test', () => {
    it('缺少 id 或 url 返回 400', async () => {
      const res = await request(app).post('/api/mcp/test').send({ id: 'x' });
      expect(res.status).toBe(400);
    });
    it('无效 URL 时返回 200 且 ok=false', async () => {
      const res = await request(app)
        .post('/api/mcp/test')
        .send({ id: 'test', url: 'https://invalid-mcp.example.invalid/mcp' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/mcp/reload', () => {
    it('重载返回 200', async () => {
      const res = await request(app).post('/api/mcp/reload');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('result');
    });
  });

  describe('POST /api/capabilities/register', () => {
    it('缺少 name 或 description 返回 400', async () => {
      const res = await request(app).post('/api/capabilities/register').send({ name: 'test' });
      expect(res.status).toBe(400);
    });
    it('注册成功返回 200', async () => {
      const res = await request(app)
        .post('/api/capabilities/register')
        .send({ name: 'test_skill', description: '测试技能', source: 'skill' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/policy/rules', () => {
    it('返回策略规则数组', async () => {
      const res = await request(app).get('/api/policy/rules');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/audit', () => {
    it('返回审计日志数组', async () => {
      const res = await request(app).get('/api/audit');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
    it('支持 limit 查询参数', async () => {
      const res = await request(app).get('/api/audit?limit=5');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /api/audit/task/:taskId', () => {
    it('返回指定任务的审计时间线', async () => {
      const res = await request(app).get(`/api/audit/task/${createdTaskId}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ── /api/fs ────────────────────────────────────────────────

  describe('GET /api/fs', () => {
    it('缺少 path 时使用 / 列出根目录', async () => {
      const res = await request(app).get('/api/fs');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('path');
      expect(res.body).toHaveProperty('entries');
      expect(Array.isArray(res.body.entries)).toBe(true);
    });
    it('带 path 列出指定目录', async () => {
      const res = await request(app).get('/api/fs').query({ path: '/文档' });
      expect(res.status).toBe(200);
      expect(res.body.path).toBe('/文档');
      expect(Array.isArray(res.body.entries)).toBe(true);
    });
  });

  describe('GET /api/fs/read', () => {
    it('缺少 path 返回 400', async () => {
      const res = await request(app).get('/api/fs/read');
      expect(res.status).toBe(400);
    });
    it('读取存在的文件', async () => {
      const res = await request(app).get('/api/fs/read').query({ path: '/备忘录.txt' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('content');
      expect(res.body).toHaveProperty('path', '/备忘录.txt');
    });
  });

  describe('POST /api/fs/write', () => {
    it('缺少 path 或 content 返回 400', async () => {
      const res = await request(app).post('/api/fs/write').send({ path: '/a.txt' });
      expect(res.status).toBe(400);
    });
    it('写入新文件成功', async () => {
      const res = await request(app)
        .post('/api/fs/write')
        .send({ path: '/test-write.txt', content: 'hello test' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.path).toBe('/test-write.txt');
    });
    it('写入 HTML 实体编码内容时自动解码为原始 HTML', async () => {
      const encoded =
        '&lt;!DOCTYPE html&gt;\n&lt;html lang="zh"&gt;\n&lt;head&gt;&lt;meta charset="UTF-8"&gt;&lt;/head&gt;\n&lt;body&gt;Hi&lt;/body&gt;\n&lt;/html&gt;';
      const writeRes = await request(app).post('/api/fs/write').send({ path: '/entity-test.html', content: encoded });
      expect(writeRes.status).toBe(200);
      const readRes = await request(app).get('/api/fs/read').query({ path: '/entity-test.html' });
      expect(readRes.status).toBe(200);
      expect(readRes.body.content).toContain('<!DOCTYPE html>');
      expect(readRes.body.content).toContain('<body>Hi</body>');
      expect(readRes.body.content).not.toContain('&lt;');
    });
  });

  describe('POST /api/fs/mkdir', () => {
    it('缺少 path 返回 400', async () => {
      const res = await request(app).post('/api/fs/mkdir').send({});
      expect(res.status).toBe(400);
    });
    it('创建目录成功', async () => {
      const res = await request(app)
        .post('/api/fs/mkdir')
        .send({ path: '/test-dir' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/fs/stat', () => {
    it('缺少 path 返回 400', async () => {
      const res = await request(app).get('/api/fs/stat');
      expect(res.status).toBe(400);
    });
    it('获取文件 stat', async () => {
      const res = await request(app).get('/api/fs/stat').query({ path: '/备忘录.txt' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('size');
      expect(res.body).toHaveProperty('modified');
      expect(res.body).toHaveProperty('isDirectory');
    });
  });

  describe('POST /api/fs/rename', () => {
    it('缺少 oldPath 或 newPath 返回 400', async () => {
      const res = await request(app).post('/api/fs/rename').send({ oldPath: '/a' });
      expect(res.status).toBe(400);
    });
    it('重命名成功', async () => {
      const res = await request(app)
        .post('/api/fs/rename')
        .send({ oldPath: '/test-write.txt', newPath: '/test-renamed.txt' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.oldPath).toBe('/test-write.txt');
      expect(res.body.newPath).toBe('/test-renamed.txt');
    });
  });

  describe('POST /api/fs/delete', () => {
    it('缺少 path 返回 400', async () => {
      const res = await request(app).post('/api/fs/delete').send({});
      expect(res.status).toBe(400);
    });
    it('删除文件成功', async () => {
      const res = await request(app)
        .post('/api/fs/delete')
        .send({ path: '/test-renamed.txt' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── /api/shell ─────────────────────────────────────────────

  describe('POST /api/shell/exec', () => {
    it('缺少 command 返回 400', async () => {
      const res = await request(app).post('/api/shell/exec').send({});
      expect(res.status).toBe(400);
    });
    it('执行命令返回 stdout/stderr/exitCode', async () => {
      const res = await request(app)
        .post('/api/shell/exec')
        .send({ command: 'echo hello' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('stdout');
      expect(res.body).toHaveProperty('stderr');
      expect(res.body).toHaveProperty('exitCode');
      expect(res.body.stdout).toContain('hello');
      expect(res.body.exitCode).toBe(0);
    });
  });

  // ── POST /api/chat (P2) ─────────────────────────────────────

  describe('POST /api/chat', () => {
    it('缺少 messages/providerId/modelId 返回 400', async () => {
      const res = await request(app).post('/api/chat').send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
    it('缺少 providerId 返回 400', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: 'hi' }], modelId: 'gpt-4o-mini' });
      expect(res.status).toBe(400);
    });
    it('空 messages 返回 400', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ messages: [], providerId: 'openai', modelId: 'gpt-4o-mini' });
      expect(res.status).toBe(400);
    });
    it('超过 51 条消息时截断为 51 条再调用 LLM（上下文截断）', async () => {
      const many = Array.from({ length: 60 }, (_, i) =>
        i % 2 === 0 ? { role: 'user', content: `u${i}` } : { role: 'assistant', content: `a${i}` },
      );
      const res = await request(app)
        .post('/api/chat')
        .send({
          messages: many,
          providerId: 'openai',
          modelId: 'gpt-4o-mini',
          baseUrl: 'https://api.openai.com',
          apiKey: 'test-key',
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('content', 'mock-reply');
      const callWith51 = vi.mocked(callLLM).mock.calls.find((c) => c[0].messages.length === 51);
      expect(callWith51).toBeDefined();
      const passedMessages = callWith51![0].messages;
      // 60 条为 u0,a1,u2,...,a9,u10,...,a59；截断后 51 条为 [a9, u10, ..., a59]
      expect(passedMessages[0].content).toBe('a9');
      expect(passedMessages[50].content).toBe('a59');
    });
  });

  describe('POST /api/chat/agent', () => {
    it('缺少 messages/providerId/modelId 返回 400', async () => {
      const res = await request(app).post('/api/chat/agent').send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
    it('正常请求时执行 Agent 循环并返回最终 content', async () => {
      vi.mocked(callLLMWithTools).mockResolvedValueOnce({
        content: '沙箱根目录下有：文档、项目、memory、备忘录.txt 等。',
        toolCalls: [],
      });
      const res = await request(app)
        .post('/api/chat/agent')
        .send({
          messages: [{ role: 'user', content: '根目录下有什么' }],
          providerId: 'openai',
          modelId: 'gpt-4o-mini',
          apiKey: 'test-key',
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('content');
      expect(res.body.content).toContain('沙箱');
    });
  });

  // ── 任务 file.write 真实写入沙箱（P1）────────────────────────

  describe('任务执行 file.write 真实化', () => {
    it('office 任务在自动模式下执行后，file.write 步骤会真实写入沙箱文件', async () => {
      await request(app).post('/api/mode').send({ mode: 'auto' });
      const uniqueContent = `file.write 集成测试内容 ${Date.now()}`;
      const pathToWrite = `文档/ai-output-${Date.now()}.txt`;
      vi.mocked(callLLMWithTools)
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [
            {
              id: 'tc-1',
              name: 'file.write',
              arguments: { path: pathToWrite, content: uniqueContent },
            },
          ],
        })
        .mockResolvedValueOnce({ content: '已完成写入。', toolCalls: [] });
      const createRes = await request(app)
        .post('/api/tasks')
        .send({
          domain: 'office',
          title: 'file.write 测试',
          description: uniqueContent,
          llmConfig: {
            providerId: 'openai',
            modelId: 'gpt-4o-mini',
            baseUrl: 'https://api.openai.com',
            apiKey: 'test-key',
          },
        });
      expect(createRes.status).toBe(201);
      const taskId = createRes.body.id;

      // 轮询直到任务完成或超时
      let task: { status: string };
      const deadline = Date.now() + 8000;
      do {
        await new Promise((r) => setTimeout(r, 300));
        const getRes = await request(app).get(`/api/tasks/${taskId}`);
        expect(getRes.status).toBe(200);
        task = getRes.body;
        if (task.status === 'completed' || task.status === 'failed') break;
      } while (Date.now() < deadline);

      expect(task.status).toBe('completed');

      // Agent 循环中 mock 了 file.write(pathToWrite, uniqueContent)，列出 文档 目录应有对应文件
      const listRes = await request(app).get('/api/fs').query({ path: '文档' });
      expect(listRes.status).toBe(200);
      const entries = listRes.body.entries as Array<{ name: string; type: string }>;
      const aiOutput = entries.find((e: { name: string }) => /^ai-output-\d+\.txt$/.test(e.name));
      expect(aiOutput).toBeDefined();

      const readPath = `文档/${aiOutput!.name}`;
      const readRes = await request(app).get('/api/fs/read').query({ path: readPath });
      expect(readRes.status).toBe(200);
      expect(readRes.body.content).toContain(uniqueContent);
    });
  });

  describe('X 制作的小程序 API', () => {
    it('GET /api/apps 匿名时返回空列表', async () => {
      const res = await request(app).get('/api/apps');
      expect(res.status).toBe(200);
      expect(res.body.apps).toEqual([]);
    });

    it('GET /api/apps 有 userId 时返回该用户的小程序列表（仅返回沙箱内仍存在目录的应用）', async () => {
      if (!db) return;
      await db.ensureUser(TEST_USER);
      await db.setConfig(TEST_USER, 'x_mini_apps', JSON.stringify([{ id: 'calc', name: '计算器', path: 'apps/calc' }]));
      const writeRes = await request(app)
        .post('/api/fs/write')
        .set('X-User-Id', TEST_USER)
        .send({ path: 'apps/calc/index.html', content: '<!DOCTYPE html><html><body>Calc</body></html>' });
      expect(writeRes.status).toBe(200);
      const res = await request(app).get('/api/apps').set('X-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.apps).toHaveLength(1);
      expect(res.body.apps[0]).toMatchObject({ id: 'calc', name: '计算器', path: 'apps/calc' });
    });

    it('GET /api/apps 删除应用目录后不再返回该应用并清理 x_mini_apps', async () => {
      if (!db) return;
      await db.ensureUser(TEST_USER);
      await db.setConfig(TEST_USER, 'x_mini_apps', JSON.stringify([{ id: 'gone', name: '已删除', path: 'apps/gone' }]));
      const res = await request(app).get('/api/apps').set('X-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.apps).toHaveLength(0);
      const cfg = await db.getConfig(TEST_USER, 'x_mini_apps');
      expect(cfg).toBe('[]');
    });

    it('GET /api/apps/sandbox 返回沙箱内 apps 目录下的文件（查询式）', async () => {
      const fsRes = await request(app)
        .post('/api/fs/write')
        .set('X-User-Id', TEST_USER)
        .send({ path: 'apps/demo/index.html', content: '<!DOCTYPE html><html><body><h1>Demo</h1></body></html>' });
      expect(fsRes.status).toBe(200);
      await db.setConfig(TEST_USER, 'x_mini_apps', JSON.stringify([{ id: 'demo', name: 'Demo', path: 'apps/demo' }]));
      const res = await request(app)
        .get('/api/apps/sandbox')
        .query({ path: 'apps/demo/index.html', userId: TEST_USER })
        .set('X-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('<h1>Demo</h1>');
    });

    it('GET /api/apps/sandbox/:userId/apps/... 路径式返回文件（子资源 style.css/app.js 同路径带 userId）', async () => {
      const res = await request(app).get(
        `/api/apps/sandbox/${encodeURIComponent(TEST_USER)}/apps/demo/index.html`
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('<h1>Demo</h1>');
    });

    it('GET /api/apps/sandbox path 非 apps/ 开头时返回 400', async () => {
      const res = await request(app)
        .get('/api/apps/sandbox')
        .query({ path: 'other/file.html', userId: TEST_USER })
        .set('X-User-Id', TEST_USER);
      expect(res.status).toBe(400);
    });
  });

  describe('小程序后端 /api/x-apps/backend', () => {
    const appId = 'test-app-' + Date.now();

    it('无 X-User-Id 且无 X-App-Read-Token 时 KV GET 返回 401', async () => {
      const res = await request(app).get(`/api/x-apps/backend/kv/${appId}`).query({ key: 'x' });
      expect(res.status).toBe(401);
    });

    it('带有效 X-App-Read-Token 时 KV GET 可只读访问（无需 X-User-Id）', async () => {
      await db!.ensureUser(TEST_USER);
      await request(app)
        .put(`/api/x-apps/backend/kv/${appId}`)
        .set('X-User-Id', TEST_USER)
        .send({ key: 'stats', value: '{"views":42}' });
      const createRes = await request(app)
        .post(`/api/x-apps/backend/kv/${appId}/public-read-token`)
        .set('X-User-Id', TEST_USER);
      expect(createRes.status).toBe(200);
      const token = createRes.body.token;
      expect(token).toBeDefined();
      const getRes = await request(app)
        .get(`/api/x-apps/backend/kv/${appId}`)
        .query({ key: 'stats' })
        .set('X-App-Read-Token', token);
      expect(getRes.status).toBe(200);
      expect(getRes.text).toBe('{"views":42}');
      await request(app)
        .delete(`/api/x-apps/backend/kv/${appId}`)
        .query({ key: 'stats' })
        .set('X-User-Id', TEST_USER);
    });

    it('有 X-User-Id 时 KV PUT/GET/list/delete 正常', async () => {
      await db!.ensureUser(TEST_USER);
      await request(app)
        .put(`/api/x-apps/backend/kv/${appId}`)
        .set('X-User-Id', TEST_USER)
        .send({ key: 'scores', value: '[100,90]' });
      const getRes = await request(app)
        .get(`/api/x-apps/backend/kv/${appId}`)
        .query({ key: 'scores' })
        .set('X-User-Id', TEST_USER);
      expect(getRes.status).toBe(200);
      expect(getRes.text).toBe('[100,90]');
      const listRes = await request(app)
        .get(`/api/x-apps/backend/kv/${appId}`)
        .set('X-User-Id', TEST_USER);
      expect(listRes.status).toBe(200);
      expect(listRes.body.keys).toContain('scores');
      await request(app)
        .delete(`/api/x-apps/backend/kv/${appId}`)
        .query({ key: 'scores' })
        .set('X-User-Id', TEST_USER);
      const afterGet = await request(app)
        .get(`/api/x-apps/backend/kv/${appId}`)
        .query({ key: 'scores' })
        .set('X-User-Id', TEST_USER);
      expect(afterGet.status).toBe(404);
    });

    it('队列 push/pop/len 正常', async () => {
      await db!.ensureUser(TEST_USER);
      const queueName = 'events';
      await request(app)
        .post(`/api/x-apps/backend/queue/${appId}/${queueName}/push`)
        .set('X-User-Id', TEST_USER)
        .send({ payload: 'event1' });
      await request(app)
        .post(`/api/x-apps/backend/queue/${appId}/${queueName}/push`)
        .set('X-User-Id', TEST_USER)
        .send({ payload: 'event2' });
      const lenRes = await request(app)
        .get(`/api/x-apps/backend/queue/${appId}/${queueName}/len`)
        .set('X-User-Id', TEST_USER);
      expect(lenRes.body.length).toBe(2);
      const pop1 = await request(app)
        .get(`/api/x-apps/backend/queue/${appId}/${queueName}/pop`)
        .set('X-User-Id', TEST_USER);
      expect(pop1.status).toBe(200);
      expect(pop1.body.payload).toBe('event1');
      const pop2 = await request(app)
        .get(`/api/x-apps/backend/queue/${appId}/${queueName}/pop`)
        .set('X-User-Id', TEST_USER);
      expect(pop2.body.payload).toBe('event2');
      const popEmpty = await request(app)
        .get(`/api/x-apps/backend/queue/${appId}/${queueName}/pop`)
        .set('X-User-Id', TEST_USER);
      expect(popEmpty.status).toBe(404);
    });
  });

  describe('X 智能体团队 CRUD /api/teams', () => {
    let createdAgentId: string;

    beforeAll(async () => {
      db!.ensureUser(TEST_USER);
      const agentRes = await request(app)
        .post('/api/agents')
        .set('X-User-Id', TEST_USER)
        .send({ name: '写手', system_prompt: '你是一个写手' });
      expect(agentRes.status).toBe(201);
      createdAgentId = agentRes.body.agent.id;
    });

    it('GET /api/teams 匿名时返回 401', async () => {
      const res = await request(app).get('/api/teams');
      expect(res.status).toBe(401);
    });

    it('GET /api/teams 有 userId 时返回团队列表', async () => {
      const res = await request(app).get('/api/teams').set('X-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('teams');
      expect(Array.isArray(res.body.teams)).toBe(true);
    });

    it('POST /api/teams 创建团队', async () => {
      const res = await request(app)
        .post('/api/teams')
        .set('X-User-Id', TEST_USER)
        .send({ name: '周报流水线', agent_ids: [createdAgentId] });
      expect(res.status).toBe(201);
      expect(res.body.team).toMatchObject({ name: '周报流水线', agentIds: [createdAgentId] });
      expect(res.body.team.id).toMatch(/^team-/);
    });

    it('POST /api/teams 缺少 name 返回 400', async () => {
      const res = await request(app)
        .post('/api/teams')
        .set('X-User-Id', TEST_USER)
        .send({ agent_ids: [createdAgentId] });
      expect(res.status).toBe(400);
    });

    it('POST /api/teams agent_ids 为空返回 400', async () => {
      const res = await request(app)
        .post('/api/teams')
        .set('X-User-Id', TEST_USER)
        .send({ name: '空团队', agent_ids: [] });
      expect(res.status).toBe(400);
    });

    it('GET /api/teams 创建后返回新团队', async () => {
      const res = await request(app).get('/api/teams').set('X-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      const teams = res.body.teams;
      expect(teams.length).toBeGreaterThanOrEqual(1);
      const team = teams.find((t: { name: string }) => t.name === '周报流水线');
      expect(team).toBeDefined();
      expect(team!.agentIds).toContain(createdAgentId);
    });

    it('PUT /api/teams/:id 更新团队', async () => {
      const listRes = await request(app).get('/api/teams').set('X-User-Id', TEST_USER);
      const team = listRes.body.teams.find((t: { name: string }) => t.name === '周报流水线');
      expect(team).toBeDefined();
      const res = await request(app)
        .put(`/api/teams/${encodeURIComponent(team.id)}`)
        .set('X-User-Id', TEST_USER)
        .send({ name: '周报审核流水线' });
      expect(res.status).toBe(200);
      expect(res.body.team.name).toBe('周报审核流水线');
    });

    it('DELETE /api/teams/:id 删除团队', async () => {
      const listRes = await request(app).get('/api/teams').set('X-User-Id', TEST_USER);
      const team = listRes.body.teams.find((t: { name: string }) => t.name === '周报审核流水线');
      expect(team).toBeDefined();
      const res = await request(app)
        .delete(`/api/teams/${encodeURIComponent(team.id)}`)
        .set('X-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      const afterRes = await request(app).get('/api/teams').set('X-User-Id', TEST_USER);
      const remaining = afterRes.body.teams.filter((t: { id: string }) => t.id === team.id);
      expect(remaining.length).toBe(0);
    });
  });

  describe('X 智能体群组 CRUD /api/groups', () => {
    let createdAgentId: string;

    beforeAll(async () => {
      await db!.ensureUser(TEST_USER);
      const agentRes = await request(app)
        .post('/api/agents')
        .set('X-User-Id', TEST_USER)
        .send({ name: '群组测试智能体', system_prompt: '测试用' });
      expect(agentRes.status).toBe(201);
      createdAgentId = agentRes.body.agent.id;
    });

    it('GET /api/groups 匿名时返回 401', async () => {
      const res = await request(app).get('/api/groups');
      expect(res.status).toBe(401);
    });

    it('GET /api/groups 有 userId 时返回群组列表', async () => {
      const res = await request(app).get('/api/groups').set('X-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('groups');
      expect(Array.isArray(res.body.groups)).toBe(true);
    });

    it('POST /api/groups 创建群组', async () => {
      const res = await request(app)
        .post('/api/groups')
        .set('X-User-Id', TEST_USER)
        .send({ name: '头脑风暴群', agent_ids: [createdAgentId] });
      expect(res.status).toBe(201);
      expect(res.body.group).toMatchObject({ name: '头脑风暴群', agentIds: [createdAgentId] });
      expect(res.body.group.id).toMatch(/^group-/);
    });

    it('POST /api/groups 缺少 name 返回 400', async () => {
      const res = await request(app)
        .post('/api/groups')
        .set('X-User-Id', TEST_USER)
        .send({ agent_ids: [createdAgentId] });
      expect(res.status).toBe(400);
    });

    it('GET /api/groups 创建后返回新群组', async () => {
      const res = await request(app).get('/api/groups').set('X-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      const groups = res.body.groups;
      expect(groups.length).toBeGreaterThanOrEqual(1);
      const group = groups.find((g: { name: string }) => g.name === '头脑风暴群');
      expect(group).toBeDefined();
      expect(group!.agentIds).toContain(createdAgentId);
    });

    it('PUT /api/groups/:id 更新群组', async () => {
      const listRes = await request(app).get('/api/groups').set('X-User-Id', TEST_USER);
      const group = listRes.body.groups.find((g: { name: string }) => g.name === '头脑风暴群');
      expect(group).toBeDefined();
      const res = await request(app)
        .put(`/api/groups/${encodeURIComponent(group.id)}`)
        .set('X-User-Id', TEST_USER)
        .send({ name: '创意讨论群' });
      expect(res.status).toBe(200);
      expect(res.body.group.name).toBe('创意讨论群');
    });

    it('DELETE /api/groups/:id 删除群组', async () => {
      const listRes = await request(app).get('/api/groups').set('X-User-Id', TEST_USER);
      const group = listRes.body.groups.find((g: { name: string }) => g.name === '创意讨论群');
      expect(group).toBeDefined();
      const res = await request(app)
        .delete(`/api/groups/${encodeURIComponent(group.id)}`)
        .set('X-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      const afterRes = await request(app).get('/api/groups').set('X-User-Id', TEST_USER);
      const remaining = afterRes.body.groups.filter((g: { id: string }) => g.id === group.id);
      expect(remaining.length).toBe(0);
    });
  });
});
