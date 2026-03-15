import { useState, useEffect, useRef } from 'react';
import { Image as ImageIcon, AlertCircle } from 'lucide-react';
import { getUserId } from '@/utils/userId';

interface Props {
  windowId: string;
  metadata?: Record<string, unknown>;
}

/** 图片查看器：通过 metadata.filePath 加载沙箱中的图片并显示（需带 X-User-Id 以走用户沙箱） */
export function ImageViewerApp({ metadata }: Props) {
  const filePath = metadata?.filePath as string | undefined;
  const fileName = (metadata?.fileName as string) || '图片';
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setError(null);
    setLoaded(false);
    if (!filePath) {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setObjectUrl(null);
      return;
    }
    const pathForThisEffect = filePath;
    const url = `/api/fs/read-binary?path=${encodeURIComponent(pathForThisEffect)}`;
    const headers: Record<string, string> = { 'X-User-Id': getUserId() };
    fetch(url, { method: 'GET', headers })
      .then((res) => {
        if (!res.ok) return res.json().then((body) => Promise.reject(new Error(body?.error || res.statusText)));
        return res.blob();
      })
      .then((blob) => {
        if (pathForThisEffect !== filePath) {
          URL.revokeObjectURL(URL.createObjectURL(blob));
          return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const next = URL.createObjectURL(blob);
        objectUrlRef.current = next;
        setObjectUrl(next);
        setError(null);
      })
      .catch((e) => {
        if (pathForThisEffect !== filePath) return;
        setError(e instanceof Error ? e.message : '无法加载图片');
        setObjectUrl(null);
      });
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [filePath]);

  const src = objectUrl ?? '';

  if (!filePath) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-desktop-muted">
        <ImageIcon size={48} className="opacity-50" />
        <p className="text-sm">未指定文件路径</p>
        <p className="text-xs">从文件管理器中双击图片打开</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-black/30">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 text-xs text-desktop-muted shrink-0">
        <ImageIcon size={14} />
        <span className="truncate">{fileName}</span>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-auto">
        {error ? (
          <div className="flex flex-col items-center gap-2 text-red-400/90">
            <AlertCircle size={32} />
            <p className="text-sm">{error}</p>
          </div>
        ) : !src ? (
          <div className="text-desktop-muted text-sm">加载中...</div>
        ) : (
          <img
            src={src}
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded"
            onLoad={() => {
              setLoaded(true);
              setError(null);
            }}
            onError={() => setError('无法加载图片')}
            style={{ visibility: loaded ? 'visible' : 'hidden' }}
          />
        )}
      </div>
    </div>
  );
}
