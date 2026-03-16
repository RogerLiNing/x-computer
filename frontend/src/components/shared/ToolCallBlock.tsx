/**
 * 工具调用展示块 - 在对话中展示工具调用状态和结果
 */

import { useState, useEffect } from 'react';
import { Wrench, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';
import type { ToolCallRecord } from './types';

interface ToolCallBlockProps {
  tc: ToolCallRecord;
}

export function ToolCallBlock({ tc }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const tools = useDesktopStore((s) => s.tools);
  const fetchTools = useDesktopStore((s) => s.fetchTools);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const toolDisplayName = tools.find((t) => t.name === tc.toolName)?.displayName ?? tc.toolName;

  const statusIcon =
    tc.status === 'running' ? (
      <Loader2 size={10} className="text-blue-400 animate-spin shrink-0" />
    ) : tc.status === 'completed' ? (
      <CheckCircle2 size={10} className="text-green-400 shrink-0" />
    ) : (
      <XCircle size={10} className="text-red-400 shrink-0" />
    );

  const outputStr =
    tc.error != null
      ? String(tc.error)
      : tc.output != null
        ? typeof tc.output === 'string'
          ? tc.output
          : JSON.stringify(tc.output, null, 2)
        : '';

  const hasDetail = (tc.input && Object.keys(tc.input).length > 0) || outputStr;

  return (
    <div className="mt-1.5 rounded-lg border border-white/10 bg-white/5 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
        onClick={() => hasDetail && setExpanded((e) => !e)}
      >
        {hasDetail ? (
          expanded ? (
            <ChevronDown size={10} className="text-desktop-muted shrink-0" />
          ) : (
            <ChevronRight size={10} className="text-desktop-muted shrink-0" />
          )
        ) : (
          <span className="w-[10px]" />
        )}
        <Wrench size={10} className="text-desktop-muted shrink-0" />
        {statusIcon}
        <span className="text-[10px] text-desktop-muted truncate flex-1">
          {toolDisplayName}
          {tc.duration != null && tc.status !== 'running' && (
            <span className="text-desktop-muted/60 ml-1">({tc.duration}ms)</span>
          )}
        </span>
      </button>
      {expanded && hasDetail && (
        <div className="px-2.5 py-1.5 text-[10px] text-desktop-muted/80 border-t border-white/5 space-y-1 max-h-32 overflow-auto">
          {tc.input && Object.keys(tc.input).length > 0 && (
            <div>
              <span className="text-desktop-muted/60">输入:</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(tc.input, null, 2)}
              </pre>
            </div>
          )}
          {outputStr && (
            <div>
              <span className="text-desktop-muted/60">{tc.error ? '错误:' : '输出:'}</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-desktop-text/90">
                {outputStr.length > 500 ? outputStr.slice(0, 500) + '...' : outputStr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
