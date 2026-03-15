import { useState, useEffect, useCallback } from 'react';
import { Save, Play, FileCode, Bot, Undo, Redo, Plus, X, Loader2 } from 'lucide-react';
import { api } from '@/utils/api';
import { useDesktopStore } from '@/store/desktopStore';

interface Tab {
  id: string;
  name: string;
  path: string;
  content: string;
  modified: boolean;
  language: string;
}

const SAMPLE_CODE = `// X-Computer 代码编辑器
// 通过文件管理器打开文件，或在此处直接编辑

import { createTask } from '@x-computer/orchestrator';

async function main() {
  const task = await createTask({
    domain: 'coding',
    title: '自动生成 API 端点',
    description: '根据数据模型自动生成 REST API',
  });

  for (const step of task.steps) {
    console.log(\`执行: \${step.action}\`);
  }
}

main();
`;

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript/React', js: 'JavaScript', jsx: 'JavaScript/React',
    py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', c: 'C', cpp: 'C++',
    md: 'Markdown', json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
    html: 'HTML', css: 'CSS', scss: 'SCSS', sql: 'SQL', sh: 'Shell',
    txt: 'Text',
  };
  return map[ext] || 'Text';
}

interface Props {
  windowId: string;
  metadata?: Record<string, unknown>;
}

export function CodeEditorApp({ windowId, metadata }: Props) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { addNotification, setWindowTitle } = useDesktopStore();

  // Load file from metadata (opened from file manager)
  useEffect(() => {
    if (metadata?.filePath) {
      loadFile(metadata.filePath as string, metadata.fileName as string);
    } else if (tabs.length === 0) {
      // Create a default tab
      const tab: Tab = {
        id: 'default',
        name: 'main.ts',
        path: '/项目/main.ts',
        content: SAMPLE_CODE,
        modified: false,
        language: 'TypeScript',
      };
      setTabs([tab]);
      setActiveTabId(tab.id);
    }
  }, []);

  const loadFile = useCallback(async (filePath: string, fileName?: string) => {
    // Check if already open
    const existing = tabs.find((t) => t.path === filePath);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    setLoading(true);
    try {
      const result = await api.readFile(filePath);
      const name = fileName || filePath.split('/').pop() || 'untitled';
      const tab: Tab = {
        id: `tab-${Date.now()}`,
        name,
        path: filePath,
        content: result.content,
        modified: false,
        language: detectLanguage(name),
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      setWindowTitle(windowId, `代码编辑器 — ${name}`);
    } catch (err: any) {
      addNotification({ type: 'error', title: '打开失败', message: err.message });
    } finally {
      setLoading(false);
    }
  }, [tabs, windowId, addNotification, setWindowTitle]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleContentChange = (content: string) => {
    if (!activeTabId) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, content, modified: true } : t)),
    );
  };

  const handleSave = async () => {
    if (!activeTab) return;
    try {
      await api.writeFile(activeTab.path, activeTab.content);
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, modified: false } : t)),
      );
      addNotification({ type: 'info', title: '已保存', message: activeTab.name });
    } catch (err: any) {
      addNotification({ type: 'error', title: '保存失败', message: err.message });
    }
  };

  const closeTab = (tabId: string) => {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId);
      if (tabId === activeTabId && remaining.length > 0) {
        setActiveTabId(remaining[remaining.length - 1].id);
      } else if (remaining.length === 0) {
        setActiveTabId(null);
      }
      return remaining;
    });
  };

  const lineNumbers = activeTab ? activeTab.content.split('\n').map((_, i) => i + 1) : [];

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-white/5 bg-white/[0.02]">
        {/* Tabs */}
        <div className="flex items-center gap-0.5 flex-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-t text-xs cursor-pointer transition-colors group shrink-0 ${
                tab.id === activeTabId
                  ? 'bg-[#0d0d1a] text-desktop-text'
                  : 'text-desktop-muted hover:text-desktop-text hover:bg-white/5'
              }`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <FileCode size={11} className="shrink-0" />
              <span className="truncate max-w-[120px]">
                {tab.name}
                {tab.modified && <span className="text-desktop-highlight ml-0.5">●</span>}
              </span>
              <button
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 transition-all"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="AI 优化"
            onClick={() => addNotification({ type: 'info', title: 'AI 代码助手', message: '正在分析代码...' })}
          >
            <Bot size={14} className="text-blue-400" />
          </button>
          <button
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="保存 (⌘S)"
            onClick={handleSave}
          >
            <Save size={14} className="text-desktop-muted" />
          </button>
          <button
            className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs transition-colors"
            onClick={() => addNotification({ type: 'info', title: '运行', message: '在沙箱中运行...' })}
          >
            <Play size={11} />
            运行
          </button>
        </div>
      </div>

      {/* Editor area */}
      {activeTab ? (
        <div className="flex-1 flex overflow-hidden bg-[#0d0d1a]">
          {/* Line numbers */}
          <div className="py-3 px-1 text-right select-none shrink-0 border-r border-white/5 overflow-hidden">
            {lineNumbers.map((num) => (
              <div key={num} className="text-[11px] leading-[20px] text-desktop-muted/20 font-mono px-1.5">
                {num}
              </div>
            ))}
          </div>

          {/* Code content */}
          <textarea
            value={activeTab.content}
            onChange={(e) => handleContentChange(e.target.value)}
            onKeyDown={(e) => {
              // Tab key inserts spaces
              if (e.key === 'Tab') {
                e.preventDefault();
                const start = e.currentTarget.selectionStart;
                const end = e.currentTarget.selectionEnd;
                const value = activeTab.content;
                handleContentChange(value.substring(0, start) + '  ' + value.substring(end));
                setTimeout(() => {
                  e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2;
                }, 0);
              }
              // Cmd+S to save
              if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                e.stopPropagation();
                handleSave();
              }
            }}
            className="flex-1 bg-transparent outline-none text-[13px] text-desktop-text/90 font-mono leading-[20px] p-3 resize-none"
            spellCheck={false}
            wrap="off"
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[#0d0d1a] text-desktop-muted text-xs">
          {loading ? (
            <Loader2 className="animate-spin" size={20} />
          ) : (
            <div className="text-center">
              <FileCode size={32} className="mx-auto mb-2 text-desktop-accent" />
              <p>打开一个文件开始编辑</p>
            </div>
          )}
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 py-1 border-t border-white/5 text-[11px] text-desktop-muted bg-[#0a0a15]">
        {activeTab && (
          <>
            <span>{activeTab.language}</span>
            <span>UTF-8</span>
            <span>{activeTab.content.split('\n').length} 行</span>
            <span className="ml-auto">{activeTab.path}</span>
            <span>沙箱: 容器</span>
          </>
        )}
      </div>
    </div>
  );
}
