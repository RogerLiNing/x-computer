import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Lock, ExternalLink } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';

interface Props {
  windowId: string;
  metadata?: Record<string, unknown>;
}

const BOOKMARKS = [
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'MDN', url: 'https://developer.mozilla.org' },
  { name: 'Bing', url: 'https://www.bing.com' },
];

/** 禁止 iframe 嵌入的站点（X-Frame-Options / CSP frame-ancestors），显示提示而非空白 */
const FRAME_BLOCKED_HOSTS = [
  'github.com', 'github.io', 'gitlab.com',
  'google.com', 'google.com.hk', 'google.co.jp', 'google.co.uk',
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
  'linkedin.com', 'youtube.com', 'paypal.com',
];

function isFrameBlocked(u: string): boolean {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return FRAME_BLOCKED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

function isValidHttpUrl(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://');
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'https://www.google.com';
  if (isValidHttpUrl(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

export function BrowserApp({ windowId, metadata }: Props) {
  const initialUrl = (metadata?.url as string) || 'https://www.google.com';
  const safeInitial = isValidHttpUrl(initialUrl) ? initialUrl : normalizeUrl(initialUrl);

  const [url, setUrl] = useState(safeInitial);
  const [inputUrl, setInputUrl] = useState(url);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<string[]>([url]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const navigate = useCallback(
    (newUrl: string) => {
      const formatted = normalizeUrl(newUrl);
      setUrl(formatted);
      setInputUrl(formatted);
      setLoading(true);
      setHistory((h) => [...h.slice(0, historyIndex + 1), formatted]);
      setHistoryIndex((i) => i + 1);
    },
    [historyIndex],
  );

  const goBack = () => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      const target = history[newIdx];
      setUrl(target);
      setInputUrl(target);
      setLoading(true);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      const target = history[newIdx];
      setUrl(target);
      setInputUrl(target);
      setLoading(true);
    }
  };

  const handleIframeLoad = () => {
    setLoading(false);
  };

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const store = useDesktopStore.getState();
    store.sendWs?.({ type: 'subscribe_app', data: { appId: 'browser' } });
    const unsub = store.subscribeAppChannel('browser', (message: unknown) => {
      const msg = message as { action?: string; url?: string };
      if (msg?.action === 'navigate' && typeof msg.url === 'string') {
        navigateRef.current(msg.url);
      }
    });
    return () => {
      unsub();
      useDesktopStore.getState().sendWs?.({ type: 'unsubscribe_app', data: { appId: 'browser' } });
    };
  }, []);

  const handleOpenInNewTab = () => {
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="h-full flex flex-col text-sm min-h-0">
      {/* Navigation bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/5 bg-white/[0.02] shrink-0">
        <button onClick={goBack} className="p-1.5 rounded hover:bg-white/10 transition-colors" disabled={historyIndex <= 0}>
          <ArrowLeft size={14} className={historyIndex <= 0 ? 'text-desktop-muted/30' : 'text-desktop-muted'} />
        </button>
        <button onClick={goForward} className="p-1.5 rounded hover:bg-white/10 transition-colors" disabled={historyIndex >= history.length - 1}>
          <ArrowRight size={14} className={historyIndex >= history.length - 1 ? 'text-desktop-muted/30' : 'text-desktop-muted'} />
        </button>
        <button onClick={() => navigate(url)} className="p-1.5 rounded hover:bg-white/10 transition-colors" disabled={loading}>
          <RotateCw size={14} className={`text-desktop-muted ${loading ? 'animate-spin' : ''}`} />
        </button>

        {/* URL bar */}
        <div className="flex-1 min-w-0 flex items-center bg-white/5 rounded-lg px-3 py-1.5 border border-white/10 focus-within:border-desktop-highlight/40 transition-colors">
          <Lock size={11} className="text-green-400/60 mr-2 shrink-0" />
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(inputUrl)}
            className="flex-1 min-w-0 bg-transparent outline-none text-xs text-desktop-text"
            spellCheck={false}
          />
        </div>

        <button
          onClick={handleOpenInNewTab}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          title="在新标签页中打开"
        >
          <ExternalLink size={14} className="text-desktop-muted" />
        </button>
      </div>

      {/* Bookmarks bar */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-white/5 bg-white/[0.01] shrink-0 flex-wrap">
        {BOOKMARKS.map((bm) => (
          <button
            key={bm.name}
            className="text-[11px] text-desktop-muted hover:text-desktop-text px-2 py-0.5 rounded hover:bg-white/5 transition-colors"
            onClick={() => navigate(bm.url)}
          >
            {bm.name}
          </button>
        ))}
      </div>

      {/* Content area - real iframe */}
      <div className="flex-1 min-h-0 bg-white/[0.02] relative">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/20 z-10">
            <RotateCw size={24} className="text-desktop-highlight animate-spin" />
            <span className="text-xs text-desktop-muted">加载中...</span>
          </div>
        )}
        <iframe
          key={url}
          src={url}
          title="Web page"
          className="w-full h-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}
