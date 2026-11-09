import { ToolTimeoutError } from '../errors.js';
import type { ExecuteWrapper } from '../types.js';

export interface TimeoutWrapperOptions {
  /** Deadline for tools without an override; 0 or undefined disables the default. */
  defaultMs?: number;
  perTool?: Record<string, number>;
  /** Tools that legitimately run long (sleep, video generation, interactive shells). */
  exempt?: string[];
}

function deadlineFor(toolName: string, options: TimeoutWrapperOptions): number | undefined {
  if (options.exempt?.includes(toolName)) return undefined;
  const override = options.perTool?.[toolName];
  if (override !== undefined) return override > 0 ? override : undefined;
  return options.defaultMs && options.defaultMs > 0 ? options.defaultMs : undefined;
}

export function createTimeoutWrapper(options: TimeoutWrapperOptions = {}): ExecuteWrapper {
  return async (invocation, next) => {
    const ms = deadlineFor(invocation.toolName, options);
    if (ms === undefined) return next();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ToolTimeoutError(invocation.toolName, ms)), ms);
    });
    try {
      return await Promise.race([next(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
