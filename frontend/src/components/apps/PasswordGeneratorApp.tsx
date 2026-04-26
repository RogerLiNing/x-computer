import { useState, useCallback, useEffect } from 'react';
import { Copy, RefreshCw, Shield, Check, Eye, EyeOff, Key } from 'lucide-react';

interface Props {
  windowId: string;
}

interface GeneratedPassword {
  id: string;
  value: string;
  timestamp: number;
  strength: 'weak' | 'fair' | 'strong' | 'very-strong';
}

const CHARS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
};

function getStrength(password: string): { label: string; color: string; score: number } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { label: '弱', color: '#ef4444', score };
  if (score <= 3) return { label: '一般', color: '#f97316', score };
  if (score <= 4) return { label: '强', color: '#22c55e', score };
  return { label: '极强', color: '#10b981', score };
}

function generatePassword(length: number, options: { upper: boolean; lower: boolean; numbers: boolean; symbols: boolean }): string {
  let chars = '';
  if (options.upper) chars += CHARS.upper;
  if (options.lower) chars += CHARS.lower;
  if (options.numbers) chars += CHARS.numbers;
  if (options.symbols) chars += CHARS.symbols;
  if (!chars) chars = CHARS.lower + CHARS.numbers;

  let result = '';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) {
    result += chars[arr[i] % chars.length];
  }

  // Ensure at least one char from each selected type
  const required: string[] = [];
  if (options.upper) required.push(CHARS.upper[arr[0] % CHARS.upper.length]);
  if (options.lower) required.push(CHARS.lower[arr[1] % CHARS.lower.length]);
  if (options.numbers) required.push(CHARS.numbers[arr[2] % CHARS.numbers.length]);
  if (options.symbols) required.push(CHARS.symbols[arr[3] % CHARS.symbols.length]);

  const arr2 = new Uint32Array(required.length);
  crypto.getRandomValues(arr2);
  const charsArr = result.split('');
  for (let i = 0; i < required.length; i++) {
    const pos = arr2[i] % charsArr.length;
    charsArr[pos] = required[i];
  }
  return charsArr.join('');
}

export function PasswordGeneratorApp({ windowId }: Props) {
  const [length, setLength] = useState(16);
  const [options, setOptions] = useState({ upper: true, lower: true, numbers: true, symbols: true });
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<GeneratedPassword[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('password-history');
      setHistory(raw ? JSON.parse(raw) : []);
    } catch { setHistory([]); }
  }, []);

  const saveHistory = (p: GeneratedPassword) => {
    const updated = [p, ...history.filter(h => h.value !== p.value)].slice(0, 20);
    setHistory(updated);
    localStorage.setItem('password-history', JSON.stringify(updated));
  };

  const regenerate = useCallback(() => {
    const pwd = generatePassword(length, options);
    setPassword(pwd);
    const strength = getStrength(pwd);
    const entry: GeneratedPassword = { id: `pwd-${Date.now()}`, value: pwd, timestamp: Date.now(), strength: strength.label as any };
    saveHistory(entry);
  }, [length, options, history]);

  useEffect(() => { regenerate(); }, []);

  const copyPassword = async (pwd?: string) => {
    const toCopy = pwd ?? password;
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('复制失败');
    }
  };

  const useHistory = (pwd: string) => {
    setPassword(pwd);
    setShowHistory(false);
  };

  const strength = password ? getStrength(password) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text)', padding: '16px', overflowY: 'auto' }}>
      {/* Password display */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '14px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '10px 12px' }}>
          <Key size={16} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
          <code style={{ flex: 1, fontSize: '15px', fontFamily: 'monospace', wordBreak: 'break-all', userSelect: 'none', color: 'var(--color-accent)' }}>
            {showPassword ? password : '•'.repeat(Math.min(password.length, 24))}
          </code>
          <button onClick={() => setShowPassword(v => !v)} title={showPassword ? '隐藏' : '显示'} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', flexShrink: 0 }}>
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={regenerate} title="重新生成" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', flexShrink: 0 }}>
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => copyPassword()}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', background: copied ? '#22c55e' : 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500, flexShrink: 0 }}
          >
            {copied ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制</>}
          </button>
        </div>

        {/* Strength bar */}
        {strength && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>密码强度</span>
              <span style={{ color: strength.color, fontWeight: 600 }}>{strength.label}</span>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[1, 2, 3, 4].map(i => (
                <div key={i} style={{ flex: 1, height: '4px', borderRadius: '2px', background: i <= Math.ceil(strength.score / 1.5) ? strength.color : 'var(--color-border)', transition: 'background 0.3s' }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Length slider */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '14px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>密码长度</span>
          <span style={{ fontWeight: 600, color: 'var(--color-accent)', fontSize: '15px' }}>{length}</span>
        </div>
        <input
          type="range" min="8" max="64" value={length}
          onChange={e => { setLength(Number(e.target.value)); }}
          style={{ width: '100%', accentColor: 'var(--color-accent)' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
          <span>8</span><span>16</span><span>32</span><span>48</span><span>64</span>
        </div>
      </div>

      {/* Options */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '14px', marginBottom: '14px' }}>
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '10px' }}>字符类型</div>
        {([
          { key: 'upper', label: '大写字母 (A-Z)', example: 'ABC' },
          { key: 'lower', label: '小写字母 (a-z)', example: 'abc' },
          { key: 'numbers', label: '数字 (0-9)', example: '123' },
          { key: 'symbols', label: '符号 (!@#$%...)', example: '!@#' },
        ] as const).map(({ key, label, example }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', cursor: 'pointer', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={options[key]}
              onChange={e => setOptions(o => ({ ...o, [key]: e.target.checked }))}
              style={{ width: '15px', height: '15px', accentColor: 'var(--color-accent)', cursor: 'pointer' }}
            />
            <span style={{ flex: 1 }}>{label}</span>
            <code style={{ fontSize: '11px', color: 'var(--color-text-secondary)', background: 'var(--color-bg)', padding: '1px 5px', borderRadius: '3px' }}>{example}</code>
          </label>
        ))}
      </div>

      {/* Generate button */}
      <button
        onClick={regenerate}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '10px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 500, marginBottom: '12px' }}
      >
        <RefreshCw size={14} /> 生成密码
      </button>

      {/* History */}
      <button
        onClick={() => setShowHistory(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%', padding: '8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--color-text-secondary)' }}
      >
        <Shield size={12} /> {showHistory ? '隐藏历史' : `查看历史 (${history.length})`}
      </button>

      {showHistory && history.length > 0 && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {history.map(h => (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '11px' }}>
              <span style={{ flex: 1, fontFamily: 'monospace', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {'•'.repeat(16)}
              </span>
              <span style={{ color: h.strength === 'very-strong' ? '#10b981' : h.strength === 'strong' ? '#22c55e' : '#f97316', fontSize: '10px', flexShrink: 0 }}>{h.strength}</span>
              <button onClick={() => copyPassword(h.value)} style={{ padding: '3px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', flexShrink: 0 }}>
                <Copy size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
