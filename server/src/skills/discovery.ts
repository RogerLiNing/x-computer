/**
 * Skill 发现：扫描目录下子目录中的 SKILL.md，解析 frontmatter（name、description、metadata）、
 * 自动推断需要的配置字段（API Key、环境变量等），供设置页动态展示输入框。
 * 正则匹配不到时可使用大模型提取。与 OpenClaw/OpenCode/Claude SKILL.md 格式对齐。
 */

import fs from 'fs';
import path from 'path';

export interface SkillConfigField {
  key: string;
  label?: string;
  description?: string;
}

export interface DiscoveredSkill {
  id: string;
  name: string;
  description: string;
  /** 是否需要在设置中配置 API Key（由 metadata 或推断的 configFields 决定） */
  requiresApiKey: boolean;
  /** SKILL.md 所在目录名，用于展示或定位 */
  dirName: string;
  /** 从 Skill 描述中解析出的需配置字段（环境变量、API Key 等），供设置页展示输入框 */
  configFields?: SkillConfigField[];
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;

/** 解析 metadata 中的 requires.env 或 configFields */
function parseMetadataConfig(block: string): SkillConfigField[] | undefined {
  const metaMatch = block.match(/^metadata:\s*(.+)/m);
  if (!metaMatch) return undefined;
  try {
    const raw = metaMatch[1].trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const meta = (parsed?.openclaw ?? parsed?.clawdbot) as Record<string, unknown> | undefined;
    const env = meta?.requires && typeof (meta.requires as Record<string, unknown>).env === 'object'
      ? ((meta.requires as { env: string[] }).env)
      : undefined;
    if (Array.isArray(env) && env.length > 0) {
      return env.filter((k): k is string => typeof k === 'string').map((key) => ({ key }));
    }
    const xc = parsed?.xComputer as { configFields?: SkillConfigField[] } | undefined;
    if (Array.isArray(xc?.configFields) && xc.configFields.length > 0) {
      return xc.configFields;
    }
  } catch {
    // ignore JSON parse errors
  }
  return undefined;
}

/** 从正文中正则提取环境变量名（如 GEMINI_API_KEY、APIFY_API_TOKEN） */
function extractEnvVarsFromBody(content: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  const re = /\b([A-Z][A-Z0-9_]+(?:API_KEY|API_TOKEN))\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const k = m[1];
    if (!seen.has(k)) {
      seen.add(k);
      results.push(k);
    }
  }
  return results;
}

/** 为 env key 生成可读 label（通用规则，非硬编码具体 Skill） */
function envKeyToLabel(key: string): string {
  if (/GEMINI|GOOGLE/.test(key)) return 'Google';
  if (/OPENAI/.test(key)) return 'OpenAI';
  if (/ANTHROPIC/.test(key)) return 'Anthropic';
  if (/XAI/.test(key)) return 'xAI';
  if (/ZHIPU/.test(key)) return '智谱';
  if (/SERPAPI|SERP_API/.test(key)) return 'SerpApi';
  return key.replace(/_/g, ' ');
}

function parseFrontmatter(
  mdContent: string
): { name?: string; description?: string; requiresApiKey: boolean; configFields?: SkillConfigField[] } {
  const match = mdContent.match(FRONTMATTER_RE);
  const block = match?.[1] ?? '';
  const content = match ? mdContent.slice(match[0].length) : mdContent;
  let name: string | undefined;
  let description: string | undefined;
  let requiresApiKey = false;
  const lines = block.split('\n');
  for (const line of lines) {
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    const descMatch = line.match(/^description:\s*(.+)/);
    if (descMatch) {
      description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    if (/requiresApiKey:\s*true/.test(line)) requiresApiKey = true;
  }
  let configFields = parseMetadataConfig(block);
  if (!configFields?.length) {
    const envVars = extractEnvVarsFromBody(content);
    if (envVars.length > 0) {
      configFields = envVars.map((key) => ({ key, label: envKeyToLabel(key) }));
      requiresApiKey = true;
    }
  } else {
    requiresApiKey = true;
  }
  return { name, description, requiresApiKey, configFields };
}

/**
 * 扫描目录下所有 SKILL.md，返回可发现的 Skill 列表。
 * @param skillsRoot 根目录（如项目根下的 skills/）
 */
export function discoverSkills(skillsRoot: string): DiscoveredSkill[] {
  const result: DiscoveredSkill[] = [];
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
    return result;
  }
  const dirs = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dir of dirs) {
    const skillPath = path.join(skillsRoot, dir.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    try {
      const content = fs.readFileSync(skillPath, 'utf-8');
      const { name, description, requiresApiKey, configFields } = parseFrontmatter(content);
      if (!name || !description) continue;
      result.push({
        id: name,
        name,
        description,
        requiresApiKey,
        dirName: dir.name,
        ...(configFields?.length ? { configFields } : {}),
      });
    } catch {
      // 解析失败则跳过
    }
  }
  return result;
}

/** 解析 SKILL.md 全文，返回 frontmatter 与正文 content（OpenCode 风格） */
function parseSkillMarkdown(mdContent: string): { name?: string; description?: string; content: string } {
  const match = mdContent.match(FRONTMATTER_RE);
  const content = match ? mdContent.slice(match[0].length).trim() : mdContent.trim();
  const block = match?.[1] ?? '';
  let name: string | undefined;
  let description: string | undefined;
  for (const line of block.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    const descMatch = line.match(/^description:\s*(.+)/);
    if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return { name, description, content };
}

let skillsRootOverride: string | undefined;
/** 项目内置 skills 路径（仓库 skills/ 目录）；dev 时 workspaceRoot 为临时目录，主工作区为空，需从此处发现内置 Skill */
let projectSkillsRoot: string | undefined;
/** 登录用户沙箱内的 skills 路径；由 createApp 注入，用于支持用户在沙箱内复制/安装的 Skill */
let getSkillsRootForUser: ((userId: string) => string) | undefined;

/** 设置 skills 根目录（主工作区下的 skills），由 createApp 在启动时注入 */
export function setSkillsRoot(root: string | undefined): void {
  skillsRootOverride = root;
}

/** 设置项目内置 skills 路径（如 process.cwd()/skills），确保 dev 时 X 能发现仓库中的 Skill */
export function setProjectSkillsRoot(root: string | undefined): void {
  projectSkillsRoot = root;
}

/** 设置登录用户沙箱内的 skills 路径获取函数；传入 userId 返回 users/{id}/workspace/skills */
export function setGetSkillsRootForUser(fn: ((userId: string) => string) | undefined): void {
  getSkillsRootForUser = fn;
}

/**
 * 返回主工作区的 skills 根目录。
 * 若已调用 setSkillsRoot 则优先使用；否则按 process.cwd 查找。
 */
export function getSkillsRoot(userId?: string): string {
  if (userId && userId !== 'anonymous' && getSkillsRootForUser) {
    return getSkillsRootForUser(userId);
  }
  if (skillsRootOverride) return skillsRootOverride;
  const cwd = process.cwd();
  const candidates = [path.join(cwd, 'skills'), path.join(cwd, '..', 'skills')];
  for (const root of candidates) {
    if (fs.existsSync(root) && fs.statSync(root).isDirectory()) return root;
  }
  return candidates[0];
}

/** 返回主工作区 skills 根目录（不考虑 userId），供 skill.install、deleteSkill 等使用 */
function getMainSkillsRoot(): string {
  if (skillsRootOverride) return skillsRootOverride;
  const cwd = process.cwd();
  const candidates = [path.join(cwd, 'skills'), path.join(cwd, '..', 'skills')];
  for (const root of candidates) {
    if (fs.existsSync(root) && fs.statSync(root).isDirectory()) return root;
  }
  return candidates[0];
}

/**
 * 发现当前可用的 Skills 列表。
 * 合并来源（后者覆盖前者）：项目内置 skills → 主工作区 skills → .claude/skills（skillhub 安装目录）→ 用户沙箱 skills。
 * 确保 dev 时（workspaceRoot 为临时目录）X 也能发现仓库中的 Skill。
 */
export function getDiscoveredSkills(userId?: string): DiscoveredSkill[] {
  const byDir = new Map<string, DiscoveredSkill>();

  if (projectSkillsRoot && fs.existsSync(projectSkillsRoot) && fs.statSync(projectSkillsRoot).isDirectory()) {
    for (const s of discoverSkills(projectSkillsRoot)) byDir.set(s.dirName, s);
  }
  const mainRoot = getMainSkillsRoot();
  for (const s of discoverSkills(mainRoot)) byDir.set(s.dirName, s);

  // Also discover from .claude/skills (skillhub --project installs here)
  const claudeSkillsRoot = path.join(process.cwd(), '.claude', 'skills');
  if (fs.existsSync(claudeSkillsRoot) && fs.statSync(claudeSkillsRoot).isDirectory()) {
    for (const s of discoverSkills(claudeSkillsRoot)) byDir.set(s.dirName, s);
  }

  if (userId && userId !== 'anonymous' && getSkillsRootForUser) {
    const userRoot = getSkillsRootForUser(userId);
    for (const s of discoverSkills(userRoot)) byDir.set(s.dirName, s);
  }

  return Array.from(byDir.values());
}

/** 目录名安全校验：仅允许字母数字、短横线、下划线，禁止路径穿越 */
function isSafeDirName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name) && name.length > 0 && name.length <= 64;
}

/**
 * 删除指定 Skill（递归删除 skill 目录，含 node_modules，完整卸载）。
 * @returns { ok: true } 或 { ok: false, error: string }
 */
export function deleteSkill(dirName: string, userId?: string): { ok: true } | { ok: false; error: string } {
  if (!isSafeDirName(dirName)) {
    return { ok: false, error: '无效的 Skill 目录名' };
  }
  const roots: string[] = userId && userId !== 'anonymous' && getSkillsRootForUser
    ? [getSkillsRootForUser(userId), getMainSkillsRoot()]
    : [getMainSkillsRoot()];
  for (const root of roots) {
    const targetDir = path.join(root, dirName);
    const resolved = path.resolve(targetDir);
    const rootResolved = path.resolve(root);
    if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) continue;
    try {
      if (!fs.existsSync(targetDir)) continue;
      const stat = fs.statSync(targetDir);
      if (!stat.isDirectory()) continue;
      fs.rmSync(targetDir, { recursive: true });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `删除失败: ${msg}` };
    }
  }
  return { ok: false, error: `Skill 不存在: ${dirName}` };
}

export type LLMConfigForExtraction = {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
};

/**
 * 当正则匹配不到 configFields 时，使用大模型从 Skill 正文提取需配置的字段（环境变量、API Key 等）。
 * 返回解析出的 configFields，解析失败或未找到时返回空数组。
 */
export async function extractConfigFieldsWithLLM(
  skillContent: string,
  llmConfig: LLMConfigForExtraction
): Promise<SkillConfigField[]> {
  const { callLLM } = await import('../chat/chatService.js');
  const systemPrompt = `你是一个 Skill 配置解析助手。根据 Skill 的 SKILL.md 正文，提取需要用户配置的 API Key、环境变量等字段。
输出严格的 JSON 数组，每项格式：{"key":"ENV_VAR_NAME","label":"可读名称","description":"可选说明"}
例如：[{"key":"GEMINI_API_KEY","label":"Google Gemini","description":"获取地址：https://aistudio.google.com/apikey"}]
只输出 JSON，不要其他文字。若无法确定任何需配置字段，输出 []。`;
  const userContent = `请从以下 Skill 内容中提取需要配置的字段（API Key、环境变量等）：\n\n${skillContent.slice(0, 8000)}`;
  try {
    const raw = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      providerId: llmConfig.providerId,
      modelId: llmConfig.modelId,
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
    });
    const trimmed = (raw ?? '').trim().replace(/^```json?\s*|\s*```$/g, '');
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is { key: string; label?: string; description?: string } => x && typeof (x as { key?: unknown }).key === 'string')
      .map((x) => ({ key: (x as { key: string }).key, label: (x as { label?: string }).label, description: (x as { description?: string }).description }));
  } catch {
    return [];
  }
}

/**
 * 对已发现的 Skills 进行 LLM 富化：对无 configFields 的 Skill 调用大模型提取。
 * 供 GET /skills?extract=llm 使用。
 */
export async function enrichSkillsWithLLMExtraction(
  skills: DiscoveredSkill[],
  llmConfig: LLMConfigForExtraction,
  getContent: (skillName: string) => string | null
): Promise<DiscoveredSkill[]> {
  const result: DiscoveredSkill[] = [];
  for (const s of skills) {
    if (s.configFields?.length) {
      result.push(s);
      continue;
    }
    const content = getContent(s.name);
    if (!content) {
      result.push(s);
      continue;
    }
    const fields = await extractConfigFieldsWithLLM(content, llmConfig);
    result.push({
      ...s,
      requiresApiKey: fields.length > 0 || s.requiresApiKey,
      ...(fields.length ? { configFields: fields } : {}),
    });
  }
  return result;
}

function findSkillInRoot(
  root: string,
  skillName: string
): { name: string; description: string; content: string; dirName: string } | null {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
  const nameTrimmed = skillName.trim();
  const nameLower = nameTrimmed.toLowerCase();
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dir of dirs) {
    const skillPath = path.join(root, dir.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    try {
      const raw = fs.readFileSync(skillPath, 'utf-8');
      const parsed = parseSkillMarkdown(raw);
      const matchByName = parsed.name && (parsed.name === nameTrimmed || parsed.name.toLowerCase() === nameLower);
      const matchByDir = dir.name.toLowerCase() === nameLower;
      if (matchByName || matchByDir) {
        return {
          name: parsed.name ?? dir.name,
          description: parsed.description ?? '',
          content: parsed.content,
          dirName: dir.name,
        };
      }
    } catch {
      // skip
    }
  }
  return null;
}

/**
 * 按名称加载 Skill 的完整内容（SKILL.md 正文）。
 * 查找顺序：用户沙箱 → 主工作区 → 项目内置（后者为 fallback，确保 dev 时能加载）。
 */
export function getSkillContentByName(skillName: string, userId?: string): { name: string; description: string; content: string; dirName: string } | null {
  const roots: string[] = [];
  if (userId && userId !== 'anonymous' && getSkillsRootForUser) {
    roots.push(getSkillsRootForUser(userId));
  }
  roots.push(getMainSkillsRoot());
  if (projectSkillsRoot && fs.existsSync(projectSkillsRoot)) {
    roots.push(projectSkillsRoot);
  }
  for (const root of roots) {
    const found = findSkillInRoot(root, skillName);
    if (found) return found;
  }
  return null;
}
