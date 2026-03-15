/**
 * macOS 系统代理检测：通过 scutil --proxy 读取系统代理配置。
 * 当用户使用 Quantumult X、Clash 等开启「设置为系统代理」时，Node 进程可据此自动使用代理。
 */

import { execSync } from 'child_process';
import os from 'os';

/** 解析 scutil --proxy 输出，返回可用的代理 URL，优先 HTTP/HTTPS，其次 SOCKS5 */
export function getSystemProxy(): string | null {
  if (os.platform() !== 'darwin') return null;
  try {
    const out = execSync('scutil --proxy', { encoding: 'utf8', timeout: 3000 });
    const lines = out.split('\n');
    const dict: Record<string, string | number> = {};
    let key = '';
    for (const line of lines) {
      const m = line.match(/^\s*(\w+)\s*:\s*(.+)$/);
      if (m) {
        key = m[1];
        const val = m[2].trim();
        dict[key] = val === '1' ? 1 : val === '0' ? 0 : val;
      }
    }

    // 优先 HTTP/HTTPS（WhatsApp 使用 HTTPS）
    if (dict.HTTPSEnable === 1 && dict.HTTPSProxy && dict.HTTPSPort) {
      const host = String(dict.HTTPSProxy).trim();
      const port = Number(dict.HTTPSPort) || 443;
      if (host) return `http://${host}:${port}`;
    }
    if (dict.HTTPEnable === 1 && dict.HTTPProxy && dict.HTTPPort) {
      const host = String(dict.HTTPProxy).trim();
      const port = Number(dict.HTTPPort) || 80;
      if (host) return `http://${host}:${port}`;
    }

    // 其次 SOCKS5
    if (dict.SOCKSEnable === 1 && dict.SOCKSProxy && dict.SOCKSPort) {
      const host = String(dict.SOCKSProxy).trim();
      const port = Number(dict.SOCKSPort) || 1080;
      if (host) return `socks5://${host}:${port}`;
    }

    return null;
  } catch {
    return null;
  }
}
