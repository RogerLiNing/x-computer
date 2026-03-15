/**
 * 解析 agent_ids：支持数组或 JSON 字符串（LLM/前端有时传 "[\"id1\",\"id2\"]"）。
 */
export function parseAgentIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((id) => String(id).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map((id) => String(id).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}
