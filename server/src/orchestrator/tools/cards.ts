import type { ToolDefinition } from '@x-computer/shared';
import type { ToolHandler } from './types.js';

/**
 * Action cards: structured replies the desktop renders as a component instead of prose. The card is
 * data in the tool result (`__card`); clicking an action puts its message into the composer so the
 * person stays in control of what gets sent.
 */
export type ActionCardKind = 'confirm' | 'choices' | 'table' | 'links';

export interface ActionCardAction { label: string; message: string; primary?: boolean }
export interface ActionCard {
  kind: ActionCardKind;
  title: string;
  body?: string;
  actions?: ActionCardAction[];
  columns?: string[];
  rows?: string[][];
  links?: Array<{ label: string; url: string }>;
}

const LIMITS = { actions: 6, columns: 8, rows: 50, links: 10, text: 2000 } as const;

export const presentCardDefinition: ToolDefinition = {
  name: 'x.present_card',
  displayName: '展示操作卡片',
  description: '在回复下方展示一张结构化卡片，代替纯文字：confirm（一个待确认的操作，带「确认/取消」按钮）、choices（几个选项按钮）、table（表格）、links（链接列表）。按钮点击后会把对应 message 填进用户的输入框，由用户发送。只在卡片比文字更清楚时使用，一次回复最多一张。',
  domain: ['chat', 'agent'],
  riskLevel: 'low',
  requiredPermissions: [],
  parameters: [
    { name: 'kind', type: 'string', description: 'confirm | choices | table | links', required: true },
    { name: 'title', type: 'string', description: '卡片标题', required: true },
    { name: 'body', type: 'string', description: '说明文字（可选）', required: false },
    { name: 'actions', type: 'array', description: 'confirm/choices 用：[{label, message, primary?}]，message 是点击后填入输入框的话', required: false },
    { name: 'columns', type: 'array', description: 'table 用：列名', required: false },
    { name: 'rows', type: 'array', description: 'table 用：行，每行是字符串数组', required: false },
    { name: 'links', type: 'array', description: 'links 用：[{label, url}]，仅 http(s)', required: false },
  ],
};

const text = (value: unknown, max: number = LIMITS.text) => (typeof value === 'string' ? value.slice(0, max) : undefined);

export function validateActionCard(input: Record<string, unknown>): ActionCard {
  const kind = input.kind;
  if (kind !== 'confirm' && kind !== 'choices' && kind !== 'table' && kind !== 'links') throw new Error('kind 须为 confirm / choices / table / links');
  const title = text(input.title, 200);
  if (!title) throw new Error('title 必填');
  const card: ActionCard = { kind, title, ...(text(input.body) ? { body: text(input.body) } : {}) };
  if (kind === 'confirm' || kind === 'choices') {
    const actions = Array.isArray(input.actions) ? input.actions.slice(0, LIMITS.actions).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const label = text((item as { label?: unknown }).label, 60);
      const message = text((item as { message?: unknown }).message, 500);
      return label && message ? [{ label, message, ...((item as { primary?: unknown }).primary === true ? { primary: true } : {}) }] : [];
    }) : [];
    if (actions.length === 0) throw new Error(`${kind} 卡片需要至少一个 action`);
    card.actions = actions;
  }
  if (kind === 'table') {
    const columns = Array.isArray(input.columns) ? input.columns.slice(0, LIMITS.columns).map((item) => String(item).slice(0, 60)) : [];
    const rows = Array.isArray(input.rows) ? input.rows.slice(0, LIMITS.rows).filter(Array.isArray).map((row) => (row as unknown[]).slice(0, Math.max(1, columns.length)).map((cell) => String(cell ?? '').slice(0, 200))) : [];
    if (columns.length === 0 || rows.length === 0) throw new Error('table 卡片需要 columns 与 rows');
    card.columns = columns; card.rows = rows;
  }
  if (kind === 'links') {
    const links = Array.isArray(input.links) ? input.links.slice(0, LIMITS.links).flatMap((item) => {
      const label = text((item as { label?: unknown })?.label, 100);
      const url = text((item as { url?: unknown })?.url, 2000);
      return label && url && /^https?:\/\//i.test(url) ? [{ label, url }] : [];
    }) : [];
    if (links.length === 0) throw new Error('links 卡片需要至少一个 http(s) 链接');
    card.links = links;
  }
  return card;
}

export function createPresentCardHandler(): ToolHandler {
  return async (input) => ({ ok: true, __card: validateActionCard(input), message: '卡片已展示给用户；不要再用文字重复卡片内容。' });
}
