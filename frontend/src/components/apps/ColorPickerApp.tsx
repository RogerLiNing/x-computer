import { useState, useRef, useCallback, useEffect } from 'react';
import { Copy, Check, Palette } from 'lucide-react';

interface Props {
  windowId: string;
}

interface ColorEntry {
  id: string;
  hex: string;
  r: number; g: number; b: number;
  h: number; s: number; l: number;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function getComplementary(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(255 - r, 255 - g, 255 - b);
}

function getAnalogous(hex: string): [string, string] {
  const rgb = hexToRgb(hex);
  if (!rgb) return [hex, hex];
  const [h, s, l] = rgbToHsl(...rgb);
  const [r1, g1, b1] = hslToRgb((h + 30) % 360, s, l);
  const [r2, g2, b2] = hslToRgb((h - 30 + 360) % 360, s, l);
  return [rgbToHex(r1, g1, b1), rgbToHex(r2, g2, b2)];
}

export function ColorPickerApp({ windowId }: Props) {
  const [color, setColor] = useState('#6366f1');
  const [hsv, setHsv] = useState({ h: 239, s: 62, v: 95 });
  const [hexInput, setHexInput] = useState('#6366f1');
  const [history, setHistory] = useState<ColorEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const squareRef = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);

  const rgb: [number, number, number] = hslToRgb(hsv.h, (hsv.s * 100), ((hsv.v * 100)));
  const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('color-history');
      setHistory(raw ? JSON.parse(raw) : []);
    } catch { setHistory([]); }
  }, []);

  const saveHistory = (entry: ColorEntry) => {
    const updated = [entry, ...history.filter(h => h.hex !== entry.hex)].slice(0, 24);
    setHistory(updated);
    localStorage.setItem('color-history', JSON.stringify(updated));
  };

  const applyFromHsv = useCallback((h: number, s: number, v: number) => {
    setHsv({ h, s, v });
    const [r, g, b] = hslToRgb(h, s, v);
    const hex = rgbToHex(r, g, b);
    setHexInput(hex);
    setColor(hex);
  }, []);

  // Draw color square
  useEffect(() => {
    const canvas = squareRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { h, s, v } = hsv;
    const [r, g, b] = hslToRgb(h, 50, 50);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gradWhite = ctx.createLinearGradient(0, 0, canvas.width, 0);
    gradWhite.addColorStop(0, 'rgba(255,255,255,1)');
    gradWhite.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradWhite;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gradBlack = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradBlack.addColorStop(0, 'rgba(0,0,0,0)');
    gradBlack.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradBlack;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Draw selector
    ctx.beginPath();
    ctx.arc(hsv.s * 2, (100 - hsv.v) * 2, 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hsv.s * 2, (100 - hsv.v) * 2, 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [hsv]);

  // Draw hue slider
  useEffect(() => {
    const canvas = hueRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    for (let i = 0; i <= 360; i += 30) {
      grad.addColorStop(i / 360, `hsl(${i},100%,50%)`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Draw selector
    ctx.beginPath();
    ctx.arc(hsv.h * (canvas.width / 360), canvas.height / 2, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 2;
  }, [hsv.h]);

  const handleSquareClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = squareRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(199, e.clientX - rect.left));
    const y = Math.max(0, Math.min(199, e.clientY - rect.top));
    const s = Math.round(x / 2);
    const v = Math.round(100 - y / 2);
    applyFromHsv(hsv.h, s, v);
  };

  const handleHueClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = hueRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const h = Math.round((x / rect.width) * 360);
    applyFromHsv(h, hsv.s, hsv.v);
  };

  const copyValue = async (val: string, key: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* ignore */ }
  };

  const addToHistory = () => {
    const entry: ColorEntry = { id: `color-${Date.now()}`, hex, r: rgb[0], g: rgb[1], b: rgb[2], h: hsl[0], s: hsl[1], l: hsl[2] };
    saveHistory(entry);
  };

  const applyFromHex = (hex: string) => {
    const rgb_ = hexToRgb(hex);
    if (!rgb_) return;
    const hsl_ = rgbToHsl(rgb_[0], rgb_[1], rgb_[2]);
    const [r, g, b] = rgb_;
    setColor(hex);
    setHsv(prev => ({ ...prev, h: hsl_[0] }));
    // Convert RGB back to HSV for square position
    const s = hsl_[1];
    const v = hsl_[2];
    setHsv({ h: hsl_[0], s: hsl_[1], v: hsl_[2] });
    setHexInput(hex);
  };

  const applyFromRgb = (r: number, g: number, b: number) => {
    const hex = rgbToHex(r, g, b);
    const hsl_ = rgbToHsl(r, g, b);
    setColor(hex);
    setHsv({ h: hsl_[0], s: hsl_[1], v: hsl_[2] });
    setHexInput(hex);
  };

  const [complementary, analogous] = [getComplementary(hex), getAnalogous(hex)];

  const rgbStr = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const hslStr = `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text)', overflowY: 'auto', padding: '14px', gap: '12px' }}>
      {/* Color square */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <canvas
            ref={squareRef} width={200} height={200}
            onClick={handleSquareClick}
            style={{ borderRadius: '8px', cursor: 'crosshair', display: 'block' }}
          />
          <canvas
            ref={hueRef} width={200} height={14}
            onClick={handleHueClick}
            style={{ borderRadius: '4px', cursor: 'pointer', display: 'block', marginTop: '6px' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: '140px' }}>
          {/* Preview */}
          <div style={{ width: '100%', height: '60px', borderRadius: '8px', background: hex, border: '1px solid var(--color-border)', marginBottom: '10px' }} />
          {/* HEX input */}
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '11px', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '3px' }}>HEX</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input value={hexInput} onChange={e => applyFromHex(e.target.value)}
                style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }} />
              <button onClick={() => copyValue(hex, 'hex')} style={{ padding: '5px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', color: copied === 'hex' ? '#22c55e' : 'var(--color-text-secondary)', display: 'flex' }}>
                {copied === 'hex' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>
          {/* RGB sliders */}
          {(['r', 'g', 'b'] as const).map((ch, i) => (
            <div key={ch} style={{ marginBottom: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>{ch.toUpperCase()}</span>
                <span style={{ fontFamily: 'monospace' }}>{rgb[i]}</span>
              </div>
              <input type="range" min="0" max="255" value={rgb[i]}
                onChange={e => {
                  const r = [...rgb] as [number, number, number];
                  r[i] = parseInt(e.target.value);
                  applyFromRgb(r[0], r[1], r[2]);
                }}
                style={{ width: '100%', accentColor: ['#ef4444', '#22c55e', '#3b82f6'][i] }}
              />
            </div>
          ))}
          <button onClick={addToHistory} style={{ width: '100%', padding: '6px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            + 保存到历史
          </button>
        </div>
      </div>

      {/* Values */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {[
          { label: 'HEX', value: hex, key: 'hex' },
          { label: 'RGB', value: rgbStr, key: 'rgb' },
          { label: 'HSL', value: hslStr, key: 'hsl' },
        ].map(({ label, value, key }) => (
          <div key={key} style={{ flex: 1, minWidth: '100px', padding: '8px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>{label}</div>
            <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--color-text)', wordBreak: 'break-all' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Complementary / Analogous */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1, padding: '8px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>互补色</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '100%', height: '28px', borderRadius: '4px', background: complementary, border: '1px solid var(--color-border)' }} />
            <button onClick={() => copyValue(complementary, 'comp')} style={{ fontSize: '10px', padding: '2px 6px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '4px', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
              {copied === 'comp' ? <Check size={9} /> : <Copy size={9} />} {complementary}
            </button>
          </div>
        </div>
        <div style={{ flex: 1, padding: '8px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>类似色</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {analogous.map((c, i) => (
              <button key={i} onClick={() => copyValue(c, `analog${i}`)} style={{ flex: 1, padding: '2px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <div style={{ width: '100%', height: '28px', borderRadius: '4px', background: c, border: '1px solid var(--color-border)' }} />
                <div style={{ fontSize: '9px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{c}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>历史 ({history.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {history.map(h => (
              <button
                key={h.id}
                onClick={() => applyFromHex(h.hex)}
                title={h.hex}
                style={{ width: '28px', height: '28px', borderRadius: '50%', background: h.hex, border: h.hex === hex ? '2px solid var(--color-accent)' : '2px solid var(--color-border)', cursor: 'pointer', padding: 0 }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
