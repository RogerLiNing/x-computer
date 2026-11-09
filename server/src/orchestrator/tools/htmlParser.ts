/**
 * HTML 解析工具
 * 从 http_request 返回的原始 HTML 中提取结构化信息。
 * 用于：提取正文文本、提取链接/图片/标题、从表格提取 CSV 等。
 * 大结果自动保存到沙箱临时文件，避免撑满上下文。
 */

import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from './types.js';

export const htmlParserDefinition: ToolDefinition = {
  name: 'html_parse',
  displayName: 'HTML 解析',
  description: '解析 HTML 内容，提取结构化信息。输入为原始 HTML 文本，输出为提取后的结构化数据。模式：text（纯文本）、links（链接列表）、headings（标题结构）、table（表格转 CSV）、metadata（页面元数据）。常与 http_request 配合使用。',
  domain: ['coding'],
  riskLevel: 'low',
  parameters: [
    { name: 'html', type: 'string', description: '原始 HTML 文本（由 http_request 的 bodyText 传入）', required: true },
    { name: 'mode', type: 'string', description: '提取模式：text（默认，纯文本）/ links（所有链接）/ headings（标题层级）/ table（第一个表格转 CSV）/ metadata（title/description/og:*/meta）', required: false },
    { name: 'maxItems', type: 'number', description: '最多返回多少条（links/headings），默认 50', required: false },
  ],
  requiredPermissions: [],
};

// ── 解析器实现 ─────────────────────────────────────────────────────────────

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&copy;/g, '©')
    .replace(/&[a-z]+;/gi, (m) => {
      const map: Record<string, string> = {
        '&cent;': '¢', '&pound;': '£', '&yen;': '¥', '&euro;': '€', '&sect;': '§',
        '&para;': '¶', '&bull;': '•', '&hellip;': '…', '&rsquo;': '’', '&lsquo;': '‘',
        '&rdquo;': '"', '&ldquo;': '"', '&ndash;': '–', '&mdash;': '—', '&deg;': '°',
        '&plusmn;': '±', '&times;': '×', '&divide;': '÷', '&trade;': '™', '&reg;': '®',
      };
      return map[m] ?? m;
    });
}

function stripTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};

  // <title>
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (titleMatch) meta.title = decodeHtmlEntities(titleMatch[1].trim());

  // <meta name="..." content="...">
  const nameRe = /<meta\s+(?:name|property)=["']([^"']+)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(html)) !== null) {
    meta[m[1].toLowerCase()] = decodeHtmlEntities(m[2].trim());
  }
  // 兼容 content 在前的写法
  const contentFirstRe = /<meta\s+content=["']([^"']+)["'][^>]+(?:name|property)=["']([^"']+)["'][^>]*>/gi;
  while ((m = contentFirstRe.exec(html)) !== null) {
    meta[m[2].toLowerCase()] = decodeHtmlEntities(m[1].trim());
  }

  return meta;
}

function extractLinks(html: string, maxItems: number): Array<{ text: string; href: string }> {
  const links: Array<{ text: string; href: string }> = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && links.length < maxItems) {
    const href = m[1].trim();
    const rawText = m[2];
    const text = decodeHtmlEntities(stripTags(rawText)).trim();
    if (href && href !== '#' && !href.startsWith('javascript:') && text && !seen.has(href)) {
      seen.add(href);
      links.push({ href, text });
    }
  }
  return links;
}

function extractHeadings(html: string, maxItems: number): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = [];
  const re = /<h([1-6])[^>]*(?:class|id)=["'][^"']*["'][^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && headings.length < maxItems) {
    const text = decodeHtmlEntities(stripTags(m[2])).trim();
    if (text) headings.push({ level: parseInt(m[1]), text });
  }
  // 如果上面的正则没匹配到，尝试更宽松的
  if (headings.length === 0) {
    const looseRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
    while ((m = looseRe.exec(html)) !== null && headings.length < maxItems) {
      const text = decodeHtmlEntities(stripTags(m[2])).trim();
      if (text) headings.push({ level: parseInt(m[1]), text });
    }
  }
  return headings;
}

function extractTable(html: string): string {
  // 找第一个 <table>
  const tableStart = html.indexOf('<table');
  if (tableStart === -1) return '';

  // 简单策略：取 <table> 到 </table> 之间的内容
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableEnd === -1) return '';

  const tableHtml = html.slice(tableStart, tableEnd + 8);

  const rows: string[][] = [];
  // 提取所有 <tr>
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(tableHtml)) !== null) {
    const trContent = trMatch[1];
    const cells: string[] = [];
    // th 和 td
    const cellRe = /<(th|td)[^>]*(?:class|id)=["'][^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(trContent)) !== null) {
      cells.push(decodeHtmlEntities(stripTags(cellMatch[2])).trim());
    }
    // 备用宽松匹配
    if (cells.length === 0) {
      const looseCellRe = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
      while ((cellMatch = looseCellRe.exec(trContent)) !== null) {
        cells.push(decodeHtmlEntities(stripTags(cellMatch[2])).trim());
      }
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return '';

  // 转为 CSV
  const maxCols = Math.max(...rows.map(r => r.length));
  const padRows = rows.map(r => {
    while (r.length < maxCols) r.push('');
    return r;
  });
  return padRows.map(r =>
    r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
  ).join('\n');
}

// ── Handler ─────────────────────────────────────────────────────────────────

export function createHtmlParserHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input: Record<string, unknown>, ctx?: unknown) => {
    const html = String(input.html ?? '');
    if (!html) return { error: 'html 不能为空，请先调用 http_request 获取内容' };

    if (typeof html !== 'string') {
      return { error: 'html 必须是字符串' };
    }

    const mode = String(input.mode ?? 'text').toLowerCase();
    const maxItems = Math.min(Math.max(parseInt(String(input.maxItems ?? '50'), 10), 1), 200);

    switch (mode) {
      case 'links': {
        const links = extractLinks(html, maxItems);
        return { mode: 'links', count: links.length, links };
      }
      case 'headings': {
        const headings = extractHeadings(html, maxItems);
        return {
          mode: 'headings',
          count: headings.length,
          headings,
          outline: headings.map(h => '  '.repeat(h.level - 1) + `${'#'.repeat(h.level)} ${h.text}`).join('\n'),
        };
      }
      case 'table': {
        const csv = extractTable(html);
        if (csv.length > 2000) {
          try {
            const fs = await deps.resolveFS(ctx);
            if (fs) {
              const path = `tool-results/html_table_${Date.now()}.csv`;
              await fs.mkdir('tool-results');
              await fs.writeOverwrite(path, csv);
              return {
                mode: 'table',
                csv: csv.slice(0, 500),
                savedTo: path,
                savedToHint: `完整 CSV 已保存至 ${path}，可用 grep 搜索：grep "关键词" ${path}`,
                note: csv ? '已转换为 CSV 格式' : '未找到 <table>',
              };
            }
          } catch {
            // 降级：不保存
          }
        }
        return { mode: 'table', csv, note: csv ? '已转换为 CSV 格式，可直接写入文件' : '未找到 <table>' };
      }
      case 'metadata': {
        const meta = extractMeta(html);
        const og: Record<string, string> = {};
        for (const [k, v] of Object.entries(meta)) {
          if (k.startsWith('og:') || k.startsWith('twitter:') || ['description', 'keywords', 'author'].includes(k)) {
            og[k] = v;
          }
        }
        return { mode: 'metadata', title: meta.title, meta: og, rawMeta: meta };
      }
      case 'text':
      default: {
        const text = decodeHtmlEntities(stripTags(html));
        if (text.length > 2000) {
          try {
            const fs = await deps.resolveFS(ctx);
            if (fs) {
              const path = `tool-results/html_text_${Date.now()}.txt`;
              await fs.mkdir('tool-results');
              await fs.writeOverwrite(path, text);
              return {
                mode: 'text',
                text: text.slice(0, 500),
                savedTo: path,
                savedToHint: `完整文本已保存至 ${path}，可用 grep 搜索：grep "关键词" ${path}`,
                textTruncated: true,
                textLength: text.length,
              };
            }
          } catch {
            // 降级：不保存
          }
        }
        return {
          mode: 'text',
          text: text.slice(0, 5000),
          textTruncated: text.length > 5000,
          textLength: text.length,
        };
      }
    }
  };
}
