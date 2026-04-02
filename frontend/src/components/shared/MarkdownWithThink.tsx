import { useState, useMemo } from 'react';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownWithThinkProps {
  content: string;
}

/** 将 <think>...</think> 转换为自定义 HTML 标记 */
function preprocessThinkBlocks(content: string): { thinkBlocks: string[]; mainContent: string } {
  const thinkBlocks: string[] = [];

  const mainContent = content.replace(
    /<think>([\s\S]*?)<\/think>/gi,
    (_, inner) => {
      const trimmed = inner.trim();
      if (trimmed) thinkBlocks.push(trimmed);
      return '';
    },
  );

  return { thinkBlocks, mainContent: mainContent.trim() };
}

function ThinkBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-desktop-accent/30 rounded-lg overflow-hidden bg-desktop-accent/5 my-2">
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-desktop-accent hover:bg-desktop-accent/10 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Sparkles size={11} />
        <span>思考过程</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-[11px] text-desktop-muted leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

export function MarkdownWithThink({ content }: MarkdownWithThinkProps) {
  const { thinkBlocks, mainContent } = useMemo(() => preprocessThinkBlocks(content), [content]);

  if (thinkBlocks.length === 0) {
    return (
      <div className="text-sm text-desktop-text/90 leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="text-sm text-desktop-text/90 leading-relaxed space-y-2">
      {/* 思考内容 */}
      {thinkBlocks.map((block, i) => (
        <ThinkBlock key={i} content={block} />
      ))}
      {/* 主要内容 */}
      {mainContent && (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{mainContent}</ReactMarkdown>
      )}
    </div>
  );
}
