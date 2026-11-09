import { createRequire } from 'node:module';
import path from 'node:path';
import { execFile } from 'node:child_process';

function recognize(bytes) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.env.X_COMPUTER_TESSERACT_BIN || 'tesseract', ['stdin', 'stdout', '-l', 'chi_sim+eng', '--psm', '3'], {
      timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, OMP_THREAD_LIMIT: '1', ...(process.env.TESSDATA_PREFIX ? { TESSDATA_PREFIX: process.env.TESSDATA_PREFIX } : {}) },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(error.code === 'ENOENT' ? 'PDF OCR 不可用：请安装 Tesseract 和中英文语言包'
          : error.killed ? 'PDF OCR 单页识别超时，请提供更清晰或更小的扫描页'
          : /traineddata|load.*language/i.test(stderr) ? 'PDF OCR 缺少中英文语言包，请联系管理员安装 chi_sim 和 eng'
          : 'PDF OCR 识别失败，请检查扫描件和本地识别服务'));
      } else resolve(stdout.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

let completed = false;
process.once('disconnect', () => {
  if (completed) return;
  // Server death must not leave the detached parser or OCR engine running.
  if (process.platform !== 'win32') process.kill(-process.pid, 'SIGKILL');
  process.exit(1);
});

process.once('message', async ({ bytes, ocr = false }) => {
  let loading;
  let message;
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
    loading = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      cMapUrl: path.join(root, 'cmaps') + path.sep,
      cMapPacked: true,
      standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep,
      stopAtErrors: true,
      maxImageSize: 16_000_000,
      verbosity: 0,
    });
    const document = await loading.promise;
    if (ocr && document.numPages > 10) throw new Error('PDF OCR 每次最多 10 页，请拆分扫描件后读取');
    if (document.numPages > 200) throw new Error('PDF 超过 200 页，请拆分后读取');
    const pages = [];
    let totalBytes = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const stream = page.streamTextContent().getReader();
      const parts = [];
      try {
        while (true) {
          const { done, value } = await stream.read();
          if (done) break;
          for (const item of value.items) {
            if (!('str' in item)) continue;
            const text = item.str + (item.hasEOL ? '\n' : ' ');
            totalBytes += Buffer.byteLength(text);
            if (totalBytes > 1024 * 1024) throw new Error('PDF 提取文字超过 1 MiB，请拆分后读取');
            parts.push(text);
          }
        }
      } finally {
        await stream.cancel().catch(() => {});
        stream.releaseLock();
      }
      const originalText = parts.join('').trim();
      let text = originalText;
      const needsOcr = ocr;
      if (needsOcr) {
        const base = page.getViewport({ scale: 1 });
        if (![base.width, base.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('PDF OCR 页面尺寸无效');
        const scale = Math.min(2, 4096 / base.width, 4096 / base.height, Math.sqrt(4_000_000 / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const surface = document.canvasFactory.create(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)));
        try {
          await page.render({ canvas: surface.canvas, canvasContext: surface.context, viewport, background: 'rgb(255,255,255)' }).promise;
          const recognized = await recognize(surface.canvas.toBuffer('image/png'));
          text = originalText ? originalText + (recognized ? '\n[本页 OCR 文字，可能与文字层重复]\n' + recognized : '') : recognized;
          totalBytes += Buffer.byteLength(text) - Buffer.byteLength(originalText);
          if (totalBytes > 1024 * 1024) throw new Error('PDF 提取文字超过 1 MiB，请拆分后读取');
        } finally { document.canvasFactory.destroy(surface); }
      }
      page.cleanup();
      pages.push({ page: number, text, ...(needsOcr ? { ocr: true } : {}) });
    }
    const emptyPages = pages.filter(page => !page.text).map(page => page.page);
    const warnings = emptyPages.length ? [ocr
      ? `第 ${emptyPages.join('、')} 页经 OCR 仍未识别出文字，不能据此认定这些页没有内容。`
      : `第 ${emptyPages.join('、')} 页没有可提取文字，可能为空白、图片或扫描件；尚未进行 OCR，不能据此认定这些页没有内容。`] : [];
    if (pages.some(page => page.ocr)) warnings.push('已对页面完整渲染结果进行本地 OCR，可能存在错字或遗漏；重要信息请核对原件。原文字层保留，附加 OCR 文字可能与原文字层重复。');
    message = { ok: true, pages, warnings };
  } catch (error) {
    const knownLimit = /^PDF (OCR|超过|提取文字超过)/.test(error?.message ?? '');
    message = { ok: false, error: error?.name === 'PasswordException'
      ? 'PDF 需要密码，请先在本地解锁后上传副本'
      : knownLimit ? error.message : 'PDF 解析失败，文件可能损坏或不受支持，请检查后重试' };
  } finally {
    await loading?.destroy().catch(() => {});
  }
  process.send(message, () => { completed = true; if (process.connected) process.disconnect(); });
});
