import { useRef } from 'react';
import { Send, Square, Paperclip, ImagePlus, X } from 'lucide-react';

interface InputAreaProps {
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSendMessage: () => void;
  onStopGenerating: () => void;
  isLoading: boolean;
  attachedFiles: Array<{ name: string; file: File }>;
  onRemoveFile: (index: number) => void;
  attachedImages: string[];
  onRemoveImage: (index: number) => void;
  onAttachFile: () => void;
  onAttachImage: () => void;
  maxFiles?: number;
  maxImages?: number;
}

export function InputArea({
  input,
  onInputChange,
  onKeyDown,
  onSendMessage,
  onStopGenerating,
  isLoading,
  attachedFiles,
  onRemoveFile,
  attachedImages,
  onRemoveImage,
  onAttachFile,
  onAttachImage,
  maxFiles = 5,
  maxImages = 3,
}: InputAreaProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachFileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="shrink-0 px-3 py-2 border-t border-white/5 bg-white/[0.02]">
      <input
        ref={attachFileInputRef}
        type="file"
        accept=".txt,.md,.pdf,.doc,.docx,.csv,.json,.xlsx,.xls"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (!files?.length) return;
          const items: { name: string; file: File }[] = [];
          for (let i = 0; i < Math.min(files.length, maxFiles); i++) {
            const f = files[i]!;
            items.push({ name: f.name, file: f });
          }
          // Note: actual state update handled by parent via onAttachFile callback
          e.target.value = '';
        }}
      />
      <input
        ref={attachInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = e.target.files;
          if (!files?.length) return;
          const readAsDataUrl = (file: File) =>
            new Promise<string>((resolve) => {
              const r = new FileReader();
              r.onload = () => resolve((r.result as string) || '');
              r.onerror = () => resolve('');
              r.readAsDataURL(file);
            });
          const limit = Math.min(files.length, maxImages);
          const urls = await Promise.all(Array.from({ length: limit }, (_, i) => readAsDataUrl(files[i]!)));
          const valid = urls.filter((u) => u.startsWith('data:image/'));
          // Note: actual state update handled by parent via onAttachImage callback
          e.target.value = '';
        }}
      />
      {attachedFiles.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachedFiles.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/10 border border-white/10 text-[11px] text-desktop-text shrink-0"
            >
              <Paperclip size={12} className="text-desktop-muted shrink-0" />
              <span className="max-w-[120px] truncate" title={item.name}>
                {item.name}
              </span>
              <button
                type="button"
                className="p-0.5 rounded hover:bg-red-500/30 text-desktop-muted hover:text-red-400 transition-colors shrink-0"
                onClick={() => onRemoveFile(i)}
                aria-label="移除"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {attachedImages.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachedImages.map((url, i) => (
            <div key={i} className="relative w-12 h-12 rounded-lg overflow-hidden border border-white/10 bg-white/5 shrink-0">
              <img src={url} alt={`参考图 ${i + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                className="absolute top-0 right-0 p-0.5 rounded-bl bg-black/60 hover:bg-red-500/80 text-white transition-colors"
                onClick={() => onRemoveImage(i)}
                aria-label="移除"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1 sm:gap-2 bg-white/5 rounded-xl px-2 sm:px-3 py-2 border border-white/10 focus-within:border-desktop-highlight/30 transition-colors">
        <button
          type="button"
          className="p-2 sm:p-1 rounded-lg sm:rounded hover:bg-white/10 transition-colors shrink-0 mb-0.5 text-desktop-muted hover:text-desktop-text touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
          onClick={() => attachFileInputRef.current?.click()}
          title={attachedFiles.length >= maxFiles ? `最多 ${maxFiles} 个文件` : '附加文档（txt、md、pdf、doc、csv、json 等）'}
        >
          <Paperclip size={16} className="sm:size-4" />
        </button>
        <button
          type="button"
          className="p-2 sm:p-1 rounded-lg sm:rounded hover:bg-white/10 transition-colors shrink-0 mb-0.5 text-desktop-muted hover:text-desktop-text touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
          onClick={() => attachInputRef.current?.click()}
          title={attachedImages.length >= maxImages ? `最多 ${maxImages} 张参考图` : '上传参考图（1–3 张），将随消息发送供图像编辑使用'}
        >
          <ImagePlus size={16} className="sm:size-4" />
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          placeholder="输入消息或任务描述... (Shift+Enter 换行)"
          className="flex-1 bg-transparent outline-none text-sm sm:text-xs text-desktop-text resize-none max-h-[120px] min-h-[32px] sm:min-h-[24px] py-1.5 sm:py-0.5 placeholder:text-desktop-muted/50 leading-relaxed"
          rows={1}
        />
        {isLoading ? (
          <button
            className="p-2 sm:p-1.5 rounded-lg transition-all shrink-0 mb-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
            onClick={onStopGenerating}
            title="停止生成"
          >
            <Square size={14} className="sm:size-[13px]" />
          </button>
        ) : (
          <button
            className={`p-2 sm:p-1.5 rounded-lg transition-all shrink-0 mb-0.5 touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center ${
              input.trim() || attachedImages.length || attachedFiles.length
                ? 'bg-desktop-highlight hover:bg-desktop-highlight/80 text-white scale-100'
                : 'bg-white/5 text-desktop-muted scale-95'
            }`}
            onClick={onSendMessage}
            disabled={!input.trim() && !attachedImages.length && !attachedFiles.length}
          >
            <Send size={14} className="sm:size-[13px]" />
          </button>
        )}
      </div>
    </div>
  );
}
