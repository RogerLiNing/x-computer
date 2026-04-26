import { useState, useCallback, useEffect } from 'react';
import { History } from 'lucide-react';

interface Props {
  windowId: string;
}

interface HistoryEntry {
  id: string;
  expression: string;
  result: string;
  timestamp: number;
}

const OPS = {
  '+': (a: number, b: number) => a + b,
  '−': (a: number, b: number) => a - b,
  '×': (a: number, b: number) => a * b,
  '÷': (a: number, b: number) => b !== 0 ? a / b : 'Error',
};

function evalExpr(a: number, op: keyof typeof OPS, b: number): number | string {
  return OPS[op](a, b);
}

function fmt(n: number): string {
  if (!isFinite(n)) return 'Error';
  const s = String(n);
  if (s.length > 12) return n.toExponential(6);
  return s;
}

type BtnStyle = 'num' | 'op' | 'func' | 'eq';

interface Btn {
  label: string;
  value: string;
  style: BtnStyle;
  wide?: boolean;
}

const BUTTONS: Btn[][] = [
  [{ label: 'AC', value: 'AC', style: 'func' }, { label: '±', value: '±', style: 'func' }, { label: '%', value: '%', style: 'func' }, { label: '÷', value: '÷', style: 'op' }],
  [{ label: '7', value: '7', style: 'num' }, { label: '8', value: '8', style: 'num' }, { label: '9', value: '9', style: 'num' }, { label: '×', value: '×', style: 'op' }],
  [{ label: '4', value: '4', style: 'num' }, { label: '5', value: '5', style: 'num' }, { label: '6', value: '6', style: 'num' }, { label: '−', value: '−', style: 'op' }],
  [{ label: '1', value: '1', style: 'num' }, { label: '2', value: '2', style: 'num' }, { label: '3', value: '3', style: 'num' }, { label: '+', value: '+', style: 'op' }],
  [{ label: '0', value: '0', style: 'num', wide: true }, { label: '.', value: '.', style: 'num' }, { label: '=', value: '=', style: 'eq' }],
];

const BTN_STYLES: Record<BtnStyle, React.CSSProperties> = {
  num: { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
  op: { background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1e3a5f' },
  func: { background: '#374151', color: '#d1d5db', border: '1px solid #374151' },
  eq: { background: '#1d4ed8', color: '#fff', border: '1px solid #1d4ed8' },
};

export function CalculatorApp({ windowId }: Props) {
  const [display, setDisplay] = useState('0');
  const [expression, setExpression] = useState('');
  const [pending, setPending] = useState<{ a: number; op: keyof typeof OPS } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [justEvaluated, setJustEvaluated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('calc-history');
      setHistory(raw ? JSON.parse(raw) : []);
    } catch { setHistory([]); }
  }, []);

  const saveHistory = (entry: HistoryEntry) => {
    const updated = [entry, ...history].slice(0, 50);
    setHistory(updated);
    localStorage.setItem('calc-history', JSON.stringify(updated));
  };

  const input = useCallback((val: string) => {
    if (justEvaluated && /[0-9.]/.test(val)) {
      setDisplay(val === '.' ? '0.' : val);
      setExpression('');
      setPending(null);
      setJustEvaluated(false);
      return;
    }
    if (justEvaluated && val === '=') return;

    if (val === 'AC') {
      setDisplay('0'); setExpression(''); setPending(null); setJustEvaluated(false);
    } else if (val === '±') {
      setDisplay(prev => {
        const n = parseFloat(prev);
        return fmt(-n);
      });
    } else if (val === '%') {
      setDisplay(prev => {
        const n = parseFloat(prev);
        return fmt(n / 100);
      });
    } else if (val === '.') {
      setDisplay(prev => prev.includes('.') ? prev : prev + '.');
    } else if (/[0-9]/.test(val)) {
      setDisplay(prev => prev === '0' ? val : (prev.length < 12 ? prev + val : prev));
    } else if (val === 'Backspace' || val === 'DEL') {
      setDisplay(prev => prev.length <= 1 ? '0' : prev.slice(0, -1));
    } else if (val in OPS) {
      const op = val as keyof typeof OPS;
      const num = parseFloat(display);
      if (pending) {
        const result = evalExpr(pending.a, pending.op, num);
        if (result === 'Error') { setDisplay('Error'); setPending(null); return; }
        setDisplay(fmt(result as number));
        setPending({ a: result as number, op });
      } else {
        setPending({ a: num, op });
      }
      setExpression(prev => (prev ? prev + ' ' + display + ' ' + op : display + ' ' + op));
      setJustEvaluated(false);
    } else if (val === '=') {
      if (pending) {
        const num = parseFloat(display);
        const result = evalExpr(pending.a, pending.op, num);
        if (result === 'Error') {
          setDisplay('Error');
          setExpression('');
          setPending(null);
        } else {
          const exprStr = `${pending.a} ${pending.op} ${num}`;
          const resultStr = fmt(result as number);
          setDisplay(resultStr);
          setExpression(exprStr + ' = ' + resultStr);
          saveHistory({ id: `calc-${Date.now()}`, expression: exprStr, result: resultStr, timestamp: Date.now() });
          setPending(null);
        }
        setJustEvaluated(true);
      }
    }
  }, [display, pending, justEvaluated, history]);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, string> = {
        '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
        '.': '.', '+': '+', '-': '−', '*': '×', '/': '÷', '%': '%', '=': '=', 'Enter': '=', 'Backspace': 'DEL', 'Escape': 'AC',
      };
      const v = map[e.key];
      if (v) { e.preventDefault(); input(v); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [input]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'monospace', background: '#0a0a0f', color: '#fff' }}>
      {/* Display */}
      <div style={{ padding: '12px 14px 8px', textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: '11px', color: '#6b7280', minHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{expression}</div>
        <div style={{ fontSize: '32px', fontWeight: 300, overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-all', lineHeight: 1.2, marginTop: '4px', color: '#f9fafb' }}>{display}</div>
      </div>

      {/* Buttons */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '6px', gap: '4px' }}>
        {BUTTONS.map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: '4px', flex: 1 }}>
            {row.map((btn, bi) => (
              <button
                key={bi}
                onClick={() => input(btn.value)}
                style={{
                  ...BTN_STYLES[btn.style],
                  flex: btn.wide ? 1 : 1,
                  borderRadius: '8px',
                  fontSize: '18px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: btn.wide ? 'flex-start' : 'center',
                  padding: btn.wide ? '0 16px' : '0',
                  paddingLeft: btn.wide ? '16px' : '0',
                  transition: 'opacity 0.1s',
                  minHeight: 0,
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        ))}
        {/* Bottom row: history toggle */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => setShowHistory(v => !v)}
            style={{ flex: 1, padding: '8px', background: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#9ca3af', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
          >
            <History size={12} /> 历史 {history.length > 0 && `(${history.length})`}
          </button>
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#111827', borderTop: '1px solid #374151', maxHeight: '40%', overflowY: 'auto', zIndex: 10, padding: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>历史记录</span>
            {history.length > 0 && (
              <button onClick={() => { setHistory([]); localStorage.removeItem('calc-history'); }}
                style={{ fontSize: '11px', color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                清空
              </button>
            )}
          </div>
          {history.length === 0 && <div style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center', padding: '12px' }}>暂无历史</div>}
          {history.map(h => (
            <div key={h.id} style={{ padding: '6px 0', borderBottom: '1px solid #1f2937', cursor: 'pointer' }} onClick={() => { input('AC'); setDisplay(h.result.split(' ').pop() ?? h.result); setShowHistory(false); }}>
              <div style={{ fontSize: '11px', color: '#6b7280' }}>{h.expression}</div>
              <div style={{ fontSize: '14px', color: '#f9fafb', fontFamily: 'monospace' }}>{h.result}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
