import { expect, it } from 'vitest';
import { createSendIdentity } from './sendApproval.js';
it('normalizes labels while preserving a stable verified account binding', () => {
  expect(createSendIdentity(12345, '  合成\n账号\tA ', 'session')).toEqual({ accountId: '12345', label: '合成 账号 A', binding: 'session:12345' });
  expect(createSendIdentity('team/T1/U1', undefined, 'session')?.label).toBe('team/T1/U1');
});
it.each([undefined, '', NaN, 'has whitespace', 'hidden\u202e', 'x'.repeat(257)])('rejects missing or misleading account identities: %s', id => {
  expect(createSendIdentity(id, 'name', 'session')).toBeNull();
});
it('does not issue identities without a connection nonce', () => expect(createSendIdentity('account', 'name', '')).toBeNull());
