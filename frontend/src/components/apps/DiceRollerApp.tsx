import { useState, useCallback } from 'react';
import { Dices, Trash2, Copy, Check } from 'lucide-react';

interface Props {
  windowId: string;
}

interface RollResult {
  id: string;
  dice: number[];
  modifier: number;
  total: number;
  sides: number;
  timestamp: number;
}

const SIDES_OPTIONS = [4, 6, 8, 10, 12, 20, 100];

function roll(sides: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % sides) + 1;
}

export function DiceRollerApp({ windowId }: Props) {
  const [count, setCount] = useState(2);
  const [sides, setSides] = useState(6);
  const [modifier, setModifier] = useState(0);
  const [results, setResults] = useState<RollResult[]>([]);
  const [rolling, setRolling] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const doRoll = useCallback(() => {
    setRolling(true);
    setTimeout(() => {
      const dice = Array.from({ length: count }, () => roll(sides));
      const total = dice.reduce((a, b) => a + b, 0) + modifier;
      const entry: RollResult = { id: `roll-${Date.now()}`, dice, modifier, total, sides, timestamp: Date.now() };
      setResults(prev => [entry, ...prev].slice(0, 50));
      setRolling(false);
    }, 600);
  }, [count, sides, modifier]);

  const clearHistory = () => setResults([]);
  const copyResult = async (r: RollResult) => {
    const text = `${r.dice.join('+')}${r.modifier !== 0 ? (r.modifier > 0 ? '+' : '') + r.modifier : ''} = ${r.total}`;
    try { await navigator.clipboard.writeText(text); setCopiedId(r.id); setTimeout(() => setCopiedId(null), 1500); } catch { /* ignore */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text)' }}>
      {/* Controls */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
          <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', flexShrink: 0 }}>骰子数量</label>
          <div style={{ display: 'flex', gap: '4px' }}>
            {[1, 2, 3, 4, 5, 6].map(n => (
              <button key={n} onClick={() => setCount(n)}
                style={{ width: '32px', height: '32px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  background: count === n ? 'var(--color-accent)' : 'var(--color-surface)',
                  color: count === n ? '#fff' : 'var(--color-text-secondary)',
                  border: `1px solid ${count === n ? 'var(--color-accent)' : 'var(--color-border)'}` }}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
          <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', flexShrink: 0 }}>面数</label>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {SIDES_OPTIONS.map(s => (
              <button key={s} onClick={() => setSides(s)}
                style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                  background: sides === s ? 'var(--color-accent)' : 'var(--color-surface)',
                  color: sides === s ? '#fff' : 'var(--color-text-secondary)',
                  border: `1px solid ${sides === s ? 'var(--color-accent)' : 'var(--color-border)'}` }}>
                D{s}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
          <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', flexShrink: 0 }}>调整值</label>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button onClick={() => setModifier(m => m - 1)} style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>−</button>
            <input type="number" value={modifier} onChange={e => setModifier(parseInt(e.target.value) || 0)}
              style={{ width: '50px', padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '13px', textAlign: 'center', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none' }} />
            <button onClick={() => setModifier(m => m + 1)} style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>+</button>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>(+N 或 -N)</span>
        </div>
        <button
          onClick={doRoll}
          disabled={rolling}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '10px', background: rolling ? 'var(--color-border)' : 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: '10px', cursor: rolling ? 'not-allowed' : 'pointer', fontSize: '15px', fontWeight: 600, transition: 'all 0.2s', transform: rolling ? 'scale(0.98)' : 'scale(1)' }}
        >
          <Dices size={18} style={{ animation: rolling ? 'spin 0.5s linear infinite' : 'none' }} />
          {rolling ? '掷骰中...' : `投掷 ${count}D${sides}${modifier !== 0 ? (modifier > 0 ? '+' : '') + modifier : ''}`}
        </button>
      </div>

      {/* Latest result */}
      {results[0] && (
        <div style={{ padding: '14px', borderBottom: '1px solid var(--color-border)', textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>最新结果</div>
          <div style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-accent)', fontFamily: 'monospace', lineHeight: 1 }}>
            {results[0].total}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '4px', fontFamily: 'monospace' }}>
            [{results[0].dice.join(', ')}]{results[0].modifier !== 0 ? (results[0].modifier > 0 ? ' + ' : ' − ') + Math.abs(results[0].modifier) : ''}
          </div>
        </div>
      )}

      {/* History */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>历史记录 ({results.length})</span>
          {results.length > 0 && (
            <button onClick={clearHistory} style={{ fontSize: '11px', color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Trash2 size={10} /> 清空
            </button>
          )}
        </div>
        {results.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '30px', fontSize: '12px' }}>
            点击上方按钮投掷骰子
          </div>
        )}
        {results.slice(1).map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', marginBottom: '4px' }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-accent)', fontFamily: 'monospace' }}>{r.total}</span>
              <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginLeft: '8px', fontFamily: 'monospace' }}>
                [{r.dice.join(', ')}] D{r.sides}
              </span>
            </div>
            <button onClick={() => copyResult(r)} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: copiedId === r.id ? '#22c55e' : 'var(--color-text-secondary)', display: 'flex' }}>
              {copiedId === r.id ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
