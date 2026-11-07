import { Router } from 'express';
import multer from 'multer';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import { readDocx, readXlsx, readPptx, createDocx, createXlsx, type SheetData } from '../office/index.js';
import { readPdf } from '../office/pdf.js';
import { createHash } from 'node:crypto';
import { saveOfficeEdit } from '../office/edit.js';

const upload = multer({ storage: multer.memoryStorage() });

/**
 * 获取当前请求对应的 SandboxFS：
 * - 若有 userSandboxManager 且 userId 存在，返回用户专属沙箱
 * - 否则返回默认（全局）沙箱
 */
async function getUserFS(
  req: Express.Request,
  defaultFS: SandboxFS,
  manager?: UserSandboxManager,
): Promise<SandboxFS> {
  if (manager && req.userId && req.userId !== 'anonymous') {
    const sandbox = await manager.getForUser(req.userId);
    return sandbox.sandboxFS;
  }
  return defaultFS;
}

export function createFSRouter(sandboxFS: SandboxFS, userSandboxManager?: UserSandboxManager): Router {
  const router = Router();

  /** 获取当前用户沙箱在宿主机上的绝对路径（供用户查看、在终端中打开） */
  router.get('/workspace-path', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const path = fs.getRoot();
      res.json({ path });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** List directory contents */
  router.get('/', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const dirPath = (req.query.path as string) || '/';
      const entries = await fs.list(dirPath);
      res.json({ path: dirPath, entries });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** 读取二进制文件并按原样返回（用于图片查看等），Content-Type 按扩展名设置 */
  router.get('/read-binary', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Missing path parameter' });
        return;
      }
      const ext = filePath.replace(/^.*\./, '').toLowerCase();
      const mime: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        // 通用音频
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        flac: 'audio/flac',
        // 通用视频（webm/ogg 可为音或视，此处按视频以便 <video> 播放）
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
      };
      const contentType = mime[ext] || 'application/octet-stream';
      const buffer = await fs.readBinary(filePath);
      res.set('Content-Type', contentType);
      res.send(buffer);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** 下载文件：读取二进制文件并设置 Content-Disposition 触发浏览器下载 */
  router.get('/download', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Missing path parameter' });
        return;
      }
      const fileName = filePath.split('/').pop() || 'download';
      const buffer = await fs.readBinary(filePath);
      const ext = filePath.replace(/^.*\./, '').toLowerCase();
      const mime: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        pdf: 'application/pdf',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        txt: 'text/plain',
        json: 'application/json',
        zip: 'application/zip',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        flac: 'audio/flac',
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
      };
      const contentType = mime[ext] || 'application/octet-stream';
      res.set('Content-Type', contentType);
      res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.send(buffer);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** 读取办公文档内容；PPTX 按实际页序返回文字，不还原版式。 */
  router.get('/read-office', async (req, res) => {
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnected);
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const filePath = (req.query.path as string)?.replace(/^\//, '') || '';
      if (!filePath || filePath.includes('..')) {
        res.status(400).json({ error: 'Missing or invalid path' });
        return;
      }
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      if (req.query.ocr !== undefined && req.query.ocr !== 'true' && req.query.ocr !== 'false') {
        res.status(400).json({ error: '识别选项无效' }); return;
      }
      const ocr = req.query.ocr === 'true', expectedSha = req.query.expected_sha256;
      if (ocr && ext !== 'pdf') { res.status(400).json({ error: '扫描文字识别仅支持 PDF' }); return; }
      if ((ocr || expectedSha !== undefined) && (typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedSha))) {
        res.status(400).json({ error: '请先打开文件，再识别扫描文字' }); return;
      }
      const buf = await fs.readBinaryBounded(filePath);
      const sha256 = createHash('sha256').update(buf).digest('hex');
      if (typeof expectedSha === 'string' && expectedSha.toLowerCase() !== sha256) {
        res.status(409).json({ error: '文件已变化，请重新打开后再识别' }); return;
      }
      if (ext === 'pdf') {
        res.json({ type: 'pdf', path: filePath, sha256, ...await readPdf(buf, controller.signal, ocr) });
        return;
      }
      if (ext === 'docx') {
        const text = await readDocx(buf);
        res.json({ type: 'docx', path: filePath, text, sha256 });
        return;
      }
      if (ext === 'xlsx') {
        const sheets = readXlsx(buf);
        res.json({ type: 'xlsx', path: filePath, sheets, sha256 });
        return;
      }
      if (ext === 'pptx') {
        res.json({ type: 'pptx', path: filePath, sha256, slides: await readPptx(buf) });
        return;
      }
      res.status(400).json({ error: '支持 PDF、DOCX、XLSX 和 PPTX 文件' });
    } catch (err: any) {
      if (!controller.signal.aborted) res.status(400).json({ error: /^PDF OCR (不可用|缺少|当前需要)/.test(err.message ?? '')
        ? '文字识别还没准备好，请联系管理员配置。' : err.message || String(err) });
    } finally {
      res.removeListener('close', disconnected);
    }
  });

  router.post('/edit-office', async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body.path !== 'string' || !body.path || body.path.includes('..') || !body.content || typeof body.content !== 'object' || Array.isArray(body.content)) {
        res.status(400).json({ error: '文件路径或修改内容无效' }); return;
      }
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      res.json(await saveOfficeEdit(fs, body.path, body.expectedSha256, body.content));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '修改未保存，请检查后重试' }); }
  });

  /** 保存办公文档：docx 传 { text, title? }，xlsx 传 { sheets: [{ name, rows }] } */
  router.post('/write-office', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const { path: filePath, type: officeType, content } = req.body as {
        path: string;
        type: 'docx' | 'xlsx';
        content: { text?: string; title?: string; sheets?: SheetData[] };
      };
      if (!filePath || filePath.includes('..') || !officeType || !content) {
        res.status(400).json({ error: 'Missing path, type or content' });
        return;
      }
      const pathNorm = filePath.replace(/^\//, '');
      if (!['docx', 'xlsx'].includes(officeType) || !pathNorm.toLowerCase().endsWith('.' + officeType)) { res.status(400).json({ error: '文件扩展名与类型不一致' }); return; }
      if (officeType === 'docx') {
        const text = typeof content.text === 'string' ? content.text : '';
        const title = typeof content.title === 'string' ? content.title : undefined;
        const buf = await createDocx(text, title);
        await fs.writeBinaryNew(pathNorm, buf);
        res.json({ success: true, path: pathNorm });
        return;
      }
      if (officeType === 'xlsx') {
        const sheets = Array.isArray(content.sheets) ? content.sheets as SheetData[] : [];
        const buf = createXlsx(sheets);
        await fs.writeBinaryNew(pathNorm, buf);
        res.json({ success: true, path: pathNorm });
        return;
      }
      res.status(400).json({ error: 'Unsupported type. Use docx or xlsx' });
    } catch (err: any) {
      res.status(err.code === 'EEXIST' ? 409 : 400).json({ error: err.code === 'EEXIST' ? '原文件会保留，请使用修改副本功能或另选文件名' : err.message || String(err) });
    }
  });

  /** Read file content */
  router.get('/read', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Missing path parameter' });
        return;
      }
      const content = await fs.read(filePath);
      const stat = await fs.stat(filePath);
      res.json({ path: filePath, content, size: stat.size, modified: stat.modified });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Write file content */
  router.post('/write', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const { path: filePath, content } = req.body;
      if (!filePath || content === undefined) {
        res.status(400).json({ error: 'Missing path or content' });
        return;
      }
      await fs.writeOverwrite(filePath, content);
      res.json({ success: true, path: filePath });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** 写入二进制文件到沙箱（如图片）：body 为 { path, contentBase64 } */
  router.post('/write-binary', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const { path: filePath, contentBase64 } = req.body;
      if (!filePath || typeof contentBase64 !== 'string') {
        res.status(400).json({ error: 'Missing path or contentBase64' });
        return;
      }
      const buf = Buffer.from(contentBase64, 'base64');
      await fs.writeBinary(filePath, buf);
      res.json({ success: true, path: filePath });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** 上传文件到沙箱：multipart/form-data，字段名 file，可选 path（目标路径，默认使用文件名） */
  router.post('/upload', upload.single('file'), async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      const targetPath = (req.body?.path as string)?.trim() || file.originalname;
      if (!targetPath || targetPath.includes('..')) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const pathNorm = targetPath.replace(/^\//, '');
      await fs.writeBinary(pathNorm, file.buffer);
      res.json({ success: true, path: pathNorm, fileName: file.originalname, size: file.size });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Upload failed' });
    }
  });

  /** Create directory */
  router.post('/mkdir', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const { path: dirPath } = req.body;
      if (!dirPath) {
        res.status(400).json({ error: 'Missing path' });
        return;
      }
      await fs.mkdir(dirPath);
      res.json({ success: true, path: dirPath });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Delete file or directory */
  router.post('/delete', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const { path: targetPath } = req.body;
      if (!targetPath) {
        res.status(400).json({ error: 'Missing path' });
        return;
      }
      await fs.delete(targetPath);
      res.json({ success: true, path: targetPath });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Rename / move file */
  router.post('/rename', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const { oldPath, newPath } = req.body;
      if (!oldPath || !newPath) {
        res.status(400).json({ error: 'Missing oldPath or newPath' });
        return;
      }
      await fs.rename(oldPath, newPath);
      res.json({ success: true, oldPath, newPath });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Get file/directory info */
  router.get('/stat', async (req, res) => {
    try {
      const fs = await getUserFS(req, sandboxFS, userSandboxManager);
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Missing path parameter' });
        return;
      }
      const stat = await fs.stat(filePath);
      res.json({ path: filePath, ...stat });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
