/**
 * JSON 解析工具
 * 从任意文本（含 JSON 片段）中提取并解析 JSON。
 * 用于：http_request 返回的 bodyText、网页中嵌入的 JSON 脚本、API 响应片段。
 * 支持：自动提取 JSON 片段、解析后返回结构化数据、按路径提取字段。
 */

import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from './types.js';

export const jsonParserDefinition: ToolDefinition = {
  name: 'json_parse',
  displayName: 'JSON 解析',
  description: '解析 JSON 字符串，提取结构化数据。输入为原始文本（http_request 的 bodyText），自动定位并解析其中的 JSON。可按 path 提取嵌套字段，如 "data.items[0].name"。',
  domain: ['coding'],
  riskLevel: 'low',
  parameters: [
    { name: 'text', type: 'string', description: '原始文本（由 http_request 的 bodyText 传入）', required: true },
    { name: 'path', type: 'string', description: 'JSON path，如 data、data.items、data[0].name（可选，不填则返回整个解析结果）', required: false },
    { name: 'pretty', type: 'boolean', description: '是否格式化输出（默认 true）', required: false },
  ],
  requiredPermissions: [],
};

// ── 解析器实现 ─────────────────────────────────────────────────────────────

function findJsonInText(text: string): { json: string; prefix: string } | null {
  const trimmed = text.trim();

  // 1. 已经是干净的 JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return { json: trimmed, prefix: '' };
  }

  // 2. 找包裹在 ```json ... ``` 或 ``` ... ``` 中的 JSON
  const codeBlockRe = /```(?:json)?\s*([\s\S]*?)```/i;
  const match = codeBlockRe.exec(text);
  if (match) {
    const inner = match[1].trim();
    if (inner.startsWith('{') || inner.startsWith('[')) {
      return { json: inner, prefix: '代码块 ```json``` 内' };
    }
  }

  // 3. 找 HTML 中 <script type="application/json"> 或 "window.__INITIAL_STATE__ = " 之类的
  const scriptRe = /<(?:script)[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i;
  const scriptMatch = scriptRe.exec(text);
  if (scriptMatch) {
    const inner = scriptMatch[1].trim();
    if (inner.startsWith('{') || inner.startsWith('[')) {
      return { json: inner, prefix: 'HTML <script type="application/json">' };
    }
  }

  // 4. 找 "key": { ... } 或 "key": [ ... ] 包裹形式
  const quotedRe = /"[\w$]+"\s*:\s*(\{[\s\S]*\}|\[[\s\S]*\])/;
  const quotedMatch = quotedRe.exec(text);
  if (quotedMatch) {
    const candidate = quotedMatch[1];
    try {
      JSON.parse(candidate); // 验证是否合法
      return { json: candidate, prefix: '文本中 "key": {...} 片段' };
    } catch {
      // 不合法，不使用
    }
  }

  return null;
}

/**
 * 按 path 提取嵌套值。
 * path 格式：field、arr[0].name、data.items[2].value
 */
function getByPath(obj: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const idx = parseInt(seg, 10);
      current = current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export function createJsonParserHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input: Record<string, unknown>, ctx?: unknown) => {
    const text = String(input.text ?? '');
    if (!text) return { error: 'text 不能为空，请先调用 http_request 获取内容' };

    const path = String(input.path ?? '').trim();
    const pretty = input.pretty !== false;

    const found = findJsonInText(text);

    if (!found) {
      return {
        error: '未找到有效 JSON，可尝试用 html_parse(mode="text") 先提取纯文本，再检查内容格式',
        hint: '常见情况：JSON 在 ``` 包裹中、HTML script 标签内、或以 "key": {...} 格式嵌入',
      };
    }

    try {
      const parsed = JSON.parse(found.json);

      if (path) {
        const value = getByPath(parsed, path);
        if (value === undefined) {
          return {
            path,
            found: false,
            hint: `路径 "${path}" 在 JSON 中未找到，请检查 path 格式（如 data.items[0].name）`,
            availableKeys: Array.isArray(parsed)
              ? `数组长度: ${parsed.length}，示例: data[0]`
              : `可用字段: ${Object.keys(parsed).join(', ')}`,
          };
        }
        const valueStr = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
        if (valueStr.length > 2000) {
          try {
            const fs = await deps.resolveFS(ctx);
            if (fs) {
              const filePath = `tool-results/json_value_${Date.now()}.json`;
              await fs.mkdir('tool-results');
              await fs.writeOverwrite(filePath, valueStr);
              return {
                path,
                value,
                valueType: Array.isArray(value) ? 'array' : typeof value,
                valueStr: valueStr.slice(0, 500),
                savedTo: filePath,
                savedToHint: `完整值已保存至 ${filePath}，可用 grep 搜索：grep "关键词" ${filePath}`,
              };
            }
          } catch {
            // 降级：不保存
          }
        }
        return {
          path,
          value,
          valueType: Array.isArray(value) ? 'array' : typeof value,
          valueStr,
        };
      }

      const prettyStr = pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
      if (prettyStr.length > 2000) {
        try {
          const fs = await deps.resolveFS(ctx);
          if (fs) {
            const filePath = `tool-results/json_parsed_${Date.now()}.json`;
            await fs.mkdir('tool-results');
            await fs.writeOverwrite(filePath, prettyStr);
            return {
              source: found.prefix,
              parsed,
              pretty: prettyStr.slice(0, 500),
              savedTo: filePath,
              savedToHint: `完整 JSON 已保存至 ${filePath}，可用 grep 搜索：grep "关键词" ${filePath}`,
              parsedLength: prettyStr.length,
              topKeys: Array.isArray(parsed)
                ? `数组[${parsed.length}]，示例: [0]=${JSON.stringify(parsed[0]).slice(0, 80)}`
                : Object.keys(parsed).join(', '),
            };
          }
        } catch {
          // 降级：不保存
        }
      }
      return {
        source: found.prefix,
        parsed,
        pretty: prettyStr,
        parsedLength: prettyStr.length,
        topKeys: Array.isArray(parsed)
          ? `数组[${parsed.length}]，示例: [0]=${JSON.stringify(parsed[0]).slice(0, 80)}`
          : Object.keys(parsed).join(', '),
      };
    } catch (err) {
      return {
        error: `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        found: found.prefix,
        preview: found.json.slice(0, 200),
      };
    }
  };
}
