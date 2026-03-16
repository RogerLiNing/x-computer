/**
 * 按套餐功能过滤工具列表
 * trial: 仅基础工具（file、shell、grep、llm.generate、sleep）
 * personal: 基础 + 扩展（http、office 等）
 * pro/enterprise: 全部（含 MCP、server、workflow、memory、signal、x、skill、多媒体等）
 */

export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 试用版仅允许的基础工具 */
const BASIC_TOOL_NAMES = new Set([
  'file.read',
  'file.write',
  'file.list',
  'file.replace',
  'grep',
  'shell.run',
  'llm.generate',
  'sleep',
]);

/** 个人版在基础之上额外允许（不含 MCP、高级工具） */
const ALL_FEATURES_EXTRA = new Set([
  'http.request',
  'file.tail',
  'file.parse',
  'office.create_docx',
  'office.read_docx',
  'office.create_xlsx',
  'office.read_xlsx',
  'office.create_pptx',
  'office.read_pptx',
]);

/** 工具名是否属于 MCP（mcp.xxx.yyy 格式） */
function isMcpTool(name: string): boolean {
  return name.startsWith('mcp.');
}

/** 工具名是否属于高级工具（需 advanced_tools 特性） */
function isAdvancedTool(name: string): boolean {
  if (isMcpTool(name)) return true;
  const advancedPrefixes = [
    'server.',
    'workflow.',
    'task.',
    'memory_',
    'memory.',
    'signal.',
    // x. 前缀的工具中，x.send_* 除外（渠道发送工具应在基础套餐中可用）
    'x.',
    'skill.',
    'search.web',
    'browser.',
    'llm.analyze',
    'llm.generate_image',
    'llm.generate_music',
    'llm.generate_sound_effect',
    'python.run',
    'backend.',
  ];
  // x.send_* 工具（渠道发送）应该在基础套餐中可用
  if (name.startsWith('x.send_')) return false;
  return advancedPrefixes.some((p) => name === p || name.startsWith(p + '.'));
}

/**
 * 根据套餐功能过滤工具列表
 * @param tools 全部可用工具
 * @param features 用户套餐的 features 数组，如 ['basic_features'] 或 ['all_features','advanced_tools']
 */
export function filterToolsByPlan(tools: LLMToolDef[], features: string[]): LLMToolDef[] {
  const hasAllFeatures = features.includes('all_features');
  const hasAdvancedTools = features.includes('advanced_tools');
  const hasBasicOnly = !hasAllFeatures && (features.includes('basic_features') || features.length === 0);

  return tools.filter((t) => {
    if (hasAdvancedTools) return true;
    if (isAdvancedTool(t.name)) return false;
    if (hasAllFeatures) return true;
    if (hasBasicOnly) return BASIC_TOOL_NAMES.has(t.name);
    return ALL_FEATURES_EXTRA.has(t.name) || BASIC_TOOL_NAMES.has(t.name);
  });
}
