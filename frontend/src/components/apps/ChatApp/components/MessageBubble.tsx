import { useTranslation } from 'react-i18next';
import { Bot, User, Clock, CheckCircle2, XCircle, ArrowRight, Copy, RotateCcw, Trash2, Download, FileText, Loader2 } from 'lucide-react';
import { ToolCallBlock, MarkdownContent, type ToolCallRecord } from '@/components/shared';

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

interface Task {
  id: string;
  status?: string;
}

interface MessageBubbleProps {
  msg: Message;
  tasks: Task[];
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

  return (
    <div className={`flex gap-2 sm:gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
      {msg.role !== 'user' && (
        <div className="w-8 sm:w-7 h-8 sm:h-7 rounded-full bg-desktop-accent flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={14} className="text-desktop-highlight" />
        </div>
      )}
      <div
        className={`max-w-[90%] sm:max-w-[85%] rounded-xl px-2 sm:px-3 py-2 sm:py-2.5 text-xs leading-relaxed ${
          msg.role === 'user'
            ? 'bg-desktop-highlight/20 text-desktop-text'
            : msg.role === 'system'
              ? 'bg-desktop-accent/30 text-desktop-muted'
              : 'bg-white/5 text-desktop-text/90'
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
              <div className="chat-markdown text-xs text-desktop-text/90 leading-relaxed [&_p]:my-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_li]:block [&_li]:my-0.5 [&_li]:leading-relaxed [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-white/10 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_strong]:font-semibold [&_a]:text-desktop-highlight [&_a]:underline [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-white/20 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-white/20 [&_td]:px-2 [&_td]:py-1">
                <MarkdownContent content={msg.content} />
              </div>
            ) : (
              <span className="whitespace-pre-wrap">{msg.content}</span>
            )}
            {msg.quotaError && (
              <div className="mt-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg bg-desktop-accent/40 hover:bg-desktop-accent/60 text-desktop-text text-[11px] font-medium transition-colors"
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
                  className="w-full max-h-[180px] block focus:outline-none focus:ring-2 focus:ring-desktop-accent/50 rounded-t-lg overflow-hidden"
                  onClick={() => onSetImagePreviewUrl(imgSrc)}
                >
                  <img src={imgSrc} alt={msg.role === 'user' ? `附带图片 ${i + 1}` : `生成图 ${i + 1}`} className="w-full h-full object-cover block" />
                </button>
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-desktop-muted hover:text-desktop-text hover:bg-white/10 transition-colors"
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
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 text-[10px] text-desktop-muted"
                title={f.path}
              >
                <FileText size={12} />
                {f.name}
              </span>
            ))}
          </div>
        )}

        {/* Task link：状态以桌面 store 为准，任务完成后 WebSocket 会更新 store，此处自动从旋转变为已完成 */}
        {msg.taskId && (() => {
          const task = tasks.find((t) => t.id === msg.taskId);
          const displayStatus = task?.status ?? msg.taskStatus;
          return (
            <button
              className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-desktop-accent/30 hover:bg-desktop-accent/50 text-[10px] text-desktop-muted hover:text-desktop-text transition-colors"
              onClick={() => onOpenApp('task-timeline')}
            >
              {displayStatus === 'awaiting_approval' ? (
                <Clock size={10} className="text-yellow-400" />
              ) : displayStatus === 'completed' ? (
                <CheckCircle2 size={10} className="text-green-400" />
              ) : displayStatus === 'failed' ? (
                <XCircle size={10} className="text-red-400" />
              ) : (
                <Loader2 size={10} className="text-blue-400 animate-spin" />
              )}
              {displayStatus === 'completed' ? '任务已完成 · 查看详情' : displayStatus === 'failed' ? '任务失败 · 查看详情' : '查看任务详情'}
              <ArrowRight size={10} />
            </button>
          );
        })()}

        <div className="flex items-center justify-end gap-0.5 mt-1.5">
          <span className="text-[9px] text-desktop-muted/40 mr-1">
            {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            type="button"
            className="p-1 rounded hover:bg-white/10 text-desktop-muted hover:text-desktop-text transition-colors"
            onClick={() => onCopyMessage(msg)}
            title="复制"
            disabled={!msg.content}
          >
            <Copy size={10} />
          </button>
          {msg.role === 'assistant' && (
            <button
              type="button"
              className="p-1 rounded hover:bg-white/10 text-desktop-muted hover:text-desktop-text transition-colors"
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
              className="p-1 rounded hover:bg-white/10 text-desktop-muted hover:text-red-400 transition-colors"
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
                className="px-2.5 py-1 rounded-lg text-[10px] bg-white/10 hover:bg-white/20 text-desktop-text/90 hover:text-desktop-text border border-white/10 transition-colors text-left max-w-full truncate"
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
        <div className="w-8 sm:w-7 h-8 sm:h-7 rounded-full bg-desktop-surface flex items-center justify-center shrink-0 mt-0.5">
          <User size={14} className="text-desktop-muted" />
        </div>
      )}
    </div>
  );
}
