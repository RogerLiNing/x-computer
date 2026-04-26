import { useState } from 'react';
import { ArrowLeftRight, Copy, Check } from 'lucide-react';
import { useState as useReactState } from 'react';

interface Props {
  windowId: string;
}

type Category = 'length' | 'weight' | 'temperature' | 'speed' | 'time' | 'data' | 'area' | 'volume';

interface UnitDef {
  name: string;
  symbol: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

type UnitMap = Record<Category, UnitDef[]>;

const UNITS: UnitMap = {
  length: [
    { name: '毫米', symbol: 'mm', toBase: v => v / 1000, fromBase: v => v * 1000 },
    { name: '厘米', symbol: 'cm', toBase: v => v / 100, fromBase: v => v * 100 },
    { name: '米', symbol: 'm', toBase: v => v, fromBase: v => v },
    { name: '千米', symbol: 'km', toBase: v => v * 1000, fromBase: v => v / 1000 },
    { name: '英寸', symbol: 'in', toBase: v => v * 0.0254, fromBase: v => v / 0.0254 },
    { name: '英尺', symbol: 'ft', toBase: v => v * 0.3048, fromBase: v => v / 0.3048 },
    { name: '英里', symbol: 'mi', toBase: v => v * 1609.344, fromBase: v => v / 1609.344 },
    { name: '海里', symbol: 'nmi', toBase: v => v * 1852, fromBase: v => v / 1852 },
  ],
  weight: [
    { name: '毫克', symbol: 'mg', toBase: v => v / 1_000_000, fromBase: v => v * 1_000_000 },
    { name: '克', symbol: 'g', toBase: v => v / 1000, fromBase: v => v * 1000 },
    { name: '千克', symbol: 'kg', toBase: v => v, fromBase: v => v },
    { name: '吨', symbol: 't', toBase: v => v * 1000, fromBase: v => v / 1000 },
    { name: '磅', symbol: 'lb', toBase: v => v * 0.453592, fromBase: v => v / 0.453592 },
    { name: '盎司', symbol: 'oz', toBase: v => v * 0.0283495, fromBase: v => v / 0.0283495 },
  ],
  temperature: [
    { name: '摄氏度', symbol: '°C', toBase: v => v, fromBase: v => v },
    { name: '华氏度', symbol: '°F', toBase: v => (v - 32) * 5 / 9, fromBase: v => v * 9 / 5 + 32 },
    { name: '开尔文', symbol: 'K', toBase: v => v - 273.15, fromBase: v => v + 273.15 },
  ],
  speed: [
    { name: '米/秒', symbol: 'm/s', toBase: v => v, fromBase: v => v },
    { name: '千米/时', symbol: 'km/h', toBase: v => v / 3.6, fromBase: v => v * 3.6 },
    { name: '英里/时', symbol: 'mph', toBase: v => v * 0.44704, fromBase: v => v / 0.44704 },
    { name: '节', symbol: 'kn', toBase: v => v * 0.514444, fromBase: v => v / 0.514444 },
    { name: '马赫', symbol: 'Ma', toBase: v => v * 343, fromBase: v => v / 343 },
  ],
  time: [
    { name: '毫秒', symbol: 'ms', toBase: v => v / 1000, fromBase: v => v * 1000 },
    { name: '秒', symbol: 's', toBase: v => v, fromBase: v => v },
    { name: '分钟', symbol: 'min', toBase: v => v * 60, fromBase: v => v / 60 },
    { name: '小时', symbol: 'h', toBase: v => v * 3600, fromBase: v => v / 3600 },
    { name: '天', symbol: 'd', toBase: v => v * 86400, fromBase: v => v / 86400 },
    { name: '周', symbol: 'wk', toBase: v => v * 604800, fromBase: v => v / 604800 },
    { name: '年', symbol: 'yr', toBase: v => v * 31536000, fromBase: v => v / 31536000 },
  ],
  data: [
    { name: '字节', symbol: 'B', toBase: v => v, fromBase: v => v },
    { name: '千字节', symbol: 'KB', toBase: v => v * 1024, fromBase: v => v / 1024 },
    { name: '兆字节', symbol: 'MB', toBase: v => v * 1024 * 1024, fromBase: v => v / (1024 * 1024) },
    { name: '吉字节', symbol: 'GB', toBase: v => v * 1024 * 1024 * 1024, fromBase: v => v / (1024 * 1024 * 1024) },
    { name: '太字节', symbol: 'TB', toBase: v => v * 1024 ** 4, fromBase: v => v / (1024 ** 4) },
    { name: '比特', symbol: 'b', toBase: v => v / 8, fromBase: v => v * 8 },
  ],
  area: [
    { name: '平方厘米', symbol: 'cm²', toBase: v => v / 10000, fromBase: v => v * 10000 },
    { name: '平方米', symbol: 'm²', toBase: v => v, fromBase: v => v },
    { name: '平方千米', symbol: 'km²', toBase: v => v * 1_000_000, fromBase: v => v / 1_000_000 },
    { name: '公顷', symbol: 'ha', toBase: v => v * 10000, fromBase: v => v / 10000 },
    { name: '平方英尺', symbol: 'ft²', toBase: v => v * 0.092903, fromBase: v => v / 0.092903 },
    { name: '平方英里', symbol: 'mi²', toBase: v => v * 2589988.11, fromBase: v => v / 2589988.11 },
    { name: '英亩', symbol: 'ac', toBase: v => v * 4046.86, fromBase: v => v / 4046.86 },
  ],
  volume: [
    { name: '毫升', symbol: 'mL', toBase: v => v / 1000, fromBase: v => v * 1000 },
    { name: '升', symbol: 'L', toBase: v => v, fromBase: v => v },
    { name: '立方米', symbol: 'm³', toBase: v => v * 1000, fromBase: v => v / 1000 },
    { name: '加仑(美)', symbol: 'gal', toBase: v => v * 3.78541, fromBase: v => v / 3.78541 },
    { name: '夸脱', symbol: 'qt', toBase: v => v * 0.946353, fromBase: v => v / 0.946353 },
    { name: '品脱', symbol: 'pt', toBase: v => v * 0.473176, fromBase: v => v / 0.473176 },
    { name: '杯', symbol: 'cup', toBase: v => v * 0.236588, fromBase: v => v / 0.236588 },
  ],
};

const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: 'length', label: '长度', icon: '📏' },
  { id: 'weight', label: '重量', icon: '⚖️' },
  { id: 'temperature', label: '温度', icon: '🌡️' },
  { id: 'speed', label: '速度', icon: '🚀' },
  { id: 'time', label: '时间', icon: '⏱️' },
  { id: 'data', label: '数据', icon: '💾' },
  { id: 'area', label: '面积', icon: '📐' },
  { id: 'volume', label: '体积', icon: '🧊' },
];

function fmt(n: number): string {
  if (Math.abs(n) >= 1e10 || (Math.abs(n) < 1e-6 && n !== 0)) {
    return n.toExponential(6);
  }
  const rounded = Math.round(n * 1e8) / 1e8;
  return String(rounded);
}

export function UnitConverterApp({ windowId }: Props) {
  const [category, setCategory] = useState<Category>('length');
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [input, setInput] = useState('1');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const units = UNITS[category];
  const inputNum = parseFloat(input) || 0;
  const baseValue = units[fromIdx].toBase(inputNum);
  const results = units
    .map((u, i) => ({ unit: u, value: u.fromBase(baseValue), idx: i }))
    .filter(r => r.idx !== fromIdx);

  const copyResult = async (value: number, idx: number) => {
    try {
      await navigator.clipboard.writeText(fmt(value));
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text)' }}>
      {/* Category tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setCategory(cat.id); setFromIdx(0); setToIdx(1); }}
            style={{
              padding: '4px 10px', borderRadius: '16px', fontSize: '12px', cursor: 'pointer',
              background: category === cat.id ? 'var(--color-accent)' : 'var(--color-surface)',
              color: category === cat.id ? '#fff' : 'var(--color-text-secondary)',
              border: `1px solid ${category === cat.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
            }}
          >
            {cat.icon} {cat.label}
          </button>
        ))}
      </div>

      {/* Converter */}
      <div style={{ padding: '14px', flex: 1, overflowY: 'auto' }}>
        {/* From */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '12px', marginBottom: '8px' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>从</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '16px', fontFamily: 'monospace', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }}
              placeholder="0"
            />
            <select
              value={fromIdx}
              onChange={e => setFromIdx(Number(e.target.value))}
              style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px', background: 'var(--color-bg)', color: 'var(--color-text)', cursor: 'pointer', maxWidth: '140px' }}
            >
              {units.map((u, i) => <option key={i} value={i}>{u.symbol} — {u.name}</option>)}
            </select>
          </div>
        </div>

        {/* Swap button */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
          <button
            onClick={() => { setFromIdx(toIdx); setToIdx(fromIdx); }}
            style={{ padding: '6px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '50%', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex' }}
            title="交换"
          >
            <ArrowLeftRight size={14} />
          </button>
        </div>

        {/* To */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-accent)', borderRadius: '10px', padding: '12px', marginBottom: '10px' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-accent)', marginBottom: '6px' }}>转换为</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ flex: 1, padding: '8px 10px', fontSize: '18px', fontFamily: 'monospace', color: 'var(--color-accent)', fontWeight: 600, wordBreak: 'break-all' }}>
              {fmt(UNITS[category][toIdx].fromBase(UNITS[category][fromIdx].toBase(inputNum)))}
            </div>
            <div style={{ padding: '8px 10px', background: 'var(--color-accent-bg)', color: 'var(--color-accent)', borderRadius: '8px', fontSize: '13px', fontWeight: 500 }}>
              {units[toIdx].symbol}
            </div>
          </div>
        </div>

        {/* All conversions */}
        <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>所有单位换算</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {results.map(r => (
            <div key={r.idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
              <span style={{ flex: 1, fontSize: '14px', fontFamily: 'monospace', color: 'var(--color-text)' }}>{fmt(r.value)}</span>
              <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', minWidth: '50px', textAlign: 'right' }}>{r.unit.symbol}</span>
              <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', minWidth: '60px' }}>{r.unit.name}</span>
              <button onClick={() => copyResult(r.value, r.idx)} style={{ padding: '3px', background: 'transparent', border: 'none', cursor: 'pointer', color: copiedIdx === r.idx ? '#22c55e' : 'var(--color-text-secondary)', display: 'flex', flexShrink: 0 }}>
                {copiedIdx === r.idx ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
