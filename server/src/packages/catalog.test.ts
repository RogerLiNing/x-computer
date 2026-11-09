import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { PackageCatalog, configuredCatalogUrls, parseCatalogIndex } from './catalog.js';

const manifest = { format: 1, id: 'weather', name: '天气', version: '1.2.0', kinds: ['ui'], ui: { entry: 'index.html' }, permissions: [] };

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function fakeFetch(routes: Record<string, () => Promise<Buffer | string>>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const route = routes[url];
    if (!route) return new Response('missing', { status: 404 });
    const body = await route();
    return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200 });
  }) as unknown as typeof fetch;
}

const index = {
  format: 1, title: '家庭目录',
  packages: [
    { id: 'weather', name: '天气', description: '看天气', versions: [{ version: '1.0.0', source: { type: 'zip', url: 'https://cat.example/weather-1.0.0.zip' } }, { version: '1.2.0', source: { type: 'zip', url: 'https://cat.example/weather-1.2.0.zip' } }] },
    { id: 'bad id', name: 'x', versions: [] },
    { id: 'nover', name: 'y', versions: [{ version: 'abc', source: { type: 'zip', url: 'https://x' } }] },
  ],
};

describe('package catalog', () => {
  it('parses an index, dropping malformed entries, and searches across catalogs', async () => {
    const parsed = parseCatalogIndex('https://cat.example/index.json', index);
    expect(parsed.packages.map((entry) => entry.id)).toEqual(['weather']);
    expect(() => parseCatalogIndex('u', { format: 2 })).toThrow();
    const catalog = new PackageCatalog(['https://cat.example/index.json'], fakeFetch({ 'https://cat.example/index.json': async () => JSON.stringify(index) }));
    expect((await catalog.search('天气')).map((entry) => entry.catalog)).toEqual(['家庭目录']);
    expect(await catalog.search('nothing')).toEqual([]);
    expect((await catalog.find('weather'))?.version.version).toBe('1.2.0');
    expect((await catalog.find('weather', '1.0.0'))?.version.version).toBe('1.0.0');
  });

  it('installs a zip into apps/<id>, accepting a single top-level folder and refusing mismatches', async () => {
    const fs = new SandboxFS(await mkdtemp(path.join(os.tmpdir(), 'catalog-'))); await fs.init();
    const catalog = new PackageCatalog(['https://cat.example/index.json'], fakeFetch({
      'https://cat.example/index.json': async () => JSON.stringify(index),
      'https://cat.example/weather-1.2.0.zip': () => zipOf({ 'weather/x-package.json': JSON.stringify(manifest), 'weather/index.html': '<h1>w</h1>', 'weather/assets/a.txt': 'a' }),
      'https://cat.example/weather-1.0.0.zip': () => zipOf({ 'x-package.json': JSON.stringify({ ...manifest, version: '9.9.9' }), 'index.html': '' }),
    }));
    const found = await catalog.find('weather');
    const installed = await catalog.installZip(fs, 'weather', found!.version);
    expect(installed).toMatchObject({ path: 'apps/weather', manifest: { id: 'weather', version: '1.2.0' } });
    expect(await fs.read('apps/weather/index.html')).toBe('<h1>w</h1>');
    expect(await fs.read('apps/weather/assets/a.txt')).toBe('a');
    await expect(catalog.installZip(fs, 'weather', (await catalog.find('weather', '1.0.0'))!.version)).rejects.toThrow(/版本/);
  });

  it('reads catalog urls from the environment', () => {
    expect(configuredCatalogUrls({ X_PACKAGE_CATALOG_URLS: 'https://a.example/i.json, ftp://nope, https://b.example/i.json' })).toEqual(['https://a.example/i.json', 'https://b.example/i.json']);
    expect(configuredCatalogUrls({})).toEqual([]);
    expect(new PackageCatalog([]).configured).toBe(false);
  });
});
