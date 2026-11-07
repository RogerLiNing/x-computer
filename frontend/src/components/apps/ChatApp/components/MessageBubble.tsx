import { useTranslation } from 'react-i18next';
import { Bot, User, Copy, RotateCcw, Trash2, Download, FileText } from 'lucide-react';
import { ToolCallBlock, MarkdownContent, MultiRenderer, type ToolCallRecord } from '@/components/shared';
import { useConfigStore } from '@/store/configStore';

// Message interface duplicated from ChatApp.tsx to avoid circular dependency
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  taskId?: string;
  taskStatus?: string;
  toolCalls?: ToolCallRecord[];
  images?: string[];
  attachedFiles?: Array<{ name: string; path: string }>;
  suggestedFollowUps?: string[];
  quotaError?: boolean;
}

interface MessageBubbleProps {
  msg: Message;
  tasks: { id: string; status?: string }[];
  isLoading: boolean;
  isLastMessage: boolean;
  onCopyMessage: (msg: Message) => void;
  onRetryMessage: (msg: Message) => void;
  onDeleteMessage: (id: string) => void;
  onSetInput: (input: string) => void;
  onFocusInput: () => void;
  onOpenApp: (app: string) => void;
  onSetImagePreviewUrl: (url: string | null) => void;
  onSaveImage: (src: string, name: string) => Promise<string | null>;
  onAddNotification: (notification: { type: string; title: string; message: string }) => void;
}

export function MessageBubble({
  msg,
  tasks,
  isLoading,
  isLastMessage,
  onCopyMessage,
  onRetryMessage,
  onDeleteMessage,
  onSetInput,
  onFocusInput,
  onOpenApp,
  onSetImagePreviewUrl,
  onSaveImage,
  onAddNotification,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const renderMode = useConfigStore((s) => s.renderMode);

  return (
    <div className={`flex gap-2 sm:gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
      {msg.role !== 'user' && (
        <div className="w-8 sm:w-7 h-8 sm:h-7 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={14} className="text-[#C8A96E]" />
        </div>
      )}
      <div
        className={`max-w-[90%] sm:max-w-[85%] rounded-xl px-2 sm:px-3 py-2 sm:py-2.5 text-xs leading-relaxed ${
          msg.role === 'user'
            ? 'bg-[#C8A96E]/20 text-gray-200'
            : msg.role === 'system'
              ? 'bg-amber-500/30 text-gray-400'
              : 'bg-white/5 text-gray-200/90'
        }`}
      >
        {/* 工具调用列表：可展开查看详情 */}
        {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="space-y-1">
            {msg.toolCalls.map((tc) => (
              <ToolCallBlock key={tc.id} tc={tc} />
            ))}
          </div>
        )}
        {(msg.content || (msg.role === 'assistant' && isLoading && isLastMessage)) && (
          <div className={msg.toolCalls?.length ? 'mt-2' : ''}>
            {(msg.role === 'assistant' || msg.role === 'system') ? (
              renderMode === 'markdown' ? (
                <div className="chat-markdown text-xs text-gray-200/90 leading-relaxed [&_p]:my-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_li]:block [&_li]:my-0.5 [&_li]:leading-relaxed [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-white/10 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_strong]:font-semibold [&_a]:text-[#C8A96E] [&_a]:underline [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-white/20 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-white/20 [&_td]:px-2 [&_td]:py-1">
                  <MarkdownContent content={msg.content} />
                </div>
              ) : (
                <div className="text-xs text-gray-200/90">
                  <MultiRenderer content={msg.content} mode={renderMode} />
                </div>
              )
            ) : (
              <span className="whitespace-pre-wrap">{msg.content}</span>
            )}
            {msg.quotaError && (
              <div className="mt-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg bg-amber-500/40 hover:bg-amber-500/60 text-gray-200 text-[11px] font-medium transition-colors"
                  onClick={() => onOpenApp('subscription')}
                >
                  {t('errors.quotaUpgradeLink')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 用户附带图片 / 助手生成图：用户为沙箱路径用 API 加载，助手为 URL */}
        {msg.images && msg.images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.images.map((srcOrPath, i) => {
              const imgSrc =
                msg.role === 'user' && !srcOrPath.startsWith('data:') && !srcOrPath.startsWith('http')
                  ? `/api/fs/read-binary?path=${encodeURIComponent(srcOrPath)}`
                  : srcOrPath;
              return (
              <div key={i} className="rounded-lg border border-white/10 overflow-hidden max-w-[200px] bg-white/5">
                <button
                  type="button"
                  className="w-full max-h-[180px] block focus:outline-none focus:ring-2 focus:ring-amber-400/50 rounded-t-lg overflow-hidden"
                  onClick={() => onSetImagePreviewUrl(imgSrc)}
                >
                  <img src={imgSrc} alt={msg.role === 'user' ? `附带图片 ${i + 1}` : `生成图 ${i + 1}`} className="w-full h-full object-cover block" />
                </button>
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors"
                  onClick={async () => {
                    const path = await onSaveImage(imgSrc, `生成图-${i + 1}.png`);
                    if (path) onAddNotification({ type: 'info', title: '已保存到沙箱', message: path });
                    else onAddNotification({ type: 'error', title: '保存失败', message: '请重试' });
                  }}
                  title="保存到沙箱"
                >
                  <Download size={12} />
                  保存
                </button>
              </div>
              );
            })}
          </div>
        )}

        {/* 用户附带文档：在对话中单独展示 */}
        {msg.role === 'user' && msg.attachedFiles && msg.attachedFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {msg.attachedFiles.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 text-[10px] text-gray-400"
                title={f.path}
              >
                <FileText size={12} />
                {f.name}
              </span>
            ))}
          </div>
        )}



        <div className="flex items-center justify-end gap-0.5 mt-1.5">
          <span className="text-[9px] text-gray-400/40 mr-1">
            {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            type="button"
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
            onClick={() => onCopyMessage(msg)}
            title="复制"
            disabled={!msg.content}
          >
            <Copy size={10} />
          </button>
          {msg.role === 'assistant' && (
            <button
              type="button"
              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
              onClick={() => onRetryMessage(msg)}
              title="重试"
              disabled={isLoading}
            >
              <RotateCcw size={10} />
            </button>
          )}
          {msg.id !== 'welcome' && (
            <button
              type="button"
              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors"
              onClick={() => onDeleteMessage(msg.id)}
              title="删除"
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
        {msg.role === 'assistant' && msg.suggestedFollowUps && msg.suggestedFollowUps.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {msg.suggestedFollowUps.map((q, i) => (
              <button
                key={i}
                type="button"
                className="px-2.5 py-1 rounded-lg text-[10px] bg-white/10 hover:bg-white/20 text-gray-200/90 hover:text-gray-200 border border-white/10 transition-colors text-left max-w-full truncate"
                title={q}
                onClick={() => {
                  onSetInput(q);
                  onFocusInput();
                }}
              >
                {q.length > 40 ? q.slice(0, 39) + '…' : q}
              </button>
            ))}
          </div>
        )}
      </div>
      {msg.role === 'user' && (
        <div className="w-8 sm:w-7 h-8 sm:h-7 rounded-full bg-[#161616] flex items-center justify-center shrink-0 mt-0.5">
          <User size={14} className="text-gray-400" />
        </div>
      )}
    </div>
  );
}
