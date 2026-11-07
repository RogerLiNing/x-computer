import { createHash } from 'node:crypto';
import { UncertainToolOutcomeError } from './UncertainToolOutcomeError.js';

export const SEND_TOOLS = ['x.send_email', 'x.send_qq', 'x.send_whatsapp', 'x.send_telegram', 'x.send_discord', 'x.send_slack'] as const;
export type SendTool = typeof SEND_TOOLS[number];
export interface SendApprovalRequest {
  toolCallId: string;
  toolName: SendTool;
  input: Record<string, string>;
  hash: string;
  sender?: { accountId: string; label: string };
}
export interface SendApproval extends SendApprovalRequest {
  id: string;
  expiresAt: number;
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'rejected';
}
export interface SendIdentity { accountId: string; label: string; binding: string }
export function createSendIdentity(accountId: string | number | undefined, label: string | undefined, sessionId: string): SendIdentity | null {
  if (accountId == null || !sessionId || (typeof accountId === 'number' && !Number.isFinite(accountId))) return null;
  const id = String(accountId);
  if (!id || id.length > 256 || /[\x00-\x20\x7f\u202a-\u202e\u2066-\u2069]/.test(id)) return null;
  return { accountId: id, label: (label ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 128) || id, binding: sessionId + ':' + id };
}

export class SendApprovalRequiredError extends Error {
  constructor(readonly request: SendApprovalRequest) { super('这条消息需要你确认后才能发送'); }
}

export class SendExecutionDeniedError extends Error {}

export async function requireSendApproval(
  context: { userId?: string; runId?: string; toolCallId?: string; approvedSendHash?: string; signal?: AbortSignal; assertSendActive?: () => Promise<void> } | undefined,
  toolName: SendTool, input: Record<string, string>, config: string,
  sender?: SendIdentity,
): Promise<void> {
  if (!context?.userId || context.userId === 'anonymous' || !context.runId || !context.toolCallId) {
    throw new Error('发送消息须从可确认的交办记录执行');
  }
  if (context.signal?.aborted) throw new SendExecutionDeniedError('交办已停止，消息尚未发送');
  if (Object.entries(input).some(([key, value]) =>
    value.length > 16000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
    || (key !== 'message' && key !== 'body' && /[\r\n\t]/.test(value)),
  )) {
    throw new Error('发送参数过长或包含不可见控制字符');
  }
  const hash = createHash('sha256').update(JSON.stringify([
    context.userId, context.runId, context.toolCallId, toolName, input, config,
    ...(sender ? [sender.accountId, sender.label, sender.binding] : []),
  ])).digest('hex');
  if (context.approvedSendHash !== hash) {
    throw new SendApprovalRequiredError({ toolCallId: context.toolCallId, toolName, input, hash,
      ...(sender ? { sender: { accountId: sender.accountId, label: sender.label } } : {}),
    });
  }
  if (!context.assertSendActive) throw new SendExecutionDeniedError('发送执行权不可用，尚未发送');
  await context.assertSendActive();
  if (context.signal?.aborted) throw new SendExecutionDeniedError('交办已停止，消息尚未发送');
}

export async function sendWithReceipt<T extends { ok: boolean }>(send: () => Promise<T>): Promise<T> {
  try {
    const receipt = await send();
    if (receipt.ok) return receipt;
  } catch (error) {
    if (error instanceof SendExecutionDeniedError) throw error;
    // Other failures may arrive after the provider accepted the message.
  }
  throw new UncertainToolOutcomeError('渠道未返回成功回执，发送结果未知，请核实后重新交办。');
}
