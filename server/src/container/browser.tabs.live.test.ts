import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import { describe, expect, it } from 'vitest';
import { UserContainerManager } from './UserContainerManager.js';
import { BrowserComputer } from './BrowserComputer.js';
import { BrowserUploadStore } from './BrowserUploadStore.js';
import { SandboxFS } from '../tooling/SandboxFS.js';

const image = process.env.X_BROWSER_TEST_IMAGE;
describe.skipIf(!image)('real container browser tabs', () => {
  it('keeps popups, binds actions to the current page, expires uploads and limits tab count', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'browser-tabs-'));
    const sandbox = new SandboxFS(path.join(root, 'files'));
    await mkdir(sandbox.getRoot());
    await writeFile(path.join(sandbox.getRoot(), 'input.txt'), 'approved only for the original page');
    const manager = new UserContainerManager(root, {
      imageName: image, namePrefix: 'x-tabs-test-' + Date.now(), networkMode: 'none',
      memoryLimit: '1g', pidsLimit: 256, idleTimeout: 0, maxIdleTime: 0,
    });
    const user = 'tabs-fixture';
    const computer = new BrowserComputer(manager, undefined, new BrowserUploadStore(root, async () => sandbox));
    const call = (actor: 'human' | 'agent', input: Record<string, unknown>) => computer.request(user, actor, input);
    try {
      await expect.poll(async () => {
        try { return (await call('human', { action: 'start' })).started; }
        catch { return false; }
      }, { timeout: 30000 }).toBe(true);
      await call('human', { action: 'demo' });
      await call('human', { action: 'release' });
      const source = await call('agent', { action: 'snapshot' });
      expect(source.tabs).toHaveLength(1);
      const originalId = source.activeTabId;
      const input = source.elements.find((element: any) => element.tag === 'INPUT' && element.type !== 'file');
      await call('agent', { action: 'type', target: input.index, text: 'original-tab-marker', snapshot: source.snapshot });
      const typed = await call('agent', { action: 'snapshot' });
      await call('agent', { action: 'click', target: typed.elements.find((element: any) => element.label === '展示文字').index, snapshot: typed.snapshot });

      const before = await call('agent', { action: 'snapshot' });
      const upload = await computer.requestUpload(user, {
        path: 'input.txt', target: before.elements.find((element: any) => element.type === 'file').index, snapshot: before.snapshot,
      });
      await call('agent', { action: 'click', target: before.elements.find((element: any) => element.label === '打开新页面').index, snapshot: before.snapshot });
      await expect.poll(async () => (await call('human', { action: 'state' })).tabs.length).toBe(2);
      const popup = await call('agent', { action: 'snapshot' });
      expect(popup.activeTabId).not.toBe(originalId);
      expect(popup.uploadRequests.find((item: any) => item.id === upload.requestId).status).toBe('expired');
      await expect(computer.approveUpload(user, upload.requestId)).rejects.toThrow('已处理');
      await expect(call('agent', { action: 'switch_tab', tab: originalId, snapshot: before.snapshot })).rejects.toThrow('页面已变化');
      await call('agent', { action: 'switch_tab', tab: originalId, snapshot: popup.snapshot });
      expect((await call('agent', { action: 'snapshot' })).text).toContain('original-tab-marker');

      await call('human', { action: 'take' });
      const frame = await call('human', { action: 'frame' });
      await call('human', { action: 'new_tab' });
      await expect(call('human', { action: 'click', x: 40, y: 40, frame: frame.frame })).rejects.toThrow('画面已变化');
      await expect(call('agent', { action: 'new_tab', snapshot: popup.snapshot })).rejects.toThrow('用户正在操作');
      await expect(call('human', { action: 'switch_tab', tab: 'another-users-tab' })).rejects.toThrow('不存在');
      await expect(call('human', { action: 'new_tab', url: 'http://127.0.0.1/' })).rejects.toThrow('未获管理员允许');
      let state = await call('human', { action: 'state' });
      while (state.tabs.length < state.maxTabs) state = await call('human', { action: 'new_tab' });
      await expect(call('human', { action: 'new_tab' })).rejects.toThrow('最多');
      expect((await call('human', { action: 'state' })).tabs).toHaveLength(state.maxTabs);
      const closed = await call('human', { action: 'close_tab', tab: state.activeTabId });
      expect(closed.tabs.length).toBe(state.tabs.length - 1);
      await call('human', { action: 'release' });
      const observed = await call('agent', { action: 'snapshot' });
      await call('agent', { action: 'close_tab', tab: observed.activeTabId, snapshot: observed.snapshot });
      await expect(call('agent', { action: 'scroll', delta: 10, snapshot: observed.snapshot })).rejects.toThrow('页面已变化');
    } finally {
      manager.stopMonitoring();
      const id = await manager.findRunningContainer(user);
      if (id) await new Docker().getContainer(id).stop({ t: 2 }).catch(() => {});
    }
  }, 90000);
});
