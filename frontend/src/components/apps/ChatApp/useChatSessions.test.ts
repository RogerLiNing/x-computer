import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/utils/api';
import { useChatSessions } from './useChatSessions';
import type { Message } from './Message';

// Exercise the hook's async lifecycle without adding a browser test dependency.
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  cursor: 0,
  effects: [] as Array<() => void>,
  cleanups: [] as Array<() => void>,
}));

vi.mock('react', () => ({
  default: {},
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => {
      hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value;
    }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    return hooks.slots[index] ??= { current: initial };
  },
  useCallback(callback: unknown, deps: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) hooks.slots[index] = { callback, deps };
    return hooks.slots[index].callback;
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const index = hooks.cursor++;
    if (hooks.slots[index] && deps.every((dep, i) => dep === hooks.slots[index][i])) return;
    hooks.slots[index] = deps;
    hooks.effects.push(() => {
      const cleanup = effect();
      if (cleanup) hooks.cleanups.push(cleanup);
    });
  },
}));

vi.mock('@/utils/api', () => ({ api: {
  getUserConfigKey: vi.fn(),
  setUserConfigKey: vi.fn(),
  getChatMessages: vi.fn(),
  createChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
} }));

let messages: Message[];
let isBusy = false;
const setMessages = (update: (previous: Message[]) => Message[]) => { messages = update(messages); };
const render = () => {
  hooks.cursor = 0;
  const result = useChatSessions(setMessages, isBusy);
  hooks.effects.splice(0).forEach((effect) => effect());
  return result;
};
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const history = (id: string) => [{ id, role: 'user', content: `记录 ${id}`, createdAt: '2026-10-29T00:00:00Z' }];

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
  messages = [];
  isBusy = false;
  vi.clearAllMocks();
  vi.mocked(api.getUserConfigKey).mockResolvedValue({ key: 'last_chat_session_id', value: null });
  vi.mocked(api.setUserConfigKey).mockResolvedValue({ success: true });
  vi.mocked(api.getChatMessages).mockImplementation(async (id) => history(id));
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

describe('会话连续性', () => {
  it.each(['empty', 'offline'])('云端 %s 时恢复本地会话的消息', async (mode) => {
    localStorage.setItem('x-computer-last-chat-session-id', 'local');
    if (mode === 'offline') vi.mocked(api.getUserConfigKey).mockRejectedValue(new Error('offline'));
    expect(render().isSessionLoading).toBe(true);
    await flush();
    expect(api.getChatMessages).toHaveBeenCalledWith('local');
    expect(render().currentSessionId).toBe('local');
    expect(render().isSessionLoading).toBe(false);
    expect(messages.at(-1)?.id).toBe('local');
  });

  it('云端会话优先，并忽略快速切换后迟到的消息', async () => {
    const first = deferred<ReturnType<typeof history>>();
    vi.mocked(api.getUserConfigKey).mockResolvedValue({ key: 'last_chat_session_id', value: 'cloud' });
    localStorage.setItem('x-computer-last-chat-session-id', 'local');
    vi.mocked(api.getChatMessages).mockImplementation((id) => id === 'cloud' ? first.promise : Promise.resolve(history(id)));
    render();
    await flush();
    render().selectSession('second');
    await flush();
    first.resolve(history('cloud'));
    await flush();
    expect(render().currentSessionId).toBe('second');
    expect(messages.at(-1)?.id).toBe('second');
  });

  it('旧会话加载失败不能清空新会话或错误提示', async () => {
    const first = deferred<ReturnType<typeof history>>();
    render();
    await flush();
    vi.mocked(api.getChatMessages).mockImplementation((id) => id === 'first' ? first.promise : Promise.resolve(history(id)));
    render().selectSession('first');
    render().selectSession('second');
    await flush();
    first.reject(new Error('late failure'));
    await flush();
    expect(render().currentSessionId).toBe('second');
    expect(render().sessionLoadError).toBeNull();
    expect(messages.at(-1)?.id).toBe('second');
  });

  it('新建对话后迟到的消息不覆盖空白会话', async () => {
    const pending = deferred<ReturnType<typeof history>>();
    render();
    await flush();
    vi.mocked(api.getChatMessages).mockReturnValue(pending.promise);
    render().selectSession('old');
    render().startNewChat();
    pending.resolve(history('old'));
    await flush();
    expect(render().currentSessionId).toBeNull();
    expect(render().isSessionLoading).toBe(false);
    expect(messages.map((message) => message.id)).toEqual(['welcome']);
  });

  it('启动恢复晚于用户新建对话时不再恢复旧会话', async () => {
    const config = deferred<{ key: string; value: string }>();
    vi.mocked(api.getUserConfigKey).mockReturnValue(config.promise);
    render().startNewChat();
    config.resolve({ key: 'last_chat_session_id', value: 'old' });
    await flush();
    expect(api.getChatMessages).not.toHaveBeenCalled();
    expect(render().currentSessionId).toBeNull();
  });

  it('当前加载失败时退出等待，并提示重新选择', async () => {
    render();
    await flush();
    vi.mocked(api.getChatMessages).mockRejectedValue(new Error('offline'));
    render().selectSession('missing');
    await flush();
    expect(render().isSessionLoading).toBe(false);
    expect(render().currentSessionId).toBeNull();
    expect(render().sessionLoadError).toContain('重新选择');
  });

  it('创建会话期间切换后终止原发送，不返回过期会话', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.createChatSession>>>();
    render();
    await flush();
    vi.mocked(api.createChatSession).mockReturnValue(pending.promise);
    const creation = render().ensureSessionId();
    const cancelled = expect(creation).rejects.toMatchObject({ name: 'AbortError' });
    render().selectSession('second');
    await flush();
    pending.resolve({ id: 'created', title: null, createdAt: '', updatedAt: '', tags: [] });
    await cancelled;
    expect(render().currentSessionId).toBe('second');
    expect(api.setUserConfigKey).not.toHaveBeenCalledWith('last_chat_session_id', 'created');
  });

  it.each(['select', 'new', 'delete'])('生成回复时阻止 %s 操作并保留当前会话', async (action) => {
    render();
    await flush();
    render().selectSession('current');
    await flush();
    const previousMessages = messages;
    isBusy = true;
    const session = render();
    if (action === 'select') session.selectSession('other');
    if (action === 'new') session.startNewChat();
    if (action === 'delete') session.deleteSession('current');
    expect(render().currentSessionId).toBe('current');
    expect(render().sessionLoadError).toContain('请先停止当前回复');
    expect(messages).toBe(previousMessages);
    expect(api.deleteChatSession).not.toHaveBeenCalled();
  });

  it('忙碌状态不阻止发送本轮消息所需的会话创建', async () => {
    render();
    await flush();
    isBusy = true;
    vi.mocked(api.createChatSession).mockResolvedValue({ id: 'created', title: null, createdAt: '', updatedAt: '', tags: [] });
    await expect(render().ensureSessionId()).resolves.toEqual({ id: 'created', isNew: true });
    expect(render().currentSessionId).toBe('created');
  });

  it('删除当前会话期间禁止发送，完成后安全复位', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.deleteChatSession>>>();
    render();
    await flush();
    render().selectSession('current');
    await flush();
    vi.mocked(api.deleteChatSession).mockReturnValue(pending.promise);
    render().deleteSession('current');
    expect(render().isSessionLoading).toBe(true);
    pending.resolve({ success: true });
    await flush();
    expect(render().currentSessionId).toBeNull();
    expect(render().isSessionLoading).toBe(false);
    expect(messages.map((message) => message.id)).toEqual(['welcome']);
  });

  it('删除当前会话失败后保留记录并恢复发送', async () => {
    render();
    await flush();
    render().selectSession('current');
    await flush();
    vi.mocked(api.deleteChatSession).mockRejectedValue(new Error('offline'));
    render().deleteSession('current');
    await flush();
    expect(render().currentSessionId).toBe('current');
    expect(render().isSessionLoading).toBe(false);
    expect(render().sessionLoadError).toContain('删除对话失败');
    expect(messages.at(-1)?.id).toBe('current');
  });

  it('删除中重选同一会话不使删除完成后的复位失效', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.deleteChatSession>>>();
    render();
    await flush();
    render().selectSession('current');
    await flush();
    vi.mocked(api.deleteChatSession).mockReturnValue(pending.promise);
    render().deleteSession('current');
    vi.mocked(api.getChatMessages).mockClear();
    render().selectSession('current');
    expect(api.getChatMessages).not.toHaveBeenCalled();
    pending.resolve({ success: true });
    await flush();
    expect(render().currentSessionId).toBeNull();
    expect(render().isSessionLoading).toBe(false);
  });

  it('卸载后忽略仍在进行的消息请求', async () => {
    const pending = deferred<ReturnType<typeof history>>();
    render();
    await flush();
    vi.mocked(api.getChatMessages).mockReturnValue(pending.promise);
    render().selectSession('old');
    hooks.cleanups.forEach((cleanup) => cleanup());
    const stateAtUnmount = [...hooks.slots];
    pending.resolve(history('old'));
    await flush();
    expect(hooks.slots).toEqual(stateAtUnmount);
    expect(messages).toEqual([]);
  });
});
