import { ExternalLink } from 'lucide-react';

export interface ActionCardData {
  kind: 'confirm' | 'choices' | 'table' | 'links';
  title: string;
  body?: string;
  actions?: Array<{ label: string; message: string; primary?: boolean }>;
  columns?: string[];
  rows?: string[][];
  links?: Array<{ label: string; url: string }>;
}

/** Reads a card out of a tool result when the server put one there. */
export function extractActionCard(output: unknown): ActionCardData | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const card = (output as { __card?: unknown }).__card;
  if (!card || typeof card !== 'object') return undefined;
  const data = card as Partial<ActionCardData>;
  return typeof data.kind === 'string' && typeof data.title === 'string' ? (data as ActionCardData) : undefined;
}

interface Props {
  card: ActionCardData;
  /** Puts the action's message into the composer; the person decides whether to send it. */
  onAction?: (message: string) => void;
}

export function ActionCard({ card, onAction }: Props) {
  return (
    <div className="mt-2 rounded-xl border border-sky-400/25 bg-sky-400/[0.06] p-3 text-sm" data-card-kind={card.kind}>
      <div className="font-medium">{card.title}</div>
      {card.body && <p className="mt-1 whitespace-pre-wrap text-xs text-desktop-muted">{card.body}</p>}
      {card.kind === 'table' && card.columns && card.rows && (
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-desktop-muted"><tr>{card.columns.map((column) => <th key={column} className="py-1 pr-2 font-normal">{column}</th>)}</tr></thead>
          <tbody>{card.rows.map((row, index) => <tr key={index} className="border-t border-white/5">{row.map((cell, cellIndex) => <td key={cellIndex} className="py-1 pr-2">{cell}</td>)}</tr>)}</tbody>
        </table>
      )}
      {card.kind === 'links' && card.links && (
        <ul className="mt-2 space-y-1 text-xs">
          {card.links.map((link) => (
            <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sky-300 hover:underline"><ExternalLink size={11} />{link.label}</a></li>
          ))}
        </ul>
      )}
      {card.actions && card.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {card.actions.map((action) => (
            <button key={action.label} type="button" onClick={() => onAction?.(action.message)} disabled={!onAction}
              className={`rounded-lg px-3 py-1 text-xs ${action.primary ? 'bg-sky-500 text-white hover:bg-sky-400' : 'bg-white/10 hover:bg-white/15'} disabled:opacity-50`}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
