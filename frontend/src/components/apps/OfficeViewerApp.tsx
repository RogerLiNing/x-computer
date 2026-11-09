import { useState, useEffect, useRef, type ReactNode } from 'react';
import { Save, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/utils/api';
import { useDesktopStore } from '@/store/desktopStore';
import { useConnectionStore } from '@/store/connectionStore';

interface Props {
  windowId: string;
  metadata?: Record<string, unknown>;
}

type OfficeData =
  | { type: 'docx'; text: string; title?: string }
  | { type: 'xlsx'; sheets: { name: string; rows: string[][]; range?: string }[] }
  | { type: 'pdf'; pages: { page: number; text: string; ocr?: boolean }[]; warnings: string[] }
  | { type: 'pptx'; slides: { title?: string; content?: string }[] };

export function sheetCellAddress(range: string | undefined, row: number, column: number): string {
  const start = /^([A-Z]+)(\d+)/.exec(range ?? 'A1');
  let offset = [...(start?.[1] ?? 'A')].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) + column;
  let letters = '';
  while (offset > 0) { const digit = (offset - 1) % 26; letters = String.fromCharCode(65 + digit) + letters; offset = Math.floor((offset - 1) / 26); }
  return letters + (Number(start?.[2] ?? 1) + row);
}

export function PdfTextPreview({ pages, warnings, onDownload, children }: { pages: { page: number; text: string; ocr?: boolean }[]; warnings: string[]; onDownload?: () => void; children?: ReactNode }) {
  return <section aria-label="PDF 文字" className="h-full overflow-auto bg-desktop-bg p-4 text-desktop-text">
    <p className="mb-4 text-sm text-desktop-text/70">按原页码查看文字。{pages.some(page => page.ocr) ? (pages.some(page => page.text.trim()) ? '识别完成，请对照原文件检查文字。' : '没有识别出文字，请核对原件或换一份更清晰的扫描文件。') : '拍照或扫描得到的文件，可以点“识别扫描文字”，每次最多10页。'}图片和版式请下载原文件查看。</p>
    <div className="mb-4 flex flex-wrap items-center gap-2">{children}{onDownload && <button type="button" onClick={onDownload} className="min-h-11 rounded border border-white/20 px-4 py-2">下载原文件</button>}</div>
    {warnings.length > 0 && <div role="status" className="mb-4 rounded border border-amber-500 p-3">{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
    {pages.map(page => <article key={page.page} className="mb-4 rounded border border-white/15 p-4">
      <h2 className="mb-2 font-semibold">第 {page.page} 页</h2>
      <p className="whitespace-pre-wrap break-words">{page.text || '这一页没有可提取文字，可能是空白、图片或扫描件。'}</p>
    </article>)}
  </section>;
}

export function PresentationText({ slides }: { slides: { title?: string; content?: string }[] }) {
  return <section aria-label="演示稿文字" className="h-full overflow-auto bg-desktop-bg p-4 text-desktop-text">
    <p className="mb-4 text-sm text-desktop-text/70">按演示顺序查看文字。图片、版式和演讲备注请下载后用办公软件查看。</p>
    {slides.length === 0 && <p>这份演示稿没有可读取的页面。</p>}
    {slides.map((slide, index) => <article key={index} className="mb-4 rounded border border-white/15 p-4">
      <h2 className="mb-2 font-semibold">第 {index + 1} 页{slide.title ? ` · ${slide.title}` : ''}</h2>
      <p className="whitespace-pre-wrap">{slide.content || (!slide.title ? '这一页没有可读取的文字，可能包含图片。' : '')}</p>
    </article>)}
  </section>;
}

export function OfficeViewerApp({ windowId, metadata }: Props) {
  const filePath = metadata?.filePath as string | undefined;
  const fileName = (metadata?.fileName as string) || '文档';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OfficeData | null>(null);
  const [modified, setModified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docxText, setDocxText] = useState('');
  const [findText, setFindText] = useState('');
  const [replacement, setReplacement] = useState('');
  const [occurrences, setOccurrences] = useState(1);
  const [slideNumber, setSlideNumber] = useState(1);
  const [sourceSha, setSourceSha] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrMessage, setOcrMessage] = useState<{ text: string; error: boolean } | null>(null);
  const ocrController = useRef<AbortController | null>(null);
  const [cellEdits, setCellEdits] = useState<Record<string, {sheet: string; cell: string; value: string}>>({});
  const [savedCopy, setSavedCopy] = useState<{path: string; warnings: string[]} | null>(null);
  const [editError, setEditError] = useState('');
  const saveVersion = useRef(0);
  const [xlsxSheets, setXlsxSheets] = useState<{ name: string; rows: string[][] }[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const { addNotification } = useConnectionStore();
  const { setWindowTitle } = useDesktopStore();

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    saveVersion.current++;
    setOcrBusy(false); setOcrMessage(null);
    setModified(false); setSaving(false); setFindText(''); setReplacement(''); setOccurrences(1); setSlideNumber(1);
    setCellEdits({}); setSavedCopy(null); setEditError(''); setSourceSha(''); setActiveSheetIndex(0);
    if (!filePath) {
      setLoading(false);
      return;
    }
    api
      .readOfficeFile(filePath, controller.signal)
      .then((res) => {
        if (!active) return;
        setSourceSha(res.sha256 ?? '');
        if (res.type === 'pdf' && Array.isArray(res.pages)) {
          setData({ type: 'pdf', pages: res.pages, warnings: res.warnings ?? [] });
          setWindowTitle(windowId, `PDF 文字 — ${fileName}`);
          return;
        }
        if (res.type === 'pptx' && Array.isArray(res.slides)) {
          setData({ type: 'pptx', slides: res.slides });
          setWindowTitle(windowId, `演示稿文字 — ${fileName}`);
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
        if (!active) return;
        setError(e?.message || '加载失败');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); ocrController.current?.abort(); ocrController.current = null; };
  }, [filePath, fileName, windowId, setWindowTitle]);

  const recognizeScan = async () => {
    if (!filePath || !sourceSha || data?.type !== 'pdf' || ocrController.current) return;
    const controller = new AbortController();
    ocrController.current = controller; setOcrBusy(true); setOcrMessage(null);
    try {
      const result = await api.readOfficeFile(filePath, controller.signal, { ocr: true, expectedSha256: sourceSha });
      if (ocrController.current !== controller || controller.signal.aborted) return;
      if (result.type !== 'pdf' || !Array.isArray(result.pages)) throw new Error('未收到完整的识别结果，请重试');
      setData({ type: 'pdf', pages: result.pages, warnings: result.warnings ?? [] });
    } catch (error) {
      if (ocrController.current === controller && !controller.signal.aborted) setOcrMessage({ error: true, text: error instanceof Error ? error.message : '识别未完成，请重试' });
    } finally {
      if (ocrController.current === controller) { ocrController.current = null; setOcrBusy(false); }
    }
  };

  const handleSave = async () => {
    if (!filePath || !sourceSha || saving || !data || !['docx','xlsx','pptx'].includes(data.type)) return;
    const token = ++saveVersion.current;
    setEditError('');
    setSaving(true);
    try {
      const result = await api.editOfficeCopy(filePath, sourceSha, data.type === 'xlsx'
        ? { cells: Object.values(cellEdits) }
        : { find: findText, replace: replacement, expected_occurrences: occurrences,
          ...(data.type === 'pptx' ? { slide: slideNumber } : {}) });
      if (token === saveVersion.current) { setModified(false); setSavedCopy(result); }
      addNotification({ type: 'info', title: '修改副本已保存', message: result.path });
    } catch (e: unknown) {
      if (token === saveVersion.current) setEditError(e instanceof Error ? e.message : String(e));
      addNotification({ type: 'error', title: '副本未保存', message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (token === saveVersion.current) setSaving(false);
    }
  };

  const handleXlsxCellChange = (sheetIndex: number, rowIndex: number, colIndex: number, value: string) => {
    if (data?.type !== 'xlsx') return;
    const original = data.sheets[sheetIndex];
    if (!original) return;
    const cell = sheetCellAddress(original.range, rowIndex, colIndex), key = `${original.name}:${cell}`;
    setCellEdits(prev => { const next = {...prev}; if ((original.rows[rowIndex]?.[colIndex] ?? '') === value) delete next[key]; else next[key] = {sheet: original.name, cell, value}; return next; });
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

  const copyReceipt = <>{editError && <p role="alert" className="mb-2 text-sm text-amber-500">{editError}</p>}{savedCopy && <section role="status" className="mb-2 rounded border border-emerald-500/40 p-3 text-sm text-desktop-text">
    <p>上一次修改副本已保存，原文件已保留。</p><p className="break-all">{savedCopy.path}</p>
    <button type="button" className="mt-2 rounded bg-desktop-accent px-3 py-2 text-white" onClick={() => useDesktopStore.getState().openApp('office-viewer', {filePath: savedCopy.path, fileName: savedCopy.path.split('/').pop()})}>打开修改副本</button>
    {savedCopy.warnings.map((warning,index)=><p key={index} className="mt-2">{warning}</p>)}
  </section>}</>;

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
        <p>{error || '请从文件管理器中打开 PDF、Word、Excel 或演示稿'}</p>
      </div>
    );
  }

  if (data?.type === 'pdf') return <PdfTextPreview pages={data.pages} warnings={data.warnings} onDownload={() => {
    void api.downloadFile(filePath, fileName).catch(() => addNotification({ type: 'error', title: '下载失败', message: '请稍后重试' }));
  }}>
    <button type="button" disabled={ocrBusy || !sourceSha || data.pages.some(page => page.ocr)} aria-busy={ocrBusy}
      onClick={() => void recognizeScan()} className="min-h-11 rounded bg-desktop-accent px-4 py-2 text-white disabled:opacity-50">
      {ocrBusy ? '正在识别…' : data.pages.some(page => page.ocr) ? '扫描识别已完成' : '识别扫描文字'}
    </button>
    {ocrBusy && <><button type="button" onClick={() => {
      ocrController.current?.abort(); ocrController.current = null; setOcrBusy(false);
      setOcrMessage({ error: false, text: '已停止识别，原文件和已有文字均保留。' });
    }} className="min-h-11 rounded border border-white/20 px-4 py-2">停止识别</button><p role="status" className="basis-full text-sm">正在识别，原文件会保留。</p></>}
    {ocrMessage && <p role={ocrMessage.error ? 'alert' : 'status'} className="basis-full break-words text-sm">{ocrMessage.text}</p>}
  </PdfTextPreview>;
  if (data?.type === 'docx' || data?.type === 'pptx') {
    return (
      <div className="flex h-full flex-col overflow-auto bg-desktop-bg p-3">
        <p className="mb-2 text-sm text-desktop-text">修改会另存一份，原文件会保留。{data.type === 'pptx' ? '先选要修改的页面。' : ''}可替换普通段落和表格里的文字，跨样式文字沿用起始样式。</p>
        {copyReceipt}
        <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/15 pb-2">
          <strong className="text-desktop-text">替换文字</strong>
          <button
            onClick={handleSave}
            disabled={saving || !modified || !sourceSha || !findText || findText === replacement || !Number.isSafeInteger(occurrences) || occurrences < 1 || (data.type === 'pptx' && data.slides.length === 0)}
            className="flex items-center gap-1 rounded bg-desktop-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存修改副本
          </button>
        </div>
        <div className="mb-3 grid gap-2 text-sm text-desktop-text">
          {data.type === 'pptx' && <label>修改哪一页
            <select aria-label="修改哪一页" disabled={saving} value={slideNumber}
              onChange={event => { setSlideNumber(Number(event.target.value)); setModified(true); }}
              className="mt-1 w-full rounded border border-white/15 bg-desktop-window p-2">
              {data.slides.map((slide, index) => <option key={index} value={index + 1}>
                第 {index + 1} 页{slide.title ? ` · ${slide.title}` : ''}
              </option>)}
            </select>
          </label>}
          <label>原来的文字<input aria-label="原来的文字" disabled={saving} value={findText} onChange={event=>{setFindText(event.target.value);setModified(true);}} className="mt-1 w-full rounded border border-white/15 bg-desktop-window p-2"/></label>
          <label>改成什么<input aria-label="改成什么" disabled={saving} value={replacement} onChange={event=>{setReplacement(event.target.value);setModified(true);}} className="mt-1 w-full rounded border border-white/15 bg-desktop-window p-2"/></label>
          <label>预计修改几处<input aria-label="预计修改几处" disabled={saving} type="number" min={1} max={10000} value={occurrences} onChange={event=>{setOccurrences(event.target.valueAsNumber);setModified(true);}} className="ml-2 w-20 rounded border border-white/15 bg-desktop-window p-2"/></label>
        </div>
        {data.type === 'pptx'
          ? <PresentationText slides={data.slides} />
          : <textarea aria-label="原文预览" readOnly value={docxText} className="min-h-48 flex-1 resize-none rounded border border-white/15 bg-desktop-window p-3 text-sm text-desktop-text" />}
      </div>
    );
  }

  if (data?.type === 'xlsx') {
    const sheet = xlsxSheets[activeSheetIndex];
    const rows = sheet?.rows ?? [];
    const maxCols = Math.max(0, ...rows.map((r) => r.length));

    return (
      <div className="flex h-full flex-col bg-desktop-bg p-3">
        <p className="mb-2 text-sm text-desktop-text">修改会另存副本，保留原稿、样式和公式。公式格暂不直接修改；副本需用表格软件打开重算。</p>
        {copyReceipt}
        <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/15 pb-2">
          <div className="flex flex-wrap gap-1">
            {xlsxSheets.map((s, i) => (
              <button
                key={s.name}
                onClick={() => setActiveSheetIndex(i)}
                className={`rounded px-2 py-1 text-sm ${i === activeSheetIndex ? 'bg-desktop-accent text-white' : 'bg-desktop-window text-desktop-text'}`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !modified || !sourceSha || Object.keys(cellEdits).length === 0}
            className="flex items-center gap-1 rounded bg-desktop-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存修改副本
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded border border-white/15">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {Array.from({ length: Math.max(row.length, maxCols) }).map((_, colIndex) => (
                    <td key={colIndex} className="border border-white/15 p-0">
                      <input
                        type="text"
                        disabled={saving}
                        aria-label={`${sheet?.name ?? '工作表'} ${sheetCellAddress(data.sheets[activeSheetIndex]?.range, rowIndex, colIndex)}`}
                        value={row[colIndex] ?? ''}
                        onChange={(e) => handleXlsxCellChange(activeSheetIndex, rowIndex, colIndex, e.target.value)}
                        className="min-w-[4rem] border-0 bg-transparent px-1.5 py-0.5 text-desktop-text outline-none focus:bg-desktop-window"
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="border border-white/15 p-2 text-desktop-text/60">空表，可在首格输入后保存</td>
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
