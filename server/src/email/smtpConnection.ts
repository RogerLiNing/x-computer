import net from 'node:net';
import tls from 'node:tls';
import { domainToASCII } from 'node:url';
import { SendExecutionDeniedError } from '../tooling/sendApproval.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';

export interface SmtpOperation {
  signal?: AbortSignal;
  assertSendActive?: () => Promise<void>;
}

/** Own the socket through DNS, TLS and SMTP; a closed transaction is never replayed. */
export async function withSmtpConnection<T>(config: { host: string; port: number; secure?: boolean }, operation: SmtpOperation,
  send: (socket: net.Socket) => Promise<T>): Promise<T> {
  if (operation.signal?.aborted) throw new SendExecutionDeniedError('交办已停止，邮件尚未发送');
  let socket: net.Socket | undefined, closed: Promise<void> | undefined, started = false, stopped: Error | undefined;
  let rejectStop!: (error: Error) => void;
  const stopping = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const stop = (error: Error) => { if (stopped) return; stopped = error; socket?.destroy(); rejectStop(error); };
  const abort = () => stop(new Error('交办已停止'));
  const timer = setTimeout(() => stop(new Error('SMTP 网络事务已超时')), 60000);
  operation.signal?.addEventListener('abort', abort, { once: true });
  const check = async () => {
    await operation.assertSendActive?.();
    if (stopped) throw stopped;
    if (operation.signal?.aborted) throw new SendExecutionDeniedError('交办已停止，邮件尚未发送');
  };
  try {
    if (operation.signal?.aborted) abort();
    await Promise.race([check(), stopping]);
    const servername = net.isIP(config.host) ? undefined : domainToASCII(config.host);
    socket = config.secure ? tls.connect({ host: config.host, port: config.port, servername, rejectUnauthorized: true }) : net.createConnection({ host: config.host, port: config.port });
    const current = socket;
    closed = new Promise<void>(resolve => current.once('close', () => resolve()));
    await Promise.race([new Promise<void>((resolve, reject) => {
      current.once(config.secure ? 'secureConnect' : 'connect', () => resolve());
      current.once('error', reject);
      current.once('close', () => reject(new Error('邮件连接已关闭')));
    }), stopping]);
    await Promise.race([check(), stopping]);
    if (stopped) throw stopped;
    if (current.destroyed) throw new Error('邮件连接已关闭');
    started = true;
    return await Promise.race([send(current), stopping]);
  } catch (error) {
    if (started) throw new UncertainToolOutcomeError('邮件发送已启动但未取得确定回执，连接已中断；请核对后再决定是否重新发送');
    if (error instanceof SendExecutionDeniedError) throw error;
    throw new SendExecutionDeniedError(stopped?.message === 'SMTP 网络事务已超时' ? '邮件连接已超时，尚未发送' : operation.signal?.aborted ? '交办已停止，邮件尚未发送' : '邮件连接或执行权未能确认，尚未发送');
  } finally {
    clearTimeout(timer); operation.signal?.removeEventListener('abort', abort);
    socket?.destroy(); await closed;
  }
}
