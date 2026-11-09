import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assembleLayers, envPatchLayer, layerPathsFor, mergeConfigLayer, redactConfig } from './layeredConfig.js';

describe('layered config', () => {
  it('deep merges objects, replaces arrays and scalars, and deletes on null', () => {
    const merged = mergeConfigLayer(
      { llm_config: { providers: [{ id: 'a' }], defaultByModality: { chat: { providerId: 'a', modelId: 'x' } } }, auth: { allowRegister: true }, extra: 1 },
      { llm_config: { providers: [{ id: 'b' }], defaultByModality: { chat: { modelId: 'y' } } }, auth: null },
    );
    expect(merged).toEqual({ llm_config: { providers: [{ id: 'b' }], defaultByModality: { chat: { providerId: 'a', modelId: 'y' } } }, extra: 1 });
  });

  it('derives profile and local layer paths and applies them in order over the base', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'layers-'));
    const base = path.join(dir, '.x-config.json');
    await writeFile(base, JSON.stringify({ runtime_profile: 'lightweight', llm_config: { autoRoute: { cheap: { providerId: 'a', modelId: 'a1' }, strong: { providerId: 'b', modelId: 'b1' } } } }));
    await writeFile(path.join(dir, '.x-config.balanced.json'), JSON.stringify({ runtime_profile: 'balanced' }));
    await writeFile(path.join(dir, '.x-config.local.json'), JSON.stringify({ llm_config: { autoRoute: { strong: { modelId: 'b2' } } } }));
    expect(layerPathsFor(base, 'balanced').map((layer) => path.basename(layer.path))).toEqual(['.x-config.balanced.json', '.x-config.local.json']);
    const result = assembleLayers({ name: 'base', source: base, value: JSON.parse(await (await import('node:fs/promises')).readFile(base, 'utf8')) }, { profile: 'balanced', env: { X_CONFIG_PATCH_JSON: '{"tool_loading_mode":"all"}' } });
    expect(result.layers.map((layer) => layer.name)).toEqual(['base', 'profile:balanced', 'local', 'env']);
    expect(result.value).toMatchObject({ runtime_profile: 'balanced', tool_loading_mode: 'all', llm_config: { autoRoute: { strong: { providerId: 'b', modelId: 'b2' } } } });
    expect(envPatchLayer({ X_CONFIG_PATCH_JSON: 'not json' })).toBeUndefined();
    expect(envPatchLayer({})).toBeUndefined();
  });

  it('redacts credential-looking values', () => {
    expect(redactConfig({ llm_config: { providers: [{ id: 'a', apiKey: 'sk-1', baseUrl: 'https://x' }] }, email: { password: 'p', host: 'h' } }))
      .toEqual({ llm_config: { providers: [{ id: 'a', apiKey: '••••••', baseUrl: 'https://x' }] }, email: { password: '••••••', host: 'h' } });
  });
});
