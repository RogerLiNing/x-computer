import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Pencil, Eraser, Trash2, Download, Undo2, Redo2,
  Circle, Minus, Type, Palette,
} from 'lucide-react';

type Tool = 'pen' | 'eraser' | 'line' | 'circle' | 'text';

const PRESET_COLORS = [
  '#ffffff', '#f87171', '#fb923c', '#fbbf24',
  '#4ade80', '#34d399', '#22d3ee', '#60a5fa',
  '#a78bfa', '#f472b6', '#9ca3af', '#1f2937',
];

const DEFAULT_COLOR = '#ffffff';

interface CanvasState {
  paths: Array<{
    points: Array<{ x: number; y: number }>;
    color: string;
    width: number;
    tool: Tool;
  }>;
  undone: Array<{
    points: Array<{ x: number; y: number }>;
    color: string;
    width: number;
    tool: Tool;
  }>;
}

export function CanvasApp({ windowId }: { windowId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [lineWidth, setLineWidth] = useState(3);
  const [history, setHistory] = useState<CanvasState>({ paths: [], undone: [] });
  const currentPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      redraw(canvas, history.paths);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  function redraw(
    canvas: HTMLCanvasElement,
    paths: CanvasState['paths'],
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const path of paths) {
      if (path.points.length < 2) continue;
      ctx.strokeStyle = path.color;
      ctx.fillStyle = path.color;
      ctx.lineWidth = path.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (path.tool === 'circle') {
        const start = path.points[0];
        const end = path.points[path.points.length - 1];
        const rx = Math.abs(end.x - start.x) / 2;
        const ry = Math.abs(end.y - start.y) / 2;
        const cx = (start.x + end.x) / 2;
        const cy = (start.y + end.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (path.tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        ctx.lineTo(path.points[path.points.length - 1].x, path.points[path.points.length - 1].y);
        ctx.stroke();
      } else if (path.tool === 'text') {
        ctx.font = `${path.width * 5}px sans-serif`;
        ctx.fillText(path.points.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join(''), path.points[0].x, path.points[0].y);
      } else {
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        ctx.stroke();
      }
    }
  }

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDraw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'text') {
      const pos = getPos(e);
      setTextPos(pos);
      setTextInput('');
      return;
    }
    setIsDrawing(true);
    const pos = getPos(e);
    currentPathRef.current = [pos];
  }, [tool]);

  const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pos = getPos(e);
    currentPathRef.current.push(pos);

    // Live preview
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const last = currentPathRef.current;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (tool === 'circle') {
      if (last.length < 2) return;
      redraw(canvas, history.paths);
      const start = last[0];
      const rx = Math.abs(pos.x - start.x) / 2;
      const ry = Math.abs(pos.y - start.y) / 2;
      const cx = (start.x + pos.x) / 2;
      const cy = (start.y + pos.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tool === 'line') {
      if (last.length < 2) return;
      redraw(canvas, history.paths);
      ctx.beginPath();
      ctx.moveTo(last[0].x, last[0].y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(last[last.length - 2]?.x ?? pos.x, last[last.length - 2]?.y ?? pos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
  }, [isDrawing, color, lineWidth, tool, history.paths]);

  const endDraw = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentPathRef.current.length > 0) {
      const newPath = {
        points: [...currentPathRef.current],
        color,
        width: lineWidth,
        tool,
      };
      const newPaths = [...history.paths, newPath];
      setHistory({ paths: newPaths, undone: [] });
      currentPathRef.current = [];
    }
  }, [isDrawing, color, lineWidth, tool, history.paths]);

  const handleTextSubmit = useCallback(() => {
    if (!textPos || !textInput.trim()) { setTextPos(null); return; }
    const newPath = {
      points: [textPos],
      color,
      width: lineWidth,
      tool: 'text' as Tool,
    };
    const textData = JSON.stringify({ text: textInput.trim() });
    // Store text in color field as a workaround (simple approach)
    const newPathWithText = { ...newPath, color: `text:${textData}` };
    const newPaths = [...history.paths, newPathWithText];
    setHistory({ paths: newPaths, undone: [] });
    setTextPos(null);
    setTextInput('');
  }, [textPos, textInput, color, lineWidth, history.paths]);

  const undo = useCallback(() => {
    if (history.paths.length === 0) return;
    const last = history.paths[history.paths.length - 1];
    setHistory({
      paths: history.paths.slice(0, -1),
      undone: [...history.undone, last],
    });
  }, [history]);

  const redo = useCallback(() => {
    if (history.undone.length === 0) return;
    const last = history.undone[history.undone.length - 1];
    setHistory({
      paths: [...history.paths, last],
      undone: history.undone.slice(0, -1),
    });
  }, [history]);

  // Redraw when history changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    redraw(canvas, history.paths);
  }, [history]);

  const clear = () => {
    setHistory({ paths: [], undone: [] });
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const exportImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full bg-desktop-surface select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5 shrink-0 bg-white/[0.02]">
        {/* Tools */}
        <div className="flex items-center gap-0.5">
          <ToolBtn active={tool === 'pen'} onClick={() => setTool('pen')} title="画笔">
            <Pencil size={14} />
          </ToolBtn>
          <ToolBtn active={tool === 'eraser'} onClick={() => setTool('eraser')} title="橡皮">
            <Eraser size={14} />
          </ToolBtn>
          <ToolBtn active={tool === 'line'} onClick={() => setTool('line')} title="直线">
            <Minus size={14} />
          </ToolBtn>
          <ToolBtn active={tool === 'circle'} onClick={() => setTool('circle')} title="圆形">
            <Circle size={14} />
          </ToolBtn>
          <ToolBtn active={tool === 'text'} onClick={() => setTool('text')} title="文字">
            <Type size={14} />
          </ToolBtn>
        </div>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Colors */}
        <div className="flex items-center gap-1 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              className={`w-4 h-4 rounded-full border-2 transition-transform ${
                color === c ? 'border-desktop-accent scale-125' : 'border-white/20 hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Line width */}
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={1}
            max={20}
            value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
            className="w-16 h-1 accent-desktop-accent"
            title={`线宽: ${lineWidth}px`}
          />
          <span className="text-[10px] text-desktop-muted w-5">{lineWidth}</span>
        </div>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Actions */}
        <ToolBtn onClick={undo} disabled={history.paths.length === 0} title="撤销 (Ctrl+Z)">
          <Undo2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={redo} disabled={history.undone.length === 0} title="重做 (Ctrl+Y)">
          <Redo2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={clear} title="清空画布">
          <Trash2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={exportImage} title="导出为 PNG">
          <Download size={14} />
        </ToolBtn>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 relative bg-[#1a1a2e]">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair"
          style={{ touchAction: 'none' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
        />
        {/* Text input overlay */}
        {textPos && (
          <div
            className="absolute"
            style={{ left: textPos.x, top: textPos.y - 24 }}
          >
            <input
              autoFocus
              className="bg-black/60 border border-desktop-accent/50 rounded px-2 py-1 text-xs text-white outline-none"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTextSubmit();
                if (e.key === 'Escape') setTextPos(null);
              }}
              onBlur={handleTextSubmit}
              placeholder="输入文字后按回车"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBtn({
  children, active, onClick, disabled, title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-desktop-accent/20 text-desktop-accent'
          : 'text-desktop-muted hover:bg-white/10 hover:text-desktop-text'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
      onClick={disabled ? undefined : onClick}
      title={title}
    >
      {children}
    </button>
  );
}
