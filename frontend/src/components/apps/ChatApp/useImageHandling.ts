import { api } from '@/utils/api';

/** 将图片 URL（data URL 或 http）转为 Blob */
async function imageUrlToBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) {
    const res = await fetch(src);
    return res.blob();
  }
  const res = await fetch(src, { mode: 'cors' });
  return res.blob();
}

/** 根据 data URL 或 blob 推断默认扩展名 */
function getImageExtension(src: string, blob: Blob): string {
  if (src.startsWith('data:')) {
    const m = src.match(/data:image\/(\w+);/);
    if (m) {
      const ext = m[1].toLowerCase();
      return ext === 'jpeg' ? '.jpg' : `.${ext}`;
    }
  }
  const t = blob.type?.toLowerCase() || '';
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  if (t.includes('png')) return '.png';
  if (t.includes('webp')) return '.webp';
  if (t.includes('gif')) return '.gif';
  return '.png';
}

/** Blob 转 base64 字符串 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.includes(',') ? s.split(',')[1]! : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** 将图片保存到用户沙箱（非宿主机），路径默认 图片/生成图-{timestamp}.{ext}；返回保存的沙箱路径或 null */
async function saveImageToSandbox(src: string, _suggestedName: string): Promise<string | null> {
  let blob: Blob;
  try {
    blob = await imageUrlToBlob(src);
  } catch {
    return null;
  }
  const ext = getImageExtension(src, blob);
  const sandboxPath = `图片/生成图-${Date.now()}${ext}`;
  let base64: string;
  if (src.startsWith('data:') && src.includes(',')) {
    base64 = src.split(',')[1]!;
  } else {
    try {
      base64 = await blobToBase64(blob);
    } catch {
      return null;
    }
  }
  try {
    await api.writeFileBinary(sandboxPath, base64);
    return sandboxPath;
  } catch {
    return null;
  }
}

export function useImageHandling() {
  return { imageUrlToBlob, blobToBase64, saveImageToSandbox, getImageExtension };
}
