/**
 * 按套餐功能过滤工具列表
 * trial: 基础工具及本地 Office 读取、创建、修改副本
 * personal: 基础 + 扩展（http、文件索引等）
 * pro/enterprise: 全部（含 MCP、server、workflow、memory、signal、x、skill、多媒体等）
 */

import { SEND_TOOLS } from '../tooling/sendApproval.js';
import { SPACE_TOOL_NAMES } from '../orchestrator/tools/space.js';

export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 试用版仅允许的基础工具 */
const BASIC_TOOL_NAMES = new Set([
  ...SEND_TOOLS,
  ...SPACE_TOOL_NAMES,
  'x.ask_user',
  'x.create_agent',
  'x.list_agents',
  'x.update_agent',
  'x.dispatch_agent',
  'x.run_agent',
  'x.run_team',
  'x.run_group',
  'x.get_agent_run',
  'x.create_team',
  'x.list_teams',
  'x.update_team',
  'x.create_group',
  'x.list_groups',
  'x.update_group',
  'x.add_agents_to_group',
  'x.remove_agents_from_group',
  'x.dispatch_team',
  'x.dispatch_group',
  'x.create_app',
  'x.list_apps',
  'x.get_app_logs',
  'browser.request_upload',
  'browser.downloads',
  'browser.present_download',
  'browser.observe',
  'browser.act',
  'capability.search',
  'capability.load',
  'web_search',
  'http_request',
  'html_parse',
  'json_parse',
  'file.read',
  'file.extract_text',
  'office.edit_copy',
  'office.create_docx',
  'office.read_docx',
  'office.create_xlsx',
  'office.read_xlsx',
  'office.create_pptx',
  'office.read_pptx',
  'file.present',
  'file.write',
  'file.list',
  'file.replace',
  'file.move',
  'grep',
  'shell.run',
  'llm.generate',
  'sleep',
  'read_recent_assistant_chat',
  'memory_search',
  'x.notify_user',
  'x.record_done',
  'x.schedule_run',
  'x.schedule_reminder',
  'x.list_scheduled_runs',
  'x.remove_scheduled_run',
]);

/** 个人版在基础之上额外允许（不含 MCP、高级工具） */
const ALL_FEATURES_EXTRA = new Set([
  'http.request',
  'file.tail',
  'file.parse',
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
