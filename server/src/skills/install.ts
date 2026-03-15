/**
 * Skill 安装：从 SkillHub 或 URL（index.json 格式）拉取并安装 Skill 到 skills 目录。
 * 安装前会检测 npm/npx，缺失时尝试自动安装。
 * @see docs/SKILLS_SELF_INSTALL_PLAN.md
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getSkillsRoot } from './discovery.js';

function runShell(cmd: string, cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], {
      cwd: cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', () => resolve({ code: null, stdout, stderr }));
  });
}

/**
 * 确保 npm 可用。若不存在则尝试安装 Node.js（brew/fnm）。
 */
export async function ensureNpmAvailable(): Promise<{ ok: boolean; error?: string }> {
  const r = await runShell('npm --version');
  if (r.code === 0) return { ok: true };

  const platform = os.platform();
  if (platform === 'darwin') {
    const brew = await runShell('which brew');
    if (brew.code === 0 && brew.stdout.trim()) {
      const install = await runShell('brew install node');
      if (install.code === 0) return { ok: true };
      return { ok: false, error: `brew install node 失败: ${(install.stderr || install.stdout).trim().slice(0, 300)}` };
    }
  }

  const fnm = await runShell('which fnm');
  if (fnm.code === 0 && fnm.stdout.trim()) {
    const install = await runShell('eval "$(fnm env)" && fnm install --lts');
    if (install.code === 0) return { ok: true };
    return { ok: false, error: `fnm install --lts 失败: ${(install.stderr || install.stdout).trim().slice(0, 300)}` };
  }

  const nvmSh = path.join(os.homedir(), '.nvm', 'nvm.sh');
  if (fs.existsSync(nvmSh)) {
    const install = await runShell(`. "${nvmSh}" && nvm install --lts`);
    if (install.code === 0) return { ok: true };
    return { ok: false, error: `nvm install --lts 失败: ${(install.stderr || install.stdout).trim().slice(0, 300)}` };
  }

  return {
    ok: false,
    error: '未检测到 npm。请先安装 Node.js：macOS 可运行 brew install node；或访问 https://nodejs.org 下载安装；或安装 fnm：curl -fsSL https://fnm.vercel.app/install | bash',
  };
}

/**
 * 确保 npx 可用。若不存在则尝试 npm install -g npx（需先有 npm）。
 */
export async function ensureNpxAvailable(): Promise<{ ok: boolean; error?: string }> {
  const r = await runShell('npx --version');
  if (r.code === 0) return { ok: true };

  const npmOk = await ensureNpmAvailable();
  if (!npmOk.ok) return npmOk;

  const install = await runShell('npm install -g npx');
  if (install.code === 0) return { ok: true };
  return {
    ok: false,
    error: `npm install -g npx 失败: ${(install.stderr || install.stdout).trim().slice(0, 300)}。可尝试手动执行 npm install -g npx`,
  };
}

export type SkillInstallResult = {
  ok: boolean;
  message: string;
  skillName?: string;
  dirName?: string;
};

export type SkillHubSearchHit = {
  slug: string;
  version?: string;
  description: string;
  score?: number;
};

export type SkillHubSearchResult =
  | { ok: true; skills: SkillHubSearchHit[] }
  | { ok: false; error: string };

/**
 * 搜索 SkillHub 技能注册表：调用 npx skillhub search。
 */
export async function searchSkillHub(query: string, limit = 10): Promise<SkillHubSearchResult> {
  const q = String(query || '').trim();
  if (!q) {
    return { ok: false, error: '搜索关键词不能为空' };
  }
  const npxOk = await ensureNpxAvailable();
  if (!npxOk.ok) {
    const err: string = npxOk.error ?? 'npx 不可用';
    return { ok: false, error: err };
  }
  const limitNum = Math.min(Math.max(1, Math.floor(Number(limit) || 10)), 50);
  const cmd = `npx --yes skillhub search "${q.replace(/"/g, '\\"')}" --limit ${limitNum}`;
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code: number | null, signal: string | null) => {
      if (code !== 0) {
        const err = stderr.trim() || stdout.trim() || `exit ${code ?? signal}`;
        resolve({ ok: false, error: `skillhub search 失败: ${err.slice(0, 300)}` });
        return;
      }
      // 移除 ANSI 转义码
      const clean = stdout.replace(/\x1b\[[0-9;]*m/g, '');
      const lines = clean.split('\n');
      const skills: SkillHubSearchHit[] = [];
      const seen = new Set<string>();

      let slug = '';
      let shortDesc = '';
      let version: string | undefined;
      let descLines: string[] = [];
      let pendingListSlug = '';

      const flush = () => {
        if (slug && !seen.has(slug)) {
          seen.add(slug);
          const description = shortDesc
            ? descLines.length > 0
              ? `${shortDesc}. ${descLines.join(' ')}`
              : shortDesc
            : descLines.join(' ').trim() || slug;
          skills.push({ slug, version, description: description.slice(0, 500) });
        }
        slug = '';
        shortDesc = '';
        version = undefined;
        descLines = [];
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (/^You can use|^Searching|^Found \d+ skills|^Page \d+ of|^Sort options|^-+$/i.test(trimmed)) continue;
        if (!trimmed) {
          if (slug) flush();
          pendingListSlug = '';
          continue;
        }

        // Format B: 列表格式 [1]   owner/repo/skill-name   ●●●●●
        const listMatch = trimmed.match(/^\[\d+\]\s+([a-zA-Z0-9_./-]+)\s+●/);
        if (listMatch) {
          if (slug) flush();
          pendingListSlug = listMatch[1];
          slug = '';
          shortDesc = '';
          descLines = [];
          continue;
        }

        // Format B 续行: ⬇  0  ⭐  1.0k  描述...
        if (pendingListSlug && (line.includes('⬇') || line.includes('⭐'))) {
          const descMatch = line.match(/⭐\s*[\d.k]+\s+(.+)$/);
          const description = descMatch ? descMatch[1].trim() : line.replace(/^[⬇⭐\d.k\s-]+/, '').trim();
          if (description && !seen.has(pendingListSlug)) {
            seen.add(pendingListSlug);
            skills.push({ slug: pendingListSlug, description: description.slice(0, 500) });
          }
          pendingListSlug = '';
          continue;
        }

        pendingListSlug = '';

        // Format A: slug  description（双空格）或  - version/description
        if (line.startsWith('  - ')) {
          const content = line.slice(4).trim();
          const verMatch = content.match(/^version:\s*([\d.]+)/i);
          if (verMatch) {
            version = verMatch[1];
          } else {
            descLines.push(content);
          }
          continue;
        }

        if (slug && trimmed) flush();

        const sep = trimmed.match(/\s{2,}/);
        if (sep) {
          const idx = trimmed.indexOf(sep[0]);
          slug = trimmed.slice(0, idx).trim();
          shortDesc = trimmed.slice(idx + sep[0].length).trim();
        } else if (/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_.-]+)*$/.test(trimmed)) {
          slug = trimmed;
        } else {
          const first = trimmed.split(/\s+/)[0] ?? trimmed;
          if (/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_.-]+)*$/.test(first)) {
            slug = first;
            shortDesc = trimmed.slice(first.length).trim();
          }
        }
      }
      if (slug) flush();

      resolve({ ok: true, skills });
    });
    child.on('error', (err: Error) => {
      resolve({ ok: false, error: `执行 skillhub search 失败: ${err.message}` });
    });
  });
}

/**
 * 在 Skill 目录中运行 npm install（若存在 package.json），以便 npx 可调用该包。
 */
export async function runNpmInstallInSkillDir(skillDir: string): Promise<{ ok: boolean; error?: string }> {
  const pkgPath = path.join(skillDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return { ok: true };
  const npmOk = await ensureNpmAvailable();
  if (!npmOk.ok) return { ok: false, error: npmOk.error };
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', 'npm install'],
      { cwd: skillDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code: number | null) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: stderr.trim().slice(0, 500) || `npm install exit ${code}` });
    });
    child.on('error', (err: Error) => resolve({ ok: false, error: err.message }));
  });
}

/**
 * 从 SkillHub 安装 Skill：通过 npx skillhub install 命令。安装完成后若存在 package.json 则自动执行 npm install 以便 npx 可用。
 * @param targetRoot 可选，指定安装目标 skills 根目录；不传则用 getSkillsRoot()
 */
export async function installFromSkillHub(slug: string, targetRoot?: string): Promise<SkillInstallResult> {
  const npxOk = await ensureNpxAvailable();
  if (!npxOk.ok) {
    return { ok: false, message: npxOk.error ?? 'npx 不可用', skillName: slug, dirName: slug };
  }
  const skillsRoot = targetRoot ?? getSkillsRoot();
  const workdir = path.dirname(skillsRoot);
  const dirName = path.basename(skillsRoot);
  try {
    fs.mkdirSync(skillsRoot, { recursive: true });
  } catch (e) {
    return {
      ok: false,
      message: `创建目录失败: ${e instanceof Error ? e.message : String(e)}`,
      skillName: slug,
      dirName: slug,
    };
  }
  const slugEscaped = slug.includes(' ') || slug.includes('/') ? `"${slug.replace(/"/g, '\\"')}"` : slug;
  const cmd = `npx --yes skillhub install ${slugEscaped} --dir ${dirName} --workdir "${workdir}" --no-input --force`;
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], {
      cwd: workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', async (code: number | null, signal: string | null) => {
      if (code === 0) {
        const skillDir = path.join(skillsRoot, slug);
        const skillMd = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          const npmResult = await runNpmInstallInSkillDir(skillDir);
          const msg = npmResult.ok
            ? `已安装 Skill: ${slug}（含 npm 依赖，支持 npx 调用）`
            : `已安装 Skill: ${slug}，但 npm install 失败: ${npmResult.error ?? '未知错误'}，可在 skills/${slug} 中手动执行 npm install`;
          resolve({ ok: true, message: msg, skillName: slug, dirName: slug });
        } else {
          resolve({
            ok: false,
            message: `skillhub 安装完成但未找到 SKILL.md。stdout: ${stdout.slice(0, 500)}`,
            skillName: slug,
            dirName: slug,
          });
        }
      } else {
        const err = stderr.trim() || stdout.trim() || `exit ${code ?? signal}`;
        resolve({
          ok: false,
          message: `skillhub install 失败: ${err.slice(0, 500)}`,
          skillName: slug,
          dirName: slug,
        });
      }
    });
    child.on('error', (err: Error) => {
      resolve({
        ok: false,
        message: `执行 skillhub 失败: ${err.message}`,
        skillName: slug,
        dirName: slug,
      });
    });
  });
}

type IndexSkill = { name: string; description?: string; files: string[] };

/**
 * 从 URL（OpenCode index.json 格式）安装 Skill。
 * 拉取 {baseUrl}/index.json，格式：{ skills: [{ name, description?, files }] }
 * 然后下载 {baseUrl}/{skillName}/{file} 到 skills/{skillName}/{file}
 */
export async function installFromUrl(
  baseUrl: string,
  skillNameOrIndex?: number
): Promise<SkillInstallResult> {
  const url = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const indexUrl = new URL('index.json', url).href;
  let data: { skills?: IndexSkill[] };
  try {
    const res = await fetch(indexUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return { ok: false, message: `拉取 index.json 失败: ${res.status} ${res.statusText}` };
    }
    data = (await res.json()) as { skills?: IndexSkill[] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `拉取 index.json 失败: ${msg}` };
  }
  const skills = Array.isArray(data?.skills) ? data.skills : [];
  if (skills.length === 0) {
    return { ok: false, message: 'index.json 中无有效 skills 条目' };
  }
  const idx = typeof skillNameOrIndex === 'number' ? skillNameOrIndex : 0;
  const skill = skills[idx];
  if (!skill?.name || !Array.isArray(skill.files) || skill.files.length === 0) {
    return { ok: false, message: `无效的 skill 条目: ${JSON.stringify(skill ?? '')}` };
  }
  const skillsRoot = getSkillsRoot();
  const targetDir = path.join(skillsRoot, skill.name);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `创建目录失败: ${msg}`, skillName: skill.name, dirName: skill.name };
  }
  const host = url.replace(/\/$/, '');
  for (const file of skill.files) {
    if (!file || file.includes('..')) continue;
    const fileUrl = `${host}/${encodeURIComponent(skill.name)}/${encodeURIComponent(file)}`;
    const destPath = path.join(targetDir, file);
    try {
      const res = await fetch(fileUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        return {
          ok: false,
          message: `下载 ${file} 失败: ${res.status}`,
          skillName: skill.name,
          dirName: skill.name,
        };
      }
      const dir = path.dirname(destPath);
      fs.mkdirSync(dir, { recursive: true });
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(destPath, buf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        message: `下载 ${file} 失败: ${msg}`,
        skillName: skill.name,
        dirName: skill.name,
      };
    }
  }
  const skillMd = path.join(targetDir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) {
    return {
      ok: false,
      message: `安装完成但缺少 SKILL.md，files: ${skill.files.join(', ')}`,
      skillName: skill.name,
      dirName: skill.name,
    };
  }
  const npmResult = await runNpmInstallInSkillDir(targetDir);
  const msg = npmResult.ok
    ? `已从 URL 安装 Skill: ${skill.name}（含 npm 依赖，支持 npx 调用）`
    : `已从 URL 安装 Skill: ${skill.name}，但 npm install 失败: ${npmResult.error ?? '未知错误'}，可在 skills/${skill.name} 中手动执行 npm install`;
  return { ok: true, message: msg, skillName: skill.name, dirName: skill.name };
}
