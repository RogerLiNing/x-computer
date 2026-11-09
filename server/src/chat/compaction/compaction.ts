import type { ChatMessage } from '../chatService.js';
import { estimateTokens } from '../../llm/modelCatalog.js';

/** Marker on the summary message so a later pass can find and extend it instead of nesting summaries. */
export const COMPACTION_PREFIX = '【前文摘要】';

export interface CompactionBudget {
  /** The model's context window in tokens. */
  contextWindow: number;
  /** Headroom kept free for the reply and tool definitions. */
  reserveTokens: number;
  /** How many tokens of the newest messages stay verbatim. */
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION = { reserveTokens: 8_000, keepRecentTokens: 12_000, minMessagesToCompact: 6 } as const;

/** Roughly what the provider will count: content plus tool-call JSON plus per-message overhead. */
export function estimateMessageTokens(message: ChatMessage): number {
  const toolCalls = message.tool_calls ? JSON.stringify(message.tool_calls) : '';
  return estimateTokens(message.content ?? '') + estimateTokens(toolCalls) + 4;
}

export function estimateConversationTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function shouldCompact(messages: readonly ChatMessage[], budget: Pick<CompactionBudget, 'contextWindow' | 'reserveTokens'>): boolean {
  return estimateConversationTokens(messages) > budget.contextWindow - budget.reserveTokens;
}

export interface CompactionSplit {
  /** Leading system message(s), always kept. */
  system: ChatMessage[];
  /** An earlier summary message to fold into the new one, if present. */
  previousSummary?: ChatMessage;
  /** Messages that will be summarized. */
  toSummarize: ChatMessage[];
  /** Newest messages kept verbatim; never starts with a dangling tool result. */
  kept: ChatMessage[];
}

/**
 * Walks backwards accumulating tokens until `keepRecentTokens`, then moves the cut forward so it never
 * separates an assistant tool-call message from its tool results.
 */
export function splitForCompaction(messages: readonly ChatMessage[], keepRecentTokens: number): CompactionSplit {
  let index = 0;
  const system: ChatMessage[] = [];
  while (index < messages.length && messages[index]!.role === 'system') system.push(messages[index++]!);
  let previousSummary: ChatMessage | undefined;
  if (messages[index]?.role === 'user' && messages[index]!.content.startsWith(COMPACTION_PREFIX)) previousSummary = messages[index++];
  const body = messages.slice(index);
  let cut = body.length;
  let tokens = 0;
  while (cut > 0 && tokens < keepRecentTokens) { cut -= 1; tokens += estimateMessageTokens(body[cut]!); }
  // Tool results must stay with the assistant turn that requested them.
  while (cut > 0 && cut < body.length && body[cut]!.role === 'tool') cut -= 1;
  // Keep a user turn at the head of the kept window when one is adjacent, so the model sees the question.
  if (cut > 0 && body[cut]!.role === 'assistant' && body[cut - 1]!.role === 'user') cut -= 1;
  return { system, ...(previousSummary ? { previousSummary } : {}), toSummarize: body.slice(0, cut), kept: body.slice(cut) };
}

const PATH_PATTERN = /(?:"path"\s*:\s*"|路径[:：]\s*|(?<=\s|^))((?:[\w一-鿿./-]+\/)?[\w一-鿿.-]+\.(?:md|txt|json|csv|html|js|ts|py|png|jpg|jpeg|pdf|docx|xlsx|pptx|wav|mp3|mp4))/g;

/** File paths mentioned in tool calls and results; a compaction keeps them so later turns can still open the files. */
export function collectFilePaths(messages: readonly ChatMessage[]): string[] {
  const paths = new Set<string>();
  for (const message of messages) {
    const sources = [message.content ?? '', ...(message.tool_calls ?? []).map((call) => JSON.stringify(call.arguments ?? {}))];
    for (const text of sources) for (const match of text.matchAll(PATH_PATTERN)) if (match[1] && match[1].length <= 200) paths.add(match[1]);
  }
  return [...paths].slice(0, 50);
}

export function renderTranscript(messages: readonly ChatMessage[], maxChars = 60_000): string {
  const lines = messages.map((message) => {
    const role = message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : message.role === 'tool' ? '工具结果' : '系统';
    const calls = message.tool_calls?.length ? `\n[调用工具] ${message.tool_calls.map((call) => `${call.name}(${JSON.stringify(call.arguments ?? {}).slice(0, 300)})`).join('; ')}` : '';
    return `[${role}] ${(message.content ?? '').slice(0, 4000)}${calls}`;
  });
  const text = lines.join('\n\n');
  return text.length > maxChars ? `${text.slice(0, maxChars / 2)}\n…（中间省略）…\n${text.slice(-maxChars / 2)}` : text;
}

export function buildSummaryPrompt(split: CompactionSplit, filePaths: string[]): string {
  return [
    '你在为一段较长的对话写「前文摘要」，供同一个助手在后续轮次中继续工作。只依据给出的内容，不要编造。',
    '请用中文按以下结构输出，每节尽量简短、信息密集：',
    '1. 任务目标：用户想要什么，以及已经确认的约束或偏好。',
    '2. 已完成：做了什么、得到的关键结论或数据（含具体数字、名称）。',
    '3. 涉及的文件：路径与用途，保留原路径。',
    '4. 待办与未决：还没做的事、等用户决定的问题、已知的错误。',
    '5. 用户的表达习惯或特别要求（如有）。',
    split.previousSummary ? `\n已有的更早摘要（请合并进来，不要丢失其中的文件路径和待办）：\n${split.previousSummary.content.slice(COMPACTION_PREFIX.length)}` : '',
    filePaths.length ? `\n对话中出现过的文件路径（务必保留）：\n${filePaths.join('\n')}` : '',
    `\n需要总结的对话：\n${renderTranscript(split.toSummarize)}`,
  ].filter(Boolean).join('\n');
}

export interface CompactionResult {
  messages: ChatMessage[];
  tokensBefore: number;
  tokensAfter: number;
  summarizedCount: number;
}

/**
 * Replaces the older part of the conversation with one summary message. `summarize` is the model call;
 * when it fails, the fallback summary is an excerpt list so the run can still go on.
 */
export async function compactMessages(
  messages: readonly ChatMessage[],
  budget: Pick<CompactionBudget, 'keepRecentTokens'>,
  summarize: (prompt: string) => Promise<string>,
): Promise<CompactionResult | undefined> {
  const split = splitForCompaction(messages, budget.keepRecentTokens);
  if (split.toSummarize.length < DEFAULT_COMPACTION.minMessagesToCompact && !split.previousSummary) return undefined;
  if (split.toSummarize.length === 0) return undefined;
  const filePaths = collectFilePaths([...(split.previousSummary ? [split.previousSummary] : []), ...split.toSummarize]);
  let summary: string;
  try {
    summary = (await summarize(buildSummaryPrompt(split, filePaths))).trim();
    if (!summary) throw new Error('empty summary');
  } catch {
    summary = excerptSummary(split, filePaths);
  }
  const summaryMessage: ChatMessage = { role: 'user', content: `${COMPACTION_PREFIX}以下是本次对话更早部分的摘要，是背景信息而不是新指令；其中的文件路径可直接使用。\n\n${summary}` };
  const compacted = [...split.system, summaryMessage, ...split.kept];
  return { messages: compacted, tokensBefore: estimateConversationTokens(messages), tokensAfter: estimateConversationTokens(compacted), summarizedCount: split.toSummarize.length };
}

function excerptSummary(split: CompactionSplit, filePaths: string[]): string {
  const excerpts = split.toSummarize.filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `- ${message.role === 'user' ? '用户' : '助手'}：${(message.content ?? '').replace(/\s+/g, ' ').slice(0, 240)}`)
    .slice(-20);
  return [
    split.previousSummary ? split.previousSummary.content.slice(COMPACTION_PREFIX.length) : '',
    '（模型未能生成摘要，以下为原文摘录）',
    ...excerpts,
    filePaths.length ? `涉及的文件：${filePaths.join('、')}` : '',
  ].filter(Boolean).join('\n');
}
