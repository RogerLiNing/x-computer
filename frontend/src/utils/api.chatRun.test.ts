import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

vi.mock('@/store/systemLogStore', () => ({ getSystemLogStore: () => ({ addLog: vi.fn() }) }));
vi.mock('./userId.js', () => ({ getUserId: () => 'test-user', getUserIdOrNull: () => 'test-user' }));
vi.mock('../i18n.js', () => ({ default: { language: 'zh-CN' } }));

afterEach(() => vi.unstubAllGlobals());

describe('持久交办流', () => {
  it('保留交办编号、服务端持久化和已校验成果', async () => {
    const started = vi.fn();
    const artifact = { path: '文档/交付.md', name: '交付.md', size: 12 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response([
      'event: run_started\ndata: {"runId":"run-1","sessionId":"session-1","status":"running","serverPersisted":true}\n\n',
      `event: done\ndata: ${JSON.stringify({ runId: 'run-1', content: '完成', status: 'completed', serverPersisted: true, artifacts: [artifact] })}\n\n`,
    ].join(''))));
    const result = await api.chatAgentStream({ messages: [{ role: 'user', content: '写报告' }], providerId: 'test', modelId: 'test', sessionId: 'session-1', requestId: 'request-1' }, vi.fn(), { onRunStarted: started });
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', serverPersisted: true }));
    expect(result).toMatchObject({ runId: 'run-1', serverPersisted: true, status: 'completed', artifacts: [artifact] });
  });

  it('断流且没有完成事件时不伪报成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('event: content_chunk\ndata: {"content":"部分"}\n\n')));
    await expect(api.chatAgentStream({ messages: [], providerId: 'test', modelId: 'test', sessionId: 'session-1' }, vi.fn())).rejects.toThrow('连接已断开');
  });

  it('未收到交办编号时按会话和幂等请求编号停止', async () => {
    const fetcher = vi.fn(async () => new Response('{"status":"paused"}', { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    await api.stopChatRunRequest('session-1', 'request-1');
    expect(fetcher).toHaveBeenCalledWith('/api/chat/runs/stop-request', expect.objectContaining({ method: 'POST', body: '{"sessionId":"session-1","requestId":"request-1"}' }));
  });

  it('交办透传用户原文及图片和文件附件', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response('event: done\ndata: {"content":"完成","serverPersisted":true}\n\n'));
    vi.stubGlobal('fetch', fetcher);
    const userMessage = { content: '分析附件', images: ['图片/图.png'], attachedFiles: [{ name: '报告.pdf', path: '文档/报告.pdf' }] };
    await api.chatAgentStream({ messages: [{ role: 'user', content: '分析附件及工具提示' }], providerId: 'test', modelId: 'test', sessionId: 'session-1', requestId: 'request-1', userMessage }, vi.fn());
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ userMessage });
  });
});

describe('abortable session verification',()=>{
 it('allows stopping classification before a durable handoff exists',async()=>{const controller=new AbortController(),fetcher=vi.fn(async()=>new Response('{"intent":"normal_chat"}'));vi.stubGlobal('fetch',fetcher);await api.classifyWritingIntent({userMessage:'写故事',hasOpenAiDocument:false,providerId:'test',modelId:'test'},{signal:controller.signal});expect(fetcher).toHaveBeenCalledWith('/api/chat/classify-writing-intent',expect.objectContaining({signal:controller.signal}));});
 it('forwards the verification signal so a hung request can be abandoned',async()=>{const controller=new AbortController();const fetcher=vi.fn(async()=>new Response(JSON.stringify({id:'test-user',email:'test@example.test'})));vi.stubGlobal('fetch',fetcher);await api.getMe({signal:controller.signal});expect(fetcher).toHaveBeenCalledWith('/api/users/me',expect.objectContaining({signal:controller.signal}));});
});
