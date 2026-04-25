import { useState, useCallback } from 'react';
import { ArrowLeftRight, FileText, Loader2, Plus, Minus, Equal } from 'lucide-react';

interface DiffLine {
  type: 'add' | 'remove' | 'keep';
  content: string;
  lineLeft?: number;
  lineRight?: number;
}

function computeDiff(leftLines: string[], rightLines: string[]): DiffLine[] {
  const m = leftLines.length;
  const n = rightLines.length;

  // Build LCS dp table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const ops: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      ops.unshift({ type: 'keep', content: leftLines[i - 1], lineLeft: i, lineRight: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'add', content: rightLines[j - 1], lineRight: j });
      j--;
    } else {
      ops.unshift({ type: 'remove', content: leftLines[i - 1], lineLeft: i });
      i--;
    }
  }
  return ops;
}

export function DiffApp({ windowId }: { windowId: string }) {
  const [leftText, setLeftText] = useState('');
  const [rightText, setRightText] = useState('');
  const [diffResult, setDiffResult] = useState<DiffLine[] | null>(null);
  const [stats, setStats] = useState({ added: 0, removed: 0, unchanged: 0 });

  const runDiff = useCallback(() => {
    const leftLines = leftText.split('\n');
    const rightLines = rightText.split('\n');
    const diff = computeDiff(leftLines, rightLines);
    setDiffResult(diff);
    let added = 0, removed = 0, unchanged = 0;
    for (const line of diff) {
      if (line.type === 'add') added++;
      else if (line.type === 'remove') removed++;
      else unchanged++;
    }
    setStats({ added, removed, unchanged });
  }, [leftText, rightText]);

  const swapTexts = () => {
    setLeftText(rightText);
    setRightText(leftText);
  };

  return (
    <div className="flex flex-col h-full bg-desktop-surface">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0 bg-white/[0.02]">
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 bg-desktop-accent/20 hover:bg-desktop-accent/30 border border-desktop-accent/30 text-desktop-accent rounded-lg text-xs font-medium transition-colors"
          onClick={runDiff}
        >
          <ArrowLeftRight size={13} />
          对比
        </button>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-desktop-muted hover:text-desktop-text hover:bg-white/5 rounded-lg text-xs transition-colors"
          onClick={swapTexts}
          title="交换左右文本"
        >
          <Plus size={13} className="rotate-45" />
          交换
        </button>

        {diffResult && (
          <div className="flex items-center gap-3 ml-2">
            <span className="flex items-center gap-1 text-[11px] text-green-400/80">
              <Plus size={11} /> {stats.added}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-red-400/80">
              <Minus size={11} /> {stats.removed}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-desktop-muted/60">
              <Equal size={11} /> {stats.unchanged}
            </span>
          </div>
        )}
      </div>

      {/* Split panes */}
      <div className="flex flex-1 min-h-0">
        {/* Left pane */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-white/5">
          <div className="px-3 py-1.5 border-b border-white/5 text-[10px] text-desktop-muted/60 uppercase tracking-wide shrink-0 bg-white/[0.01]">
            原文 / Left
          </div>
          <textarea
            className="flex-1 bg-transparent px-3 py-2 text-xs text-desktop-text/80 font-mono outline-none resize-none leading-5"
            placeholder="粘贴原文或代码..."
            value={leftText}
            onChange={(e) => setLeftText(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Right pane */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-3 py-1.5 border-b border-white/5 text-[10px] text-desktop-muted/60 uppercase tracking-wide shrink-0 bg-white/[0.01]">
            修改后 / Right
          </div>
          <textarea
            className="flex-1 bg-transparent px-3 py-2 text-xs text-desktop-text/80 font-mono outline-none resize-none leading-5"
            placeholder="粘贴修改后代码..."
            value={rightText}
            onChange={(e) => setRightText(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      {/* Diff result */}
      {diffResult && (
        <div className="flex-1 min-h-0 border-t border-white/5 flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-white/5 text-[10px] text-desktop-muted/60 uppercase tracking-wide shrink-0 bg-white/[0.01]">
            差异 / Diff Result
          </div>
          <div className="flex-1 overflow-auto px-3 py-2 space-y-0.5">
            {diffResult.map((line, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 font-mono text-[11px] leading-5 ${
                  line.type === 'add'
                    ? 'bg-green-500/10 text-green-400/90'
                    : line.type === 'remove'
                    ? 'bg-red-500/10 text-red-400/90'
                    : 'text-desktop-text/60'
                }`}
              >
                {/* Line numbers */}
                <span className="shrink-0 w-8 text-right text-desktop-muted/30 select-none text-[10px]">
                  {line.type === 'add' ? '' : line.lineLeft ?? ''}
                </span>
                <span className="shrink-0 w-8 text-right text-desktop-muted/30 select-none text-[10px]">
                  {line.type === 'remove' ? '' : line.lineRight ?? ''}
                </span>
                {/* Prefix */}
                <span className="shrink-0 w-4 text-center select-none">
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                </span>
                {/* Content */}
                <span className="flex-1 break-all whitespace-pre">{line.content || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
