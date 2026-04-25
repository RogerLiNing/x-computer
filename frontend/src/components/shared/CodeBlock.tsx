import { useState } from 'react';
import { Play, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { api } from '@/utils/api';

const EXECUTABLE = new Set(['python', 'python3', 'bash', 'sh', 'shell', 'js', 'javascript', 'node', 'python2']);

interface CodeExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CodeBlockProps {
  code: string;
  language: string;
  inline?: boolean;
}

export function CodeBlock({ code, language, inline = false }: CodeBlockProps) {
  const lang = language.toLowerCase();
  const canRun = !inline && EXECUTABLE.has(lang);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CodeExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const r = await api.executeCode(code, lang);
      setResult(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (inline) {
    return (
      <code className="px-1 py-0.5 rounded bg-white/10 text-desktop-accent text-xs font-mono">
        {code}
      </code>
    );
  }

  const output = result
    ? result.stdout || result.stderr
      ? result.stdout + (result.stderr ? `\n${result.stderr}` : '')
      : '(no output)'
    : null;

  return (
    <div className="relative group mt-2 rounded-lg overflow-hidden border border-white/10">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/10">
        <span className="text-[10px] text-desktop-muted font-mono uppercase">{lang}</span>
        <div className="flex items-center gap-1">
          {canRun && (
            <button
              type="button"
              onClick={handleRun}
              disabled={running}
              title="运行代码"
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-desktop-accent/60 hover:bg-desktop-accent/80 text-desktop-text transition-colors disabled:opacity-50"
            >
              {running ? (
                <><Loader2 size={10} className="animate-spin" /> 运行中…</>
              ) : (
                <><Play size={10} /> 运行</>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(code)}
            title="复制代码"
            className="px-2 py-0.5 rounded text-[10px] bg-white/10 hover:bg-white/20 text-desktop-muted transition-colors"
          >
            复制
          </button>
        </div>
      </div>

      {/* Code */}
      <SyntaxHighlighter
        style={oneDark as any}
        language={lang}
        PreTag="div"
        customStyle={{ margin: 0, padding: '0.75rem', background: 'transparent', fontSize: '11px' }}
        codeTagProps={{ style: { fontFamily: 'ui-monospace, monospace' } }}
      >
        {code}
      </SyntaxHighlighter>

      {/* Output */}
      {(output !== null || error !== null) && (
        <div className="border-t border-white/10">
          {error && (
            <div className="flex items-start gap-1.5 px-3 py-2 bg-red-500/10">
              <XCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
              <pre className="text-[11px] text-red-300 font-mono whitespace-pre-wrap">{error}</pre>
            </div>
          )}
          {result && (
            <>
              {result.exitCode === 0 ? (
                <div className="flex items-start gap-1.5 px-3 py-2 bg-green-500/10">
                  <CheckCircle size={12} className="text-green-400 shrink-0 mt-0.5" />
                  <pre className="text-[11px] text-green-200 font-mono whitespace-pre-wrap">{output}</pre>
                </div>
              ) : (
                <div className="flex items-start gap-1.5 px-3 py-2 bg-yellow-500/10">
                  <XCircle size={12} className="text-yellow-400 shrink-0 mt-0.5" />
                  <pre className="text-[11px] text-yellow-200 font-mono whitespace-pre-wrap">{output}</pre>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
