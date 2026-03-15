/**
 * Skill 对应工具：发现到的 Skill 若在本表注册了「工具定义 + 实现」，会动态加入 function call。
 * 不硬编码具体 Skill：工具定义与实现由 MCP 或按需从 Skill 描述动态生成。
 */
import type { ToolDefinition } from '../../../shared/src/index.js';
import { getDiscoveredSkills } from './discovery.js';

export type SkillToolContext = {
  userId?: string;
  getConfig?: (userId: string, key: string) => string | undefined;
};

export type SkillToolHandler = (
  input: Record<string, unknown>,
  ctx?: SkillToolContext,
) => Promise<unknown>;

/** skill id -> 工具定义与实现；不硬编码，由 MCP 或按需从 Skill 动态生成。当前为空，预留扩展点。 */
const REGISTRY: Record<string, { definition: ToolDefinition; handler: SkillToolHandler }> = {};

/**
 * 返回当前应注册的 Skill 工具列表（发现到的 Skill 且在本表有登记则加入），
 * 供 ToolExecutor 在初始化或 getLLMToolDefs 时动态加入 function call。
 */
export function getSkillToolsToRegister(): Array<{ definition: ToolDefinition; handler: SkillToolHandler }> {
  const skills = getDiscoveredSkills();
  return skills
    .filter((s) => REGISTRY[s.id])
    .map((s) => REGISTRY[s.id]!);
}
