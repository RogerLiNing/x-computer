import { useState } from 'react';
import { Bot, Save, Plus, BarChart3 } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';

const COLS = 8;
const ROWS = 15;
const COL_LABELS = 'ABCDEFGHIJKLMNOP'.split('');

const INITIAL_DATA: Record<string, string> = {
  'A0': '项目', 'B0': '一月', 'C0': '二月', 'D0': '三月', 'E0': '合计',
  'A1': '销售额', 'B1': '45000', 'C1': '52000', 'D1': '61000', 'E1': '158000',
  'A2': '成本', 'B2': '28000', 'C2': '31000', 'D2': '35000', 'E2': '94000',
  'A3': '利润', 'B3': '17000', 'C3': '21000', 'D3': '26000', 'E3': '64000',
  'A4': '增长率', 'B4': '-', 'C4': '15.6%', 'D4': '17.3%', 'E4': '',
};

interface Props {
  windowId: string;
}

export function SpreadsheetApp({ windowId }: Props) {
  const [data, setData] = useState<Record<string, string>>(INITIAL_DATA);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const addNotification = useDesktopStore((s) => s.addNotification);

  const getCellKey = (col: number, row: number) => `${COL_LABELS[col]}${row}`;

  const startEdit = (key: string) => {
    setSelectedCell(key);
    setEditValue(data[key] || '');
  };

  const commitEdit = () => {
    if (selectedCell) {
      setData((d) => ({ ...d, [selectedCell]: editValue }));
      setSelectedCell(null);
    }
  };

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 bg-white/[0.02]">
        <div className="w-16 text-center text-[11px] text-desktop-muted bg-white/5 rounded px-2 py-0.5">
          {selectedCell || '-'}
        </div>
        <div className="w-px h-5 bg-white/10" />
        <input
          value={selectedCell ? editValue : ''}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
          onBlur={commitEdit}
          className="flex-1 bg-white/5 rounded px-2 py-0.5 text-xs text-desktop-text outline-none border border-white/10 focus:border-desktop-highlight/30"
          placeholder="单元格内容..."
        />
        <button
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-500/20 text-blue-400 text-xs transition-colors"
          onClick={() => addNotification({ type: 'info', title: 'AI 分析', message: 'AI 正在分析表格数据并生成图表...' })}
        >
          <Bot size={12} />
          AI 分析
        </button>
        <button className="p-1.5 rounded hover:bg-white/10 transition-colors">
          <BarChart3 size={14} className="text-desktop-muted" />
        </button>
        <button className="p-1.5 rounded hover:bg-white/10 transition-colors">
          <Save size={14} className="text-desktop-muted" />
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse w-full">
          <thead>
            <tr>
              <th className="w-10 min-w-10 bg-white/[0.03] border border-white/5 text-[10px] text-desktop-muted font-normal" />
              {Array.from({ length: COLS }, (_, c) => (
                <th key={c} className="min-w-[100px] bg-white/[0.03] border border-white/5 text-[10px] text-desktop-muted font-medium py-1">
                  {COL_LABELS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, r) => (
              <tr key={r}>
                <td className="bg-white/[0.03] border border-white/5 text-[10px] text-desktop-muted text-center py-1 font-normal">
                  {r + 1}
                </td>
                {Array.from({ length: COLS }, (_, c) => {
                  const key = getCellKey(c, r);
                  const isHeader = r === 0;
                  const isSelected = key === selectedCell;
                  return (
                    <td
                      key={c}
                      className={`border border-white/5 px-2 py-1 text-xs cursor-default transition-colors ${
                        isSelected
                          ? 'bg-desktop-highlight/10 ring-1 ring-desktop-highlight/30'
                          : 'hover:bg-white/[0.03]'
                      } ${isHeader ? 'font-medium text-desktop-text' : 'text-desktop-text/80'}`}
                      onClick={() => startEdit(key)}
                    >
                      {isSelected ? (
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
                          onBlur={commitEdit}
                          className="w-full bg-transparent outline-none text-xs"
                          autoFocus
                        />
                      ) : (
                        data[key] || ''
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
