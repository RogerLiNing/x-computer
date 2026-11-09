import { describe, expect, it } from 'vitest';
import { MANIFEST_FILE, manifestForMiniApp, validatePackageManifest } from './manifest.js';

const valid = {
  format: 1, id: 'com.roger.todo', name: '待办', version: '1.2.0', kinds: ['ui', 'tools'],
  ui: { entry: 'index.html' },
  tools: [{ name: 'todo.add', description: '添加待办', parameters: [{ name: 'text', type: 'string', description: '内容', required: true }], impl: { type: 'kv' } }],
  permissions: ['kv'],
};

describe('validatePackageManifest', () => {
  it('accepts a complete manifest and returns a frozen copy with defaults applied', () => {
    const result = validatePackageManifest(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.startupPolicy).toBe('on-demand');
    expect(result.manifest.tools?.[0].riskLevel).toBe('low');
    expect(Object.isFrozen(result.manifest)).toBe(true);
  });

  it('reports every problem instead of stopping at the first', () => {
    const result = validatePackageManifest({ format: 2, id: 'Bad Id!', name: '', version: '1', kinds: [], permissions: 'kv' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toMatch(/format/);
    expect(result.errors.join('\n')).toMatch(/id/);
    expect(result.errors.join('\n')).toMatch(/name/);
    expect(result.errors.join('\n')).toMatch(/version/);
    expect(result.errors.join('\n')).toMatch(/kinds/);
    expect(result.errors.join('\n')).toMatch(/permissions/);
  });

  it('requires the section that matches each declared kind and rejects unknown tool implementations', () => {
    expect(validatePackageManifest({ ...valid, kinds: ['ui'], ui: undefined }).ok).toBe(false);
    expect(validatePackageManifest({ ...valid, kinds: ['skill'] }).ok).toBe(false);
    const badImpl = validatePackageManifest({ ...valid, tools: [{ ...valid.tools[0], impl: { type: 'node', entry: 'x.js' } }] });
    expect(badImpl.ok).toBe(false);
    const badName = validatePackageManifest({ ...valid, tools: [{ ...valid.tools[0], name: 'x.create_app' }] });
    expect(badName.ok).toBe(false);
    const undeclared = validatePackageManifest({ ...valid, tools: [{ ...valid.tools[0], impl: { type: 'http', url: 'https://api.example.com/x' } }] });
    expect(undeclared.ok).toBe(false);
    expect(validatePackageManifest({ ...valid, permissions: ['kv', 'network:api.example.com'], tools: [{ ...valid.tools[0], impl: { type: 'http', url: 'https://api.example.com/x' } }] }).ok).toBe(true);
  });

  it('rejects entry paths that escape the package directory and unknown permissions', () => {
    expect(validatePackageManifest({ ...valid, ui: { entry: '../index.html' } }).ok).toBe(false);
    expect(validatePackageManifest({ ...valid, ui: { entry: '/etc/passwd' } }).ok).toBe(false);
    expect(validatePackageManifest({ ...valid, permissions: ['root'] }).ok).toBe(false);
    expect(validatePackageManifest({ ...valid, permissions: ['kv', 'network:api.example.com', 'fs.read:apps/com.roger.todo'] }).ok).toBe(true);
  });

  it('rejects a non-object input', () => {
    expect(validatePackageManifest(null).ok).toBe(false);
    expect(validatePackageManifest('x').ok).toBe(false);
  });
});

describe('manifestForMiniApp', () => {
  it('derives a ui-only manifest for a legacy mini app', () => {
    const manifest = manifestForMiniApp({ id: 'counter', name: '计数器', path: 'apps/counter' });
    expect(manifest).toMatchObject({ format: 1, id: 'counter', name: '计数器', version: '0.1.0', kinds: ['ui'], ui: { entry: 'index.html' }, permissions: ['kv'] });
    expect(validatePackageManifest(manifest).ok).toBe(true);
    expect(MANIFEST_FILE).toBe('x-package.json');
  });
});
