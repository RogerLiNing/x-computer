import { useState, useMemo } from 'react';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import type { Components } from 'react-markdown';

interface MarkdownWithThinkProps {
  content: string;
}

/** 将 <think>...</think> 转换为 remark-directive 格式 */
function preprocessThinkBlocks(content: string): string {
  return content.replace(
    /<think>([\s\S]*?)<\/think>/gi,
    (_, inner) => `\n:::think\n${inner.trim()}\n:::\n`,
  );
}

function ThinkBlock({ children }: { children?: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const text = typeof children === 'string' ? children : '';

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
          {text}
        </div>
      )}
    </div>
  );
}

const baseComponents: Components = {
  // 自定义链接样式
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-desktop-accent hover:underline"
      {...props}
    >
      {children}
    </a>
  ),
  // 自定义代码块样式
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || '');
    const isInline = !match;
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
      <pre className="mt-2 p-3 rounded-lg bg-white/5 overflow-x-auto">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  // 自定义列表样式
  ul: (props) => (
    <ul {...props} className="list-disc list-inside space-y-1 my-2" />
  ),
  ol: (props) => (
    <ol {...props} className="list-decimal list-inside space-y-1 my-2" />
  ),
  // 自定义表格样式
  table: (props) => (
    <div className="overflow-x-auto my-2">
      <table {...props} className="min-w-full border-collapse text-xs" />
    </div>
  ),
  th: (props) => (
    <th {...props} className="border border-white/10 px-2 py-1 bg-white/5 text-left" />
  ),
  td: (props) => (
    <td {...props} className="border border-white/10 px-2 py-1" />
  ),
  // 自定义引用块样式
  blockquote: (props) => (
    <blockquote {...props} className="border-l-2 border-desktop-accent/50 pl-3 my-2 text-desktop-muted italic" />
  ),
  // 自定义段落样式
  p: (props) => (
    <p {...props} className="my-2" />
  ),
  // 自定义标题样式
  h1: (props) => <h1 {...props} className="text-lg font-bold my-3" />,
  h2: (props) => <h2 {...props} className="text-base font-bold my-2" />,
  h3: (props) => <h3 {...props} className="text-sm font-bold my-2" />,
  h4: (props) => <h4 {...props} className="text-xs font-bold my-1" />,
  // 自定义水平线样式
  hr: (props) => <hr {...props} className="border-white/10 my-4" />,
  // 自定义加粗和斜体
  strong: (props) => <strong {...props} className="font-bold" />,
  em: (props) => <em {...props} className="italic" />,
};

// Directive components need to be handled specially in react-markdown
const directiveComponents: Components = {
  // @ts-expect-error - directive types
  think: ({ children }: { children?: React.ReactNode }) => <ThinkBlock>{children}</ThinkBlock>,
};

export function MarkdownWithThink({ content }: MarkdownWithThinkProps) {
  const processedContent = useMemo(() => preprocessThinkBlocks(content), [content]);

  const allComponents: Components = useMemo(
    () => ({ ...baseComponents, ...directiveComponents }),
    [],
  );

  return (
    <div className="text-sm text-desktop-text/90 leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective]}
        components={allComponents}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
