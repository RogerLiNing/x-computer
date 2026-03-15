import { useState, useEffect } from 'react';
import { Save, Bold, Italic, Underline, AlignLeft, List, Bot, Type, Loader2 } from 'lucide-react';
import { api } from '@/utils/api';
import { useDesktopStore } from '@/store/desktopStore';
import { useAiDocumentStore } from '@/store/aiDocumentStore';

const DEFAULT_TEXT = `# 欢迎使用 X-Computer 文本编辑器

你可以在这里编写文档、笔记、和任何文本内容。

## 功能

- 基础文本编辑
- 文件保存到沙箱文件系统
- AI 辅助润色和改写

## 使用方式

1. 从文件管理器双击打开文件
2. 或直接在此编辑
3. 使用 ⌘S 保存

---

*由 X-Computer AI 自主电脑系统提供*
`;

interface Props {
  windowId: string;
  metadata?: Record<string, unknown>;
}

export function TextEditorApp({ windowId, metadata }: Props) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('未命名.md');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [modified, setModified] = useState(false);
  const [loading, setLoading] = useState(false);
  const { addNotification, setWindowTitle, setWindowMetadata } = useDesktopStore();
  const isAiDocument = metadata?.aiDocument === true;
  const suggestedPath = (metadata?.suggestedPath as string) ?? '文档/未命名.txt';
  const aiState = useAiDocumentStore((s) => (isAiDocument ? s.byWindowId[windowId] : undefined));
  const aiContent = aiState?.content ?? '';
  const aiStreaming = aiState?.isStreaming ?? false;

  // AI 文档模式：从 store 同步内容到本地（可编辑），并同步标题；受主 AI 驱动的「编辑器助手」实时输出
  useEffect(() => {
    if (isAiDocument) {
      const name = suggestedPath.split('/').pop() || suggestedPath;
      setTitle(name);
      setWindowTitle(windowId, aiStreaming ? `文本编辑器 — ${name} (编辑器助手生成中)` : `文本编辑器 — ${name} ●`);
    }
  }, [isAiDocument, suggestedPath, aiStreaming, windowId, setWindowTitle]);

  // 非 AI 文档：从 metadata 加载文件或默认内容
  useEffect(() => {
    if (isAiDocument) return;
    if (metadata?.filePath) {
      loadFile(metadata.filePath as string, metadata.fileName as string);
    } else {
      setText(DEFAULT_TEXT);
    }
  }, []);

  const loadFile = async (path: string, name?: string) => {
    setLoading(true);
    try {
      const result = await api.readFile(path);
      setText(result.content);
      setFilePath(path);
      const fileName = name || path.split('/').pop() || 'untitled';
      setTitle(fileName);
      setWindowTitle(windowId, `文本编辑器 — ${fileName}`);
      setModified(false);
    } catch (err: any) {
      addNotification({ type: 'error', title: '打开失败', message: err.message });
      setText(DEFAULT_TEXT);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const path = isAiDocument ? suggestedPath : (filePath || `/${title}`);
    const contentToSave = isAiDocument ? aiContent : text;
    try {
      await api.writeFile(path, contentToSave);
      if (isAiDocument) {
        const fileName = suggestedPath.split('/').pop() || suggestedPath;
        setFilePath(suggestedPath);
        setText(aiContent);
        setWindowMetadata(windowId, { filePath: suggestedPath, fileName });
        useAiDocumentStore.getState().remove(windowId);
        setWindowTitle(windowId, `文本编辑器 — ${fileName}`);
      } else {
        setFilePath(path);
        setModified(false);
      }
      addNotification({ type: 'info', title: '已保存', message: (path.split('/').pop() || path) });
    } catch (err: any) {
      addNotification({ type: 'error', title: '保存失败', message: err.message });
    }
  };

  const handleChange = (value: string) => {
    if (isAiDocument) {
      useAiDocumentStore.getState().setContent(windowId, value);
    } else {
      setText(value);
      setModified(true);
    }
  };

  const displayValue = isAiDocument ? aiContent : text;

  const pathForStatus = isAiDocument ? suggestedPath : filePath;

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/5 bg-white/[0.02]">
        <button className="p-1.5 rounded hover:bg-white/10 transition-colors"><Bold size={14} className="text-desktop-muted" /></button>
        <button className="p-1.5 rounded hover:bg-white/10 transition-colors"><Italic size={14} className="text-desktop-muted" /></button>
        <button className="p-1.5 rounded hover:bg-white/10 transition-colors"><Underline size={14} className="text-desktop-muted" /></button>
        <div className="w-px h-5 bg-white/10 mx-1" />
        <button className="p-1.5 rounded hover:bg-white/10 transition-colors"><AlignLeft size={14} className="text-desktop-muted" /></button>
        <button className="p-1.5 rounded hover:bg-white/10 transition-colors"><List size={14} className="text-desktop-muted" /></button>
        <div className="flex-1" />

        {/* Title */}
        <span className="text-xs text-desktop-muted/60 mx-2">
          {title}{(isAiDocument ? aiContent.length > 0 : modified) && <span className="text-desktop-highlight ml-1">●</span>}
        </span>

        {isAiDocument && (
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-desktop-accent/20 text-desktop-muted text-[10px]"
            title="本窗口由主 AI 对话驱动，编辑器助手可实时输出内容"
          >
            <Bot size={10} />
            {aiStreaming ? '助手输出中…' : '编辑器助手'}
          </span>
        )}

        <button
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-500/20 text-blue-400 text-xs transition-colors"
          onClick={() => {
            addNotification({ type: 'info', title: 'AI 写作助手', message: '正在润色文档...' });
          }}
        >
          <Bot size={12} />
          AI 润色
        </button>
        <button
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          onClick={handleSave}
          title="保存 (⌘S)"
        >
          <Save size={14} className="text-desktop-muted" />
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="text-desktop-highlight animate-spin" />
          </div>
        ) : (
          <textarea
            value={displayValue}
            onChange={(e) => handleChange(e.target.value)}
            readOnly={isAiDocument && aiStreaming}
            placeholder={isAiDocument && aiStreaming ? '编辑器助手正在实时输出…' : undefined}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                e.stopPropagation();
                handleSave();
              }
            }}
            className="w-full h-full bg-transparent outline-none text-sm text-desktop-text/90 leading-relaxed p-6 resize-none"
            spellCheck={false}
          />
        )}
      </div>

      {/* Status */}
      {pathForStatus && (
        <div className="flex items-center gap-3 px-3 py-1 border-t border-white/5 text-[11px] text-desktop-muted">
          <Type size={11} />
          <span className="font-mono">{pathForStatus}</span>
        </div>
      )}
    </div>
  );
}
