import { createHash } from 'node:crypto';

export function channelInboxId(userId: string, channel: string, address: string, messageId: string, scopeId?: string): string {
  return createHash('sha256').update(JSON.stringify([userId, channel, address, messageId, ...(scopeId ? [scopeId] : [])])).digest('hex').slice(0, 32);
}

export interface ChannelOrigin { accountId?: string; scopeId: string; configDigest: string }
/** Capture at receipt time; an unidentified connection is never promoted to another account. */
export function captureChannelOrigin(accountId: string | undefined, sessionId: string, config: string | undefined): ChannelOrigin {
  return { ...(accountId ? { accountId } : {}), scopeId: accountId || 'unverified:' + sessionId,
    configDigest: createHash('sha256').update(config ?? '').digest('hex') };
}
export function channelProcessedKey(base: string, scopeId?: string): string {
  return scopeId ? base + ':' + createHash('sha256').update(scopeId).digest('hex').slice(0, 32) : base;
}
