/** How long a channel reply may take before the person hears that work is under way. */
export const CHANNEL_PROGRESS_NOTICE_MS = Number(process.env.X_CHANNEL_PROGRESS_NOTICE_MS) > 0 ? Number(process.env.X_CHANNEL_PROGRESS_NOTICE_MS) : 20_000;
export const CHANNEL_PROGRESS_TEXT = '收到，正在处理中，稍后把结果发给你。';

/**
 * Sends one progress message if `execution` is still pending after `afterMs`. The send is best effort:
 * a failure never affects the run, and nothing is sent once the work has finished.
 */
export function scheduleProgressNotice(execution: Promise<unknown>, options: { afterMs?: number; send: () => Promise<unknown> }): Promise<boolean> {
  const afterMs = options.afterMs ?? CHANNEL_PROGRESS_NOTICE_MS;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      options.send().then(() => resolve(true), () => resolve(false));
    }, afterMs);
    execution.then(() => { settled = true; clearTimeout(timer); resolve(false); }, () => { settled = true; clearTimeout(timer); resolve(false); });
  });
}
