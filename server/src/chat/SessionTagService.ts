/**
 * Session Tag Service
 * Uses LLM to analyze chat session content and suggest relevant tags.
 */

const TAG_POOL = [
  'coding',         // 代码编写
  'debugging',      // 调试
  'research',       // 研究调查
  'writing',        // 写作创作
  'planning',       // 规划分析
  'data-analysis',  // 数据分析
  'devops',         // 运维部署
  'question',       // 问答
  'creative',       // 创意
  'file-operations',// 文件操作
  'system',         // 系统操作
  'web',            // 网页相关
  'api',            // API开发
  'database',       // 数据库
  'security',       // 安全相关
  'learning',       // 学习
  'translation',    // 翻译
  'image',          // 图像相关
  'voice',          // 语音相关
  'collaboration',  // 协作
];

const TAG_DISPLAY: Record<string, string> = {
  'coding': '代码',
  'debugging': '调试',
  'research': '研究',
  'writing': '写作',
  'planning': '规划',
  'data-analysis': '数据分析',
  'devops': '运维',
  'question': '问答',
  'creative': '创意',
  'file-operations': '文件',
  'system': '系统',
  'web': '网页',
  'api': 'API',
  'database': '数据库',
  'security': '安全',
  'learning': '学习',
  'translation': '翻译',
  'image': '图像',
  'voice': '语音',
  'collaboration': '协作',
};

export { TAG_POOL, TAG_DISPLAY };

function buildTranscript(messages: Array<{ role: string; content: string }>): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = msg.role === 'user' ? '用户' : '助手';
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    lines.push(`[${role}] ${content}`);
    lines.push('');
  }
  return lines.join('\n');
}

function sanitize(text: string): string {
  return text.replace(/\x00/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}

export interface SessionTagOptions {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
}

/**
 * Analyze session transcript and return suggested tags.
 * Returns array of tag keys from TAG_POOL.
 */
export async function suggestSessionTags(
  messages: Array<{ role: string; content: string }>,
  opts: SessionTagOptions,
  onCallLLM: (prompt: string, opts: SessionTagOptions) => Promise<string>,
): Promise<string[]> {
  if (messages.length === 0) return [];

  const transcript = buildTranscript(messages).slice(0, 6000);
  const tagList = TAG_POOL.map((t) => `${t} (${TAG_DISPLAY[t]})`).join(', ');

  const prompt = `分析以下对话内容，从以下标签池中选择最相关的标签（最多5个）。
只输出标签键（用逗号分隔），不要有解释，不要有多余文字。

标签池：${tagList}

---
对话记录：

${transcript}

---
标签：`;

  try {
    const result = await onCallLLM(prompt, opts);
    const raw = sanitize(result ?? '');

    // Parse comma-separated tag keys
    const suggested = raw
      .split(/[,，、]/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => TAG_POOL.includes(t))
      .slice(0, 5);

    return suggested;
  } catch (err) {
    console.error('[SessionTagService] Failed to suggest tags:', err);
    return [];
  }
}

/**
 * Placeholder LLM caller used when calling from service directly.
 * Actual callLLM is injected where needed.
 */
export async function callLLMTag(opts: SessionTagOptions, prompt: string): Promise<string> {
  const { callLLM } = await import('../chat/chatService.js');
  const result = await callLLM({
    messages: [{ role: 'user', content: prompt }],
    providerId: opts.providerId,
    modelId: opts.modelId,
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
  });
  return result ?? '';
}
