import { useState, useEffect } from 'react';
import { Save, FileText, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/utils/api';
import { useDesktopStore } from '@/store/desktopStore';

interface Props {
  windowId: string;
  metadata?: Record<string, unknown>;
}

type OfficeData =
  | { type: 'docx'; text: string; title?: string }
  | { type: 'xlsx'; sheets: { name: string; rows: string[][] }[] }
  | { type: 'pptx'; unsupported: true; message?: string };

export function OfficeViewerApp({ windowId, metadata }: Props) {
  const filePath = metadata?.filePath as string | undefined;
  const fileName = (metadata?.fileName as string) || '文档';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OfficeData | null>(null);
  const [modified, setModified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docxText, setDocxText] = useState('');
  const [docxTitle, setDocxTitle] = useState('');
  const [xlsxSheets, setXlsxSheets] = useState<{ name: string; rows: string[][] }[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const { addNotification, setWindowTitle } = useDesktopStore();

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    if (!filePath) {
      setLoading(false);
      return;
    }
    api
      .readOfficeFile(filePath)
      .then((res) => {
        if (res.unsupported && res.type === 'pptx') {
          setData({ type: 'pptx', unsupported: true, message: res.message });
          setWindowTitle(windowId, `办公文档 — ${fileName}`);
          return;
        }
        if (res.type === 'docx' && res.text != null) {
          setData({ type: 'docx', text: res.text });
          setDocxText(res.text);
          setWindowTitle(windowId, `Word — ${fileName}`);
          return;
        }
        if (res.type === 'xlsx' && Array.isArray(res.sheets)) {
          setData({ type: 'xlsx', sheets: res.sheets });
          setXlsxSheets(res.sheets.map((s) => ({ name: s.name, rows: s.rows.map((r) => [...r]) })));
          setWindowTitle(windowId, `Excel — ${fileName}`);
          return;
        }
        setError('无法解析该办公文件');
      })
      .catch((e) => {
        setError(e?.message || '加载失败');
      })
      .finally(() => setLoading(false));
  }, [filePath, fileName, windowId, setWindowTitle]);

  const handleSaveDocx = async () => {
    if (!filePath || data?.type !== 'docx') return;
    setSaving(true);
    try {
      await api.writeOfficeFile(filePath, 'docx', { text: docxText, title: docxTitle || undefined });
      setModified(false);
      addNotification({ type: 'info', title: '已保存', message: fileName });
    } catch (e: unknown) {
      addNotification({ type: 'error', title: '保存失败', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveXlsx = async () => {
    if (!filePath || data?.type !== 'xlsx') return;
    setSaving(true);
    try {
      await api.writeOfficeFile(filePath, 'xlsx', { sheets: xlsxSheets });
      setModified(false);
      addNotification({ type: 'info', title: '已保存', message: fileName });
    } catch (e: unknown) {
      addNotification({ type: 'error', title: '保存失败', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleXlsxCellChange = (sheetIndex: number, rowIndex: number, colIndex: number, value: string) => {
    setXlsxSheets((prev) => {
      const sheet = prev[sheetIndex];
      if (!sheet) return prev;
      let rows = sheet.rows.map((r) => [...r]);
      while (rows.length <= rowIndex) rows.push([]);
      const row = rows[rowIndex]!;
      while (row.length <= colIndex) row.push('');
      row[colIndex] = value;
      return prev.map((s, i) => (i === sheetIndex ? { ...s, rows } : s));
    });
    setModified(true);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-desktop-text/80">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>加载中…</span>
      </div>
    );
  }

  if (error || !filePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-desktop-text/90">
        <AlertCircle className="h-10 w-10 text-amber-500" />
        <p>{error || '请从文件管理器中打开 .docx 或 .xlsx 文件'}</p>
      </div>
    );
  }

  if (data?.type === 'pptx' && data.unsupported) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-desktop-text/90">
        <FileText className="h-12 w-12 text-desktop-text/60" />
        <p>{data.message || 'PPT 预览与编辑即将支持'}</p>
        <p className="text-sm text-desktop-text/70">可让 X 主脑用 office.create_pptx 生成汇报，或下载后用本地软件打开</p>
      </div>
    );
  }

  if (data?.type === 'docx') {
    return (
      <div className="flex h-full flex-col bg-desktop-bg p-3">
        <div className="mb-2 flex items-center justify-between gap-2 border-b border-desktop-border pb-2">
          <input
            type="text"
            placeholder="标题（可选）"
            value={docxTitle}
            onChange={(e) => {
              setDocxTitle(e.target.value);
              setModified(true);
            }}
            className="flex-1 rounded border border-desktop-border bg-desktop-panel px-2 py-1 text-sm text-desktop-text outline-none focus:border-desktop-focus"
          />
          <button
            onClick={handleSaveDocx}
            disabled={saving || !modified}
            className="flex items-center gap-1 rounded bg-desktop-focus px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </button>
        </div>
        <textarea
          value={docxText}
          onChange={(e) => {
            setDocxText(e.target.value);
            setModified(true);
          }}
          className="min-h-0 flex-1 resize-none rounded border border-desktop-border bg-desktop-panel p-3 text-sm text-desktop-text outline-none focus:border-desktop-focus"
          placeholder="正文…"
          spellCheck
        />
      </div>
    );
  }

  if (data?.type === 'xlsx') {
    const sheet = xlsxSheets[activeSheetIndex];
    const rows = sheet?.rows ?? [];
    const maxCols = Math.max(0, ...rows.map((r) => r.length));

    return (
      <div className="flex h-full flex-col bg-desktop-bg p-3">
        <div className="mb-2 flex items-center justify-between gap-2 border-b border-desktop-border pb-2">
          <div className="flex flex-wrap gap-1">
            {xlsxSheets.map((s, i) => (
              <button
                key={s.name}
                onClick={() => setActiveSheetIndex(i)}
                className={`rounded px-2 py-1 text-sm ${i === activeSheetIndex ? 'bg-desktop-focus text-white' : 'bg-desktop-panel text-desktop-text'}`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <button
            onClick={handleSaveXlsx}
            disabled={saving || !modified}
            className="flex items-center gap-1 rounded bg-desktop-focus px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded border border-desktop-border">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {Array.from({ length: Math.max(row.length, maxCols) }).map((_, colIndex) => (
                    <td key={colIndex} className="border border-desktop-border p-0">
                      <input
                        type="text"
                        value={row[colIndex] ?? ''}
                        onChange={(e) => handleXlsxCellChange(activeSheetIndex, rowIndex, colIndex, e.target.value)}
                        className="min-w-[4rem] border-0 bg-transparent px-1.5 py-0.5 text-desktop-text outline-none focus:bg-desktop-panel"
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="border border-desktop-border p-2 text-desktop-text/60">空表，可在首格输入后保存</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null;
}
