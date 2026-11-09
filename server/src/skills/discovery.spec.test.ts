import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverSkills, parseSkillCommand, parseSkillSpecFields } from './discovery.js';

describe('Agent Skills specification support', () => {
  it('parses the specification fields from front matter', () => {
    expect(parseSkillSpecFields('name: x\nlicense: MIT\ncompatibility: node>=22\nallowed-tools: [file.read, web_search]\ndisable-model-invocation: true'))
      .toEqual({ license: 'MIT', compatibility: 'node>=22', allowedTools: ['file.read', 'web_search'], disableModelInvocation: true });
    expect(parseSkillSpecFields('name: y\nallowed-tools: file.read file.write')).toEqual({ allowedTools: ['file.read', 'file.write'] });
    expect(parseSkillSpecFields('name: z')).toEqual({});
  });

  it('discovers nested skill directories and carries the spec fields', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'skills-'));
    mkdirSync(path.join(root, 'group', 'deep'), { recursive: true });
    writeFileSync(path.join(root, 'group', 'deep', 'SKILL.md'), '---\nname: deep-skill\ndescription: nested\ndisable-model-invocation: true\n---\nbody');
    mkdirSync(path.join(root, 'plain'));
    writeFileSync(path.join(root, 'plain', 'SKILL.md'), '---\nname: plain\ndescription: top level\nlicense: MIT\n---\nbody');
    mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', 'x', 'SKILL.md'), '---\nname: ignored\ndescription: no\n---\n');
    const skills = discoverSkills(root).sort((a, b) => a.name.localeCompare(b.name));
    expect(skills.map((skill) => [skill.name, skill.dirName, skill.disableModelInvocation ?? false, skill.license])).toEqual([
      ['deep-skill', 'group/deep', true, undefined],
      ['plain', 'plain', false, 'MIT'],
    ]);
  });

  it('recognises explicit /skill:name commands', () => {
    expect(parseSkillCommand('/skill:pdf-tools extract report.pdf')).toEqual({ name: 'pdf-tools', args: 'extract report.pdf' });
    expect(parseSkillCommand('/skill:pdf-tools')).toEqual({ name: 'pdf-tools', args: '' });
    expect(parseSkillCommand('帮我 /skill:x')).toBeUndefined();
    expect(parseSkillCommand('/skill:../x')).toBeUndefined();
  });
});
