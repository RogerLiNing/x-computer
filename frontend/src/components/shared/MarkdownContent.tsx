/**
 * Markdown 渲染组件 - 用于展示 AI 生成的富文本内容
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const components: Components = {
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

  return (
    <div className="text-sm text-desktop-text/90 leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
