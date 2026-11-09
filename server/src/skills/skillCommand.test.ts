import { describe, expect, it } from 'vitest';
import { expandSkillCommand } from './skillCommand.js';

const load = (name: string) => (name === 'pdf-tools' ? { name, description: 'pdf', content: '# PDF 工具\n先读 references', dirName: 'pdf-tools' } : null);

describe('expandSkillCommand', () => {
  it('replaces a /skill command with the skill body and the request', () => {
    const out = expandSkillCommand([{ role: 'system', content: 's' }, { role: 'user', content: '/skill:pdf-tools 提取 report.pdf' }], 'u', load);
    expect(out[1].content).toContain('Skill「pdf-tools」');
    expect(out[1].content).toContain('先读 references');
    expect(out[1].content).toContain('提取 report.pdf');
    expect(out[0].content).toBe('s');
  });

  it('tells the model when the skill is missing and leaves ordinary messages alone', () => {
    const missing = expandSkillCommand([{ role: 'user', content: '/skill:nope 做事' }], 'u', load);
    expect(missing[0].content).toContain('没有这个 Skill');
    const plain = [{ role: 'user' as const, content: '你好' }];
    expect(expandSkillCommand(plain, 'u', load)).toEqual(plain);
  });
});
