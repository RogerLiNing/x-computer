import { fork } from 'node:child_process';

export interface PdfText {
  pages: { page: number; text: string; ocr?: boolean }[];
  warnings: string[];
}

let activeReaders = 0;

/** Read bytes only: the parser never receives a user path or provider credentials. */
export async function readPdf(buffer: Buffer, signal?: AbortSignal, ocr = false): Promise<PdfText> {
  signal?.throwIfAborted();
  if (ocr && process.platform === 'win32') throw new Error('PDF OCR 当前需要 Linux 或 macOS 服务端');
  if (buffer.length > 16 * 1024 * 1024) throw new Error('PDF 超过 16 MiB，请拆分后读取');
  if (!/^%PDF-\d\.\d/.test(buffer.subarray(0, 16).toString('ascii'))) throw new Error('PDF 文件头无效，请检查文件');
  // shortcut: per-process admission; use shared admission when document parsing moves across hosts.
  if (activeReaders >= 2) throw new Error('正在读取其他 PDF，请稍后重试');
  activeReaders++;
  try {
    return await new Promise<PdfText>((resolve, reject) => {
      const child = fork(new URL('./pdfWorker.mjs', import.meta.url), [], {
        execArgv: ['--max-old-space-size=256'],
        detached: process.platform !== 'win32',
        env: { NODE_ENV: 'production', PATH: process.env.PATH,
          ...(ocr ? { X_COMPUTER_TESSERACT_BIN: process.env.X_COMPUTER_TESSERACT_BIN, TESSDATA_PREFIX: process.env.TESSDATA_PREFIX } : {}),
        },
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      let result: PdfText | undefined;
      let failure: Error | undefined;
      const stop = (error: Error) => {
        failure ??= error;
        // Kill OCR descendants as well as the PDF parser before releasing its slot.
        try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
        catch { child.kill('SIGKILL'); }
      };
      const abort = () => stop(new DOMException('已停止读取 PDF', 'AbortError'));
      const timer = setTimeout(() => stop(new Error('PDF 读取超时，请拆分文档后重试')), ocr ? 60_000 : 30_000);
      signal?.addEventListener('abort', abort, { once: true });
      child.on('message', (message: { ok?: boolean; pages?: PdfText['pages']; warnings?: string[]; error?: string }) => {
        if (message.ok && Array.isArray(message.pages) && Array.isArray(message.warnings)) {
          result = { pages: message.pages, warnings: message.warnings };
        } else failure ??= new Error(message.error || 'PDF 读取失败，请检查文件');
      });
      child.once('error', () => stop(new Error('PDF 读取进程不可用，请稍后重试')));
      child.once('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (code === 0 && result) resolve(result);
        else reject(new Error('PDF 读取未完成，可能损坏或超出资源限制，请拆分后重试'));
      });
      child.send({ bytes: buffer, ocr }, (error) => { if (error) stop(new Error('PDF 读取进程通信失败')); });
      if (signal?.aborted) abort();
    });
  } finally {
    activeReaders--;
  }
}
