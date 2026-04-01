import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { MarkdownContent } from './MarkdownContent';

interface MarkdownWithThinkProps {
  content: string;
}

/** 从内容中提取 <think>...</think> 块 */
function extractThinkBlocks(
  content: string,
): { think: string[]; rest: string } {
  const thinkBlocks: string[] = [];
  const rest = content.replace(/<think>[\s\S]*?<\/think>/gi, (match) => {
    // 提取 think 标签内的内容（去掉标签本身）
    const inner = match.replace(/<\/?think>/gi, '').trim();
    if (inner) thinkBlocks.push(inner);
    return '';
  });
  return { think: thinkBlocks, rest: rest.trim() };
}

export function MarkdownWithThink({ content }: MarkdownWithThinkProps) {
  const { think: thinkBlocks, rest } = extractThinkBlocks(content);
  const [expanded, setExpanded] = useState(false);

  if (thinkBlocks.length === 0) {
    return <MarkdownContent content={content} />;
  }

  return (
    <div className="space-y-2">
      {/* 思考内容折叠区 */}
      {thinkBlocks.length > 0 && (
        <div className="border border-desktop-accent/30 rounded-lg overflow-hidden bg-desktop-accent/5">
          <button
            type="button"
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-desktop-accent hover:bg-desktop-accent/10 transition-colors"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            <Sparkles size={11} />
            <span>思考过程 ({thinkBlocks.length})</span>
          </button>
          {expanded && (
            <div className="px-2 pb-2 space-y-1.5">
              {thinkBlocks.map((block, i) => (
                <div
                  key={i}
                  className="text-[11px] text-desktop-muted leading-relaxed whitespace-pre-wrap"
                >
                  {block}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* 主要内容 */}
      {rest && <MarkdownContent content={rest} />}
    </div>
  );
}
