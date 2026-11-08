import path from 'node:path';
import type { SandboxFS } from '../tooling/SandboxFS.js';

/**
 * QQ 消息里的附件（文件、图片、视频、语音）。
 *
 * 官方事件里 attachments 每项有 content_type / filename / size / url（见腾讯官方 botpy 的 _Attachments）。
 * qq-official-bot 把它们解析成消息段 { type, url, name, size }，并把 `<file,url=…,name=…>` 写进 raw_message。
 * url 是 QQ 文件服务器的临时直链，直接 GET 即可下载，不需要鉴权；过一段时间会失效，所以收到时就下载。
 */
export interface QQAttachment {
  readonly kind: 'file' | 'image' | 'video' | 'audio';
  readonly url: string;
  readonly name?: string;
  readonly size?: number;
}

export interface SavedQQAttachment {
  readonly attachment: QQAttachment;
  readonly path?: string;
  readonly error?: string;
}

/** 收到的文件放在个人目录这个文件夹里，按日期分子文件夹。 */
export const QQ_INBOX_DIR = 'QQ收到的文件';
export const QQ_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const KINDS = new Set<QQAttachment['kind']>(['file', 'image', 'video', 'audio']);
const DEFAULT_EXT: Record<QQAttachment['kind'], string> = { file: '', image: '.jpg', video: '.mp4', audio: '.amr' };
const KIND_LABEL: Record<QQAttachment['kind'], string> = { file: '文件', image: '图片', video: '视频', audio: '语音' };
/** 只从 QQ 自己的文件域名下载，避免伪造的链接让服务器去访问内网或任意地址。 */
const ALLOWED_HOST = /(^|\.)(qq\.com|qq\.com\.cn|qpic\.cn|gtimg\.cn|myqcloud\.com)$/i;
/** raw_message 里附件生成的标记，例如 `<file,size=1,url=…,name=a.docx>`。 */
const ATTACHMENT_TAG = /<(file|image|video|audio),[^>]*>/g;

/** 从 SDK 解析出的消息段里取出附件，丢掉格式不对的项。 */
export function extractQQAttachments(segments: unknown): QQAttachment[] {
  if (!Array.isArray(segments)) return [];
  const result: QQAttachment[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue;
    const { type, url, name, size } = segment as Record<string, unknown>;
    if (typeof type !== 'string' || !KINDS.has(type as QQAttachment['kind'])) continue;
    if (typeof url !== 'string' || !url) continue;
    const parsedSize = typeof size === 'number' ? size : typeof size === 'string' ? Number(size) : NaN;
    result.push({
      kind: type as QQAttachment['kind'],
      url,
      ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}),
      ...(Number.isFinite(parsedSize) && parsedSize >= 0 ? { size: parsedSize } : {}),
    });
  }
  return result.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
}

function safeFileName(attachment: QQAttachment, now: Date): string {
  const raw = attachment.name ? path.posix.basename(attachment.name.replace(/\\/g, '/')) : '';
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  if (cleaned) return cleaned;
  const stamp = now.toTimeString().slice(0, 8).replace(/:/g, '');
  return `${KIND_LABEL[attachment.kind]}-${stamp}${DEFAULT_EXT[attachment.kind]}`;
}

function withSuffix(fileName: string, n: number): string {
  const ext = path.posix.extname(fileName);
  return `${fileName.slice(0, fileName.length - ext.length)} (${n})${ext}`;
}

function localDate(now: Date): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('附件链接无效');
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) throw new Error('附件链接不是 QQ 文件服务器');
  return url;
}

async function download(attachment: QQAttachment, fetchImpl: typeof fetch, maxBytes: number): Promise<Buffer> {
  if (attachment.size !== undefined && attachment.size > maxBytes) {
    throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB，没有保存`);
  }
  const res = await fetchImpl(checkUrl(attachment.url), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (res.url) checkUrl(res.url); // 跳转后的地址也必须还在 QQ 文件服务器上
  if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}），链接可能已过期`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB，没有保存`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB，没有保存`);
  return data;
}

async function writeUnique(fs: SandboxFS, dir: string, fileName: string, data: Buffer): Promise<string> {
  for (let n = 1; n <= 50; n++) {
    const candidate = `${dir}/${n === 1 ? fileName : withSuffix(fileName, n)}`;
    try {
      await fs.writeBinaryNew(candidate, data);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('同名文件太多，没有保存');
}

/** 下载附件并存进个人目录 `QQ收到的文件/<日期>/`。单个失败不影响其他附件。 */
export async function saveQQAttachments(
  fs: SandboxFS,
  attachments: readonly QQAttachment[],
  options: { fetchImpl?: typeof fetch; now?: Date; maxBytes?: number } = {},
): Promise<SavedQQAttachment[]> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? QQ_ATTACHMENT_MAX_BYTES;
  const dir = `${QQ_INBOX_DIR}/${localDate(now)}`;
  const results: SavedQQAttachment[] = [];
  for (const attachment of attachments) {
    try {
      const data = await download(attachment, fetchImpl, maxBytes);
      results.push({ attachment, path: await writeUnique(fs, dir, safeFileName(attachment, now), data) });
    } catch (err) {
      results.push({ attachment, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

function describeOne(item: SavedQQAttachment): string {
  const label = KIND_LABEL[item.attachment.kind];
  const name = item.attachment.name ? `「${item.attachment.name}」` : '';
  if (item.path) return `[用户发来${label}${name}，已保存到 ${item.path}]`;
  return `[用户发来${label}${name}，但没能保存：${item.error ?? '未知原因'}]`;
}

/**
 * 把消息里的附件标记换成给助手看的说明。
 * saved 为空时（例如群聊不自动保存）只说明收到了什么，不带链接。
 */
export function describeQQMessage(text: string, attachments: readonly QQAttachment[], saved: readonly SavedQQAttachment[]): string {
  const notes = saved.length
    ? saved.map(describeOne)
    : attachments.map(a => `[对方发来${KIND_LABEL[a.kind]}${a.name ? `「${a.name}」` : ''}，这里不会自动保存]`);
  const body = text.replace(ATTACHMENT_TAG, '').trim();
  return [body, ...notes].filter(Boolean).join('\n');
}
