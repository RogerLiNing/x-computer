import { useState, useMemo } from 'react';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

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
    <div className="border border-white/10 rounded-lg overflow-hidden bg-white/5 my-2">
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-desktop-text/90 hover:bg-white/5 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? <ChevronDown size={12} className="text-desktop-muted" /> : <ChevronRight size={12} className="text-desktop-muted" />}
        <Sparkles size={11} className="text-desktop-highlight/90" />
        <span>思考过程</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-[11px] text-desktop-text/80 leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

const markdownComponents: Components = {
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || '');
    const isInline = !match;
    const codeString = String(children).replace(/\n$/, '');
    if (isInline) {
      return (
        <code
          {...props}
          className="px-1 py-0.5 rounded bg-white/10 text-desktop-accent text-xs font-mono"
        >
          {children}
        </code>
      );
    }
    return (
      <div className="relative group mt-2 rounded-lg overflow-hidden border border-white/10">
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button
            type="button"
            className="px-2 py-1 rounded text-[10px] bg-white/10 hover:bg-white/20 text-desktop-muted transition-colors"
            onClick={() => navigator.clipboard.writeText(codeString)}
            title="复制代码"
          >
            复制
          </button>
        </div>
        <SyntaxHighlighter
          style={oneDark as any}
          language={match[1] || 'text'}
          PreTag="div"
          customStyle={{ margin: 0, padding: '0.75rem', background: 'transparent', fontSize: '11px' }}
          codeTagProps={{ style: { fontFamily: 'ui-monospace, monospace' } }}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    );
  },
  a: ({ href, children, ...p }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-desktop-highlight hover:underline" {...p}>{children}</a>
  ),
  p: (p) => <p {...p} className="my-2" />,
  ul: (p) => <ul {...p} className="list-disc list-inside space-y-1 my-2" />,
  ol: (p) => <ol {...p} className="list-decimal list-inside space-y-1 my-2" />,
  blockquote: (p) => <blockquote {...p} className="border-l-2 border-desktop-accent/50 pl-3 my-2 text-desktop-muted italic" />,
  table: (p) => <div className="overflow-x-auto my-2"><table {...p} className="min-w-full border-collapse text-xs" /></div>,
  th: (p) => <th {...p} className="border border-white/10 px-2 py-1 bg-white/5 text-left" />,
  td: (p) => <td {...p} className="border border-white/10 px-2 py-1" />,
  h1: (p) => <h1 {...p} className="text-lg font-bold my-3" />,
  h2: (p) => <h2 {...p} className="text-base font-bold my-2" />,
  h3: (p) => <h3 {...p} className="text-sm font-bold my-2" />,
};

export function MarkdownWithThink({ content }: MarkdownWithThinkProps) {
  const { thinkBlocks, mainContent } = useMemo(() => preprocessThinkBlocks(content), [content]);

  if (thinkBlocks.length === 0) {
    return (
      <div className="text-sm text-desktop-text/90 leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
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
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{mainContent}</ReactMarkdown>
      )}
    </div>
  );
}
