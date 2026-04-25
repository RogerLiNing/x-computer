/**
 * Simple line-based text diff using LCS (Longest Common Subsequence).
 * Produces an array of hunks with add/remove/keep operations.
 */

export interface DiffLine {
  type: 'add' | 'remove' | 'keep';
  content: string;
  lineLeft?: number;
  lineRight?: number;
}

export interface DiffHunk {
  leftStart: number;
  rightStart: number;
  lines: DiffLine[];
}

export interface DiffResult {
  hunks: DiffHunk[];
  stats: {
    added: number;
    removed: number;
    unchanged: number;
  };
}

function lcs(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = length of LCS of a[0..i-1] and b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  // Backtrack to find LCS
  const lcsList: Array<[number, number]> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcsList.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return lcsList;
}

function splitLines(text: string): string[] {
  return text.split('\n');
}

/**
 * Compute line-by-line diff between two texts.
 * Returns hunks grouped by proximity (within CONTEXT lines).
 */
export function computeDiff(left: string, right: string, context = 3): DiffResult {
  const leftLines = splitLines(left);
  const rightLines = splitLines(right);
  const pairs = lcs(leftLines, rightLines);

  // Build edit script: array of { type, leftIdx?, rightIdx?, line? }
  type EditOp = { type: 'add' | 'remove' | 'keep'; leftIdx?: number; rightIdx?: number; leftLine?: number; rightLine?: number; line?: string };
  const ops: EditOp[] = [];
  let li = 0, ri = 0;

  for (const [lcsL, lcsR] of pairs) {
    // Remove lines from left not in LCS
    while (li < lcsL) {
      ops.push({ type: 'remove', leftIdx: li, leftLine: li + 1, line: leftLines[li] });
      li++;
    }
    // Add lines from right not in LCS
    while (ri < lcsR) {
      ops.push({ type: 'add', rightIdx: ri, rightLine: ri + 1, line: rightLines[ri] });
      ri++;
    }
    // Keep common line
    ops.push({ type: 'keep', leftIdx: li, rightIdx: ri, leftLine: li + 1, rightLine: ri + 1, line: leftLines[li] });
    li++;
    ri++;
  }
  // Remaining
  while (li < leftLines.length) {
    ops.push({ type: 'remove', leftIdx: li, leftLine: li + 1, line: leftLines[li] });
    li++;
  }
  while (ri < rightLines.length) {
    ops.push({ type: 'add', rightIdx: ri, rightLine: ri + 1, line: rightLines[ri] });
    ri++;
  }

  // Group into hunks
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'keep') {
      // Start of potential hunk
      let hunkStart = i;
      let hunkEnd = i;
      // Find end of unchanged context
      while (hunkEnd < ops.length && ops[hunkEnd].type === 'keep') hunkEnd++;
      // Expand backwards with context
      const contextStart = Math.max(0, hunkStart - context);
      // Expand forwards with context
      let contextEnd = Math.min(ops.length, hunkEnd + context);
      // But don't include trailing 'remove'/'add' unless they are within context of keep
      while (contextEnd < ops.length && ops[contextEnd].type !== 'keep' && contextEnd < hunkEnd + context) contextEnd++;
      contextEnd = Math.min(ops.length, contextEnd);

      const hunkOps = ops.slice(contextStart, contextEnd);
      const hunkLines: DiffLine[] = [];
      for (const op of hunkOps) {
        if (op.type === 'keep') {
          hunkLines.push({ type: 'keep', content: op.line ?? '', lineLeft: op.leftLine, lineRight: op.rightLine });
        } else if (op.type === 'remove') {
          hunkLines.push({ type: 'remove', content: op.line ?? '', lineLeft: op.leftLine });
        } else {
          hunkLines.push({ type: 'add', content: op.line ?? '', lineRight: op.rightLine });
        }
      }

      const keepOps = hunkOps.filter((op) => op.type === 'keep');
      hunks.push({
        leftStart: keepOps[0]?.leftLine ?? 1,
        rightStart: keepOps[0]?.rightLine ?? 1,
        lines: hunkLines,
      });
      i = contextEnd;
    } else {
      i++;
    }
  }

  // Compute stats
  let added = 0, removed = 0, unchanged = 0;
  for (const op of ops) {
    if (op.type === 'add') added++;
    else if (op.type === 'remove') removed++;
    else unchanged++;
  }

  return { hunks, stats: { added, removed, unchanged } };
}
