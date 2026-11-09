import type { Initiator, PipelineContext } from './types.js';

function channelOf(metadata: Record<string, unknown> | undefined): string | undefined {
  const source = metadata?.sourceMessage;
  if (!source || typeof source !== 'object') return undefined;
  const channel = (source as { channel?: unknown }).channel;
  return typeof channel === 'string' && channel ? channel : undefined;
}

/** Explicit initiator wins; otherwise infer the most specific origin the context reveals. */
export function resolveInitiator(context: PipelineContext | undefined): Initiator {
  if (context?.initiator) return context.initiator;
  const userId = context?.userId;
  if (!userId || userId === 'anonymous') return { kind: 'system' };
  if (context.agentId) return { kind: 'agent', userId, agentId: context.agentId };
  const channel = channelOf(context.taskMetadata);
  if (channel) return { kind: 'channel', userId, channel };
  return { kind: 'user', userId };
}
