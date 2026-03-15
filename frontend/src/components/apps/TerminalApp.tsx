import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { api, isQuotaError } from '@/utils/api';
import { useDesktopStore } from '@/store/desktopStore';
import { useLLMConfigStore } from '@/store/llmConfigStore';

interface TerminalLine {
  type: 'input' | 'output' | 'error' | 'system';
  content: string;
}

function getWelcomeLines(t: (key: string) => string): TerminalLine[] {
  return [
    { type: 'system', content: t('terminal.welcomeLine1') },
    { type: 'system', content: t('terminal.welcomeLine2') },
    { type: 'system', content: t('terminal.welcomeLine3') },
    { type: 'system', content: t('terminal.welcomeLine4') },
    { type: 'system', content: '' },
    { type: 'output', content: t('terminal.welcomeHint1') },
    { type: 'output', content: t('terminal.welcomeHint2') },
    { type: 'output', content: '' },
  ];
}

function getBuiltins(t: (key: string) => string): Record<string, (args: string[], addLines: (lines: TerminalLine[]) => void) => boolean> {
  return {
    clear: (_args, _add) => true,
    help: (_args, add) => {
      add([
        { type: 'output', content: t('terminal.helpTitle') },
        { type: 'output', content: t('terminal.helpHelp') },
        { type: 'output', content: t('terminal.helpClear') },
        { type: 'output', content: t('terminal.helpAi') },
        { type: 'output', content: '' },
        { type: 'output', content: t('terminal.helpShell') },
        { type: 'output', content: t('terminal.helpExamples') },
        { type: 'output', content: t('terminal.helpExamples2') },
        { type: 'output', content: '' },
        { type: 'output', content: t('terminal.helpShortcuts') },
        { type: 'output', content: t('terminal.helpTab') },
        { type: 'output', content: t('terminal.helpArrows') },
        { type: 'output', content: t('terminal.helpCtrlL') },
        { type: 'output', content: t('terminal.helpCtrlC') },
      ]);
      return true;
    },
  };
}

interface Props {
  windowId: string;
}

export function TerminalApp({ windowId }: Props) {
  const { t } = useTranslation();
  const welcomeLines = useMemo(() => getWelcomeLines(t), [t]);
  const builtins = useMemo(() => getBuiltins(t), [t]);
  const [lines, setLines] = useState<TerminalLine[]>(welcomeLines);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [currentDir, setCurrentDir] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const addTask = useDesktopStore((s) => s.addTask);
  const addNotification = useDesktopStore((s) => s.addNotification);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  // 保持输入框焦点
  useEffect(() => {
    if (!running) {
      inputRef.current?.focus();
    }
  }, [running, lines]);

  const addLines = useCallback((newLines: TerminalLine[]) => {
    setLines((prev) => [...prev, ...newLines]);
  }, []);

  const execute = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;

      // Add to history
      setHistory((h) => [...h, trimmed]);
      setHistoryIndex(-1);

      // Show command
      addLines([{ type: 'input', content: `$ ${trimmed}` }]);

      // Clear
      if (trimmed === 'clear') {
        setLines([]);
        setInput('');
        return;
      }

      // Ctrl+L clear
      const [command, ...args] = trimmed.split(/\s+/);

      // Check builtins
      const builtin = builtins[command];
      if (builtin) {
        builtin(args, addLines);
        setInput('');
        return;
      }

      // AI command
      if (command === 'ai') {
        if (args.length === 0) {
          addLines([{ type: 'error', content: '用法: ai <任务描述>' }]);
        } else {
          const desc = args.join(' ');
          addLines([
            { type: 'system', content: `[AI] 正在提交任务: "${desc}"` },
          ]);
          try {
            const llmState = useLLMConfigStore.getState();
            const cfg = llmState.llmConfig;
            const sel = cfg?.defaultByModality?.chat;
            const providerId = sel?.providerId ?? cfg?.providers?.[0]?.id;
            const provider = cfg?.providers?.find((p: { id: string }) => p.id === providerId);
            const taskLlmConfig =
              providerId && provider
                ? {
                    providerId,
                    modelId: sel?.modelId ?? '__custom__',
                    baseUrl: provider?.baseUrl ?? undefined,
                    apiKey: llmState.getProviderApiKey(providerId) || undefined,
                  }
                : undefined;
            const task = await api.createTask({
              domain: 'agent',
              title: desc.slice(0, 50),
              description: desc,
              llmConfig: taskLlmConfig,
            });
            addLines([
              { type: 'system', content: `[AI] 任务已创建: ${(task as any).id}` },
              { type: 'system', content: `[AI] 状态: ${(task as any).status}` },
            ]);
            addNotification({
              type: 'info',
              title: 'AI 任务已提交',
              message: desc.slice(0, 60),
              relatedTaskId: (task as any).id,
            });
          } catch (err: any) {
            const msg = isQuotaError(err) ? t('errors.quotaExceededFriendly') : err?.message ?? String(err);
            addLines([{ type: 'error', content: `[AI] 提交失败: ${msg}` }]);
            if (isQuotaError(err)) {
              addNotification({
                type: 'error',
                title: t('errors.quotaExceeded'),
                message: `${t('errors.quotaExceededFriendly')} ${t('errors.quotaUpgradeHint')}`,
              });
            }
          }
        }
        setInput('');
        return;
      }

      // Execute via backend
      setRunning(true);
      setInput('');

      try {
        const result = await api.execCommand(trimmed);
        if (result.stdout) {
          addLines(
            result.stdout.split('\n').map((line: string) => ({
              type: 'output' as const,
              content: line,
            })),
          );
        }
        if (result.stderr) {
          addLines(
            result.stderr.split('\n').map((line: string) => ({
              type: 'error' as const,
              content: line,
            })),
          );
        }
        if (result.exitCode !== 0 && !result.stderr) {
          addLines([{ type: 'error', content: `进程退出码: ${result.exitCode}` }]);
        }
        if (result.duration) {
          addLines([{ type: 'system', content: `⏱ ${result.duration}ms` }]);
        }
      } catch (err: any) {
        addLines([{ type: 'error', content: `执行失败: ${err.message}` }]);
      } finally {
        setRunning(false);
      }
    },
    [addLines, addNotification, t],
  );

  // 计算公共前缀
  const getCommonPrefix = (strings: string[]): string => {
    if (strings.length === 0) return '';
    if (strings.length === 1) return strings[0];
    
    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
      while (strings[i].indexOf(prefix) !== 0) {
        prefix = prefix.substring(0, prefix.length - 1);
        if (prefix === '') return '';
      }
    }
    return prefix;
  };

  // Tab 补全
  const handleTabComplete = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const parts = trimmed.split(/\s+/);
    const lastPart = parts[parts.length - 1];
    
    // 如果是第一个词，补全命令
    if (parts.length === 1) {
      const commands = [
        ...Object.keys(builtins),
        'ls', 'cat', 'cd', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'grep', 'find',
        'echo', 'touch', 'head', 'tail', 'wc', 'sort', 'uniq',
        'node', 'npm', 'npx', 'python3', 'python', 'pip',
        'git', 'curl', 'wget', 'tar', 'gzip', 'zip', 'unzip',
      ];
      const matches = commands.filter(cmd => cmd.startsWith(lastPart));
      
      if (matches.length === 1) {
        // 唯一匹配：完整补全
        setInput(matches[0] + ' ');
      } else if (matches.length > 1) {
        // 多个匹配：补全公共前缀
        const commonPrefix = getCommonPrefix(matches);
        if (commonPrefix.length > lastPart.length) {
          setInput(commonPrefix);
        } else {
          // 公共前缀没有更长，显示所有选项
          addLines([
            { type: 'system', content: matches.join('  ') },
          ]);
        }
      }
    } else {
      // 补全文件/目录名
      try {
        const dir = lastPart.includes('/') 
          ? lastPart.substring(0, lastPart.lastIndexOf('/'))
          : '.';
        const prefix = lastPart.includes('/')
          ? lastPart.substring(lastPart.lastIndexOf('/') + 1)
          : lastPart;
        
        const result = await api.listFiles(dir);
        const matchedEntries = result.entries.filter((e: any) => e.name.startsWith(prefix));
        const matches = matchedEntries.map((e: any) => e.name);
        
        if (matches.length === 1) {
          // 唯一匹配：完整补全
          const basePath = dir === '.' ? '' : dir + '/';
          const entry = matchedEntries[0];
          const newInput = parts.slice(0, -1).join(' ') + ' ' + basePath + matches[0];
          setInput(newInput + (entry.type === 'directory' ? '/' : ' '));
        } else if (matches.length > 1) {
          // 多个匹配：补全公共前缀
          const commonPrefix = getCommonPrefix(matches);
          if (commonPrefix.length > prefix.length) {
            const basePath = dir === '.' ? '' : dir + '/';
            const newInput = parts.slice(0, -1).join(' ') + ' ' + basePath + commonPrefix;
            setInput(newInput);
          } else {
            // 公共前缀没有更长，显示所有选项
            addLines([
              { type: 'system', content: matches.join('  ') },
            ]);
          }
        }
      } catch (err) {
        // 静默失败
      }
    }
  }, [input, addLines]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !running) {
      execute(input);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (!running) {
        handleTabComplete();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIdx = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIdx);
        setInput(history[history.length - 1 - newIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIdx = historyIndex - 1;
        setHistoryIndex(newIdx);
        setInput(history[history.length - 1 - newIdx]);
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      setLines([]);
    } else if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      addLines([{ type: 'input', content: `$ ${input}^C` }]);
      setInput('');
    }
  };

  return (
    <div
      className="h-full bg-[#0d0d1a] font-mono text-[13px] p-3 overflow-auto cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={`whitespace-pre-wrap leading-relaxed ${
            line.type === 'input'
              ? 'text-green-400'
              : line.type === 'error'
                ? 'text-red-400'
                : line.type === 'system'
                  ? 'text-blue-400/70'
                  : 'text-desktop-text/80'
          }`}
        >
          {line.content}
        </div>
      ))}

      {/* Input line */}
      <div className="flex items-center mt-0.5">
        {running ? (
          <span className="text-yellow-400 animate-pulse mr-2">⟳</span>
        ) : (
          <span className="text-green-400 mr-2">$</span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent outline-none text-desktop-text caret-green-400"
          autoFocus
          spellCheck={false}
          disabled={running}
        />
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
