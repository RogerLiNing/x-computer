import { SPACE_TOOL_NAMES } from '../orchestrator/tools/space.js';

export const X_DIRECT_PRELOADED_TOOLS = [
  'x.notify_user',
  'x.record_done',
  'x.schedule_run',
  'x.list_scheduled_runs',
  'x.remove_scheduled_run',
  'read_recent_assistant_chat',
  'memory_search',
] as const;

export function resolveRequestedTextArtifactPath(userMessage: string | undefined): string | undefined {
  const message=String(userMessage??'');
  // A referenced input is not a delivery request. Only an explicit save/output directive may create a file.
  const directives=/(?:保存(?:到|为|至)?|另存(?:为|到)?|输出(?:到|为|至)?|导出(?:到|为|至)?|写(?:入|到|至)|存(?:到|为|至)|save\s+(?:to|as))\s*[:：]?\s*(?:["“‘']([^"”’'\r\n]+?\.(?:md|markdown|txt))["”’']|([^\s"'“”‘’，,。；;！？!?（）()\r\n]+?\.(?:md|markdown|txt))(?=$|[\s"'“”‘’，,。；;！？!?）)]))/gi;
  for(const match of message.matchAll(directives)){
    if(/(?:不要|不必|无需|禁止|别)\s*$/.test(message.slice(Math.max(0,match.index!-8),match.index)))continue;
    const file=(match[1]??match[2]).trim().replace(/\\/g,'/');
    if(file.startsWith('/')||/^[a-z]:\//i.test(file)||file.split('/').includes('..'))continue;
    return file.includes('/')?file:`文档/${file}`;
  }
  return undefined;
}

export function resolveIntentPreloadedTools(userMessage: string | undefined): string[] {
  const message = String(userMessage ?? '');
  const tools: string[] = [];
  const send = /x\.send_(email|qq|whatsapp|telegram|discord|slack)\b/i.exec(message)?.[1]?.toLowerCase();
  if (send) tools.push(`x.send_${send}`);
  if (/发送|发给|发到|发条|发一(?:条|封)|发消息|发邮件|\bsend\b/i.test(message)) {
    const channels: Array<[string, RegExp]> = [
      ['whatsapp', /whats\s*app/i], ['telegram', /telegram/i], ['discord', /discord/i],
      ['slack', /slack/i], ['qq', /\bqq\b/i], ['email', /邮件|邮箱|\be-?mail\b/i],
    ];
    for (const [name, pattern] of channels) if (pattern.test(message) && !tools.includes(`x.send_${name}`)) tools.push(`x.send_${name}`);
  }
  if (/提醒|到时叫我|\bremind(?:er)?\b/i.test(message)) tools.push('x.schedule_reminder');
  if (/空间|邀请码|\bspace\b|\binvite\b/i.test(message)) tools.push(...SPACE_TOOL_NAMES);
  if (/x\.schedule_run|定时|到点|届时|(?:明天|后天|每天|每周).{0,12}(?:点|时)|(?:分钟|小时)后|\bschedule\b/i.test(message)) tools.push('x.schedule_run');
  if (/\.docx\b|Word\s*文档|Word\b|创建.{0,12}文档|制作.{0,12}文档/i.test(message)) {
    tools.push('office.create_docx');
  }
  if (/\.pptx\b|PowerPoint|PPT\b|演示稿/i.test(message)) {
    tools.push('office.create_pptx');
  }
  if (/\.xlsx\b|Excel\b|电子表格|工作簿/i.test(message)) {
    tools.push('office.create_xlsx');
  }
  if (/(?:\.docx\b|\.xlsx\b|\.pptx\b|Word\b|Excel\b|PowerPoint\b|PPT\b|文档|表格|工作簿)/i.test(message) && /修改|替换|编辑|改成|更新|\bedit\b|\breplace\b/i.test(message)) {
    tools.push('file.extract_text', 'office.edit_copy', 'file.present');
  }
  return tools;
}

export function isSchedulingTool(name: string): boolean {
  return name === 'x.schedule_run' || name === 'x.schedule_reminder';
}

export function buildTextArtifactDeliveryInstruction(path: string): string {
  return [
    '# 文本产物交付协议',
    `如果用户要求现在交付，服务器会把完整正文保存到「${path}」。`,
    '如果用户要求到点才执行或提醒，先用对应定时工具保存计划，并仅回复真实回执。文件路径应保留在到期任务的内容中，本轮不要生成正文或文件。',
    '请正常完成检索、分析和核验，但不要调用 file.write，也不要把长正文塞入任何工具参数。',
    '本轮交付时，最终回复只写一遍完整正文。服务器会保存它。正文外的文件名、字数统计、保存回执和写作说明都不要输出。',
    '为避免模型输出上限截断，正文控制在 6000 个中文字符以内；完整性优先于细节数量。',
    '先确保覆盖用户要求的全部章节、结论和交付项，再压缩重复解释。',
    '研究类报告必须以来源清单完整收尾，并保留用户要求数量的可点击 Markdown 来源链接。',
    '不要只回复摘要、保存说明或“开始写入文件”。',
  ].join('\n');
}

export interface TextArtifactCompletionCheck {
  complete: boolean;
  missing: string[];
  rewrite?: true;
}

/** Some models wrap the requested document in a labelled fence and invent save commentary. */
export function extractTextArtifactBody(content: string): string {
  const text = content.trim().replace(/\r\n/g, '\n');
  const repeated = /^([\s\S]+?)\n{2,}\*\*字数\*\*[：:][^\n]+\n\*\*文件\*\*[：:][^\n]+(?:正文如下|正文见下)[^\n]*\n+(?:-{3,}\n+)?([\s\S]+)$/.exec(text);
  if (repeated && repeated[1].trim() === repeated[2].trim()) return repeated[2].trim();

  const fenced = [...content.matchAll(/```(?:markdown|md|text|txt)?\s*\n([\s\S]*?)```/g)];
  if (fenced.length !== 1) return content;
  const before = content.slice(0, fenced[0].index);
  return /(?:修改版正文|文件正文|文件内容|正文如下)[：:\s]*$/.test(before)
    ? fenced[0][1].trim() : content;
}

function requestedBodyLimit(request: string): number | undefined {
  const limits = request.matchAll(/(?:全文|全篇|正文|总字数|一段|一篇|一份|用|写)\s*(?:的?(?:总)?字数\s*)?(?:(不超过|最多|不多于|至多|控制在)\s*)?(\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:个)?(?:汉字|字符|字)(?!数)\s*(以内|之内)?/g);
  const limit = Array.from(limits).find(match => match[1] || match[3])?.[2];
  if (!limit) return;
  if (/^\d+$/.test(limit)) return Number(limit);
  const parts = /^(?:([一二两三四五六七八九])千)?(?:([一二两三四五六七八九])百)?[零〇]?(?:([一二两三四五六七八九]?)十)?([一二两三四五六七八九])?$/.exec(limit);
  if (!parts || (!parts[3] && (parts[1] || parts[2]) && parts[4] && !/[零〇]/.test(limit))) return;
  const digit = (value: string | undefined) => value === '两' ? 2 : value ? '零一二三四五六七八九'.indexOf(value) : 0;
  return digit(parts[1]) * 1000 + digit(parts[2]) * 100 + (parts[3] === '' ? 1 : digit(parts[3])) * 10 + digit(parts[4]);
}

export function inspectTextArtifactCompletion(
  userMessage: string,
  content: string,
): TextArtifactCompletionCheck {
  const missing: string[] = [];
  const limit = requestedBodyLimit(userMessage);
  const length = Array.from(content.replace(/\s/gu, '')).length;
  const overLimit = limit !== undefined && length > limit;
  if (!length) missing.push('完整正文');
  if (overLimit) missing.push(`正文最多 ${limit} 字，当前 ${length} 字（含标点）`);
  const requiredSections = ['执行摘要', '关键发现', '主流平台', '争议与局限'];
  for (const section of requiredSections) {
    if (userMessage.includes(section) && !content.includes(section)) {
      missing.push(section);
    }
  }
  if (/低中高预算|低预算.*中预算.*高预算|不同预算|按.*预算/i.test(userMessage)) {
    for (const budget of ['低预算', '中预算', '高预算']) {
      if (!content.includes(budget)) missing.push(budget);
    }
  }
  if (/来源.*链接|链接.*来源|可点击.*链接/i.test(userMessage)) {
    const requestedCount = Number(userMessage.match(/至少\s*(\d+)\s*个?.{0,8}(?:来源|链接)/)?.[1] ?? 6);
    const links = content.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) ?? [];
    if (links.length < requestedCount) {
      missing.push(`至少 ${requestedCount} 个不同来源的 Markdown 链接（当前 ${links.length} 个）`);
    }
  }
  return { complete: missing.length === 0, missing, ...(!length || overLimit ? { rewrite: true as const } : {}) };
}

export function resolveInitialLoadedTools(
  scene: string | undefined,
  requestedTools: unknown,
  userMessage?: string,
): string[] | undefined {
  const requested = Array.isArray(requestedTools)
    ? requestedTools
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean)
    : [];
  const preloaded = scene === 'x_direct' ? X_DIRECT_PRELOADED_TOOLS : [];
  const inferred = resolveIntentPreloadedTools(userMessage);
  const resolved = [...new Set([...preloaded, ...requested, ...inferred])];
  return resolved.length > 0 ? resolved : undefined;
}
