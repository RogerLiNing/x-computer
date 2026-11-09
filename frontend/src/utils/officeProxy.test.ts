import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import config from '../../vite.config';

it.each([
  ['/api/fs/read-office?path=scan.pdf', false, true],
  ['/api/fs/read-office?path=scan.pdf&ocr=true', false, true],
  ['/api/fs/read-office?path=scan.pdf', true, false],
  ['/api/fs/write-binary', false, false],
  ['/api/chat/runs', false, false],
])('forwards cancellation only for unfinished office reads: %s', (url, writableEnded, cancelled) => {
  const option = config.server!.proxy!['/api'];
  if (typeof option === 'string' || !option.configure) throw new Error('Office preview proxy hook missing');
  const proxy = new EventEmitter(), upstream = { destroy: vi.fn() };
  option.configure(proxy as never, option);
  const response = Object.assign(new EventEmitter(), { writableEnded });
  proxy.emit('proxyReq', upstream, { url }, response); response.emit('close');
  expect(upstream.destroy).toHaveBeenCalledTimes(cancelled ? 1 : 0);
});
