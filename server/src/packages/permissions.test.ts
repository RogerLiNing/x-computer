import { describe, expect, it } from 'vitest';
import { impliedPermission, isPackagePermission, missingPermissions, permissionCovers } from './permissions.js';

describe('package permissions', () => {
  it('derives the run-time permission from a tool implementation', () => {
    expect(impliedPermission({ type: 'kv' })).toBe('kv');
    expect(impliedPermission({ type: 'mcp', server: 's', tool: 't' })).toBe('mcp');
    expect(impliedPermission({ type: 'script', entry: 'run.py', runtime: 'python' })).toBe('script');
    expect(impliedPermission({ type: 'http', url: 'https://api.example.com/v1/x' })).toBe('network:api.example.com');
  });

  it('matches scoped permissions against bare or identical grants only', () => {
    expect(permissionCovers('network:api.example.com', ['network'])).toBe(true);
    expect(permissionCovers('network:api.example.com', ['network:api.example.com'])).toBe(true);
    expect(permissionCovers('network:api.example.com', ['network:other.example.com'])).toBe(false);
    expect(permissionCovers('network', ['network:api.example.com'])).toBe(false);
    expect(missingPermissions(['kv', 'network:a.b'], ['kv'])).toEqual(['network:a.b']);
  });

  it('recognises known permission names with optional scopes', () => {
    expect(isPackagePermission('fs.read:apps/todo')).toBe(true);
    expect(isPackagePermission('root')).toBe(false);
    expect(isPackagePermission('net work')).toBe(false);
  });
});
