import { useState, useMemo } from 'react';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { CodeBlock } from './CodeBlock';

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
    return (
      <CodeBlock
        code={codeString}
        language={match ? match[1] : 'text'}
        inline={isInline}
      />
    );
  },
  a: ({ href, children, ...p }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-desktop-highlight hover:underline" {...p}>{children}</a>
  ),
  p: (p) => <p {...p} className="my-2" />,
  ul: (p) => <ul {...p} className="list-disc list-inside space-y-1 my-2 [&_input[type=checkbox]]:mr-2" />,
  ol: (p) => <ol {...p} className="list-decimal list-inside space-y-1 my-2 [&_input[type=checkbox]]:mr-2" />,
  blockquote: (p) => <blockquote {...p} className="border-l-2 border-desktop-accent/50 pl-3 my-2 text-desktop-muted italic" />,
  pre: (p) => <pre {...p} className="bg-[#1e1e1e] rounded-lg overflow-x-auto my-2 p-3 text-[13px] leading-relaxed" />,
  table: (p) => <div className="overflow-x-auto my-2"><table {...p} className="min-w-full border-collapse text-xs rounded-lg overflow-hidden" /></div>,
  thead: (p) => <thead {...p} className="bg-white/[0.06]" />,
  th: (p) => <th {...p} className="border border-white/10 px-3 py-1.5 text-left text-desktop-text/90 font-semibold" />,
  tr: (p) => <tr {...p} className="border-b border-white/[0.06] hover:bg-white/[0.03] transition-colors" />,
  td: (p) => <td {...p} className="border border-white/10 px-3 py-1.5 text-desktop-text/80" />,
  // Task list checkboxes (GFM strikethrough for completed items)
  input: ({ type, checked, ...p }: any) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          className="accent-desktop-accent mr-2"
          {...p}
        />
      );
    }
    return <input {...p} />;
  },
  // Support <br> in markdown
  br: () => <br />,
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
