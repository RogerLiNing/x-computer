export class ToolDeniedError extends Error {
  readonly name = 'ToolDeniedError';
  constructor(readonly toolName: string, readonly code: string, reason: string) {
    super(reason);
  }
}

export class ToolTimeoutError extends Error {
  readonly name = 'ToolTimeoutError';
  constructor(readonly toolName: string, readonly timeoutMs: number) {
    super(`工具 ${toolName} 执行超过 ${Math.round(timeoutMs / 1000)} 秒未完成，已中止`);
  }
}
