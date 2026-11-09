import JSZip from 'jszip';
import type { XPackageManifest } from '@x-computer/shared';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import { MANIFEST_FILE, validatePackageManifest } from './manifest.js';

/**
 * A package catalog is a static JSON index (format 1) listing installable packages. Each version
 * points at a zip whose root (or single top-level folder) holds `x-package.json`. The index is third-party
 * content: titles and descriptions are shown as data, and the zip is validated before anything is written.
 */
export interface CatalogVersion { version: string; source: { type: 'zip'; url: string }; engines?: { 'x-computer'?: string } }
export interface CatalogEntry { id: string; name: string; description?: string; icon?: string; author?: string; versions: CatalogVersion[] }
export interface CatalogIndex { url: string; title: string; packages: CatalogEntry[] }

export const CATALOG_URLS_ENV = 'X_PACKAGE_CATALOG_URLS';
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_FILES = 500;
const FETCH_TIMEOUT_MS = 20_000;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ID = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/;

export function configuredCatalogUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env[CATALOG_URLS_ENV] ?? '').split(',').map((url) => url.trim()).filter((url) => /^https?:\/\//.test(url));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseVersion(value: unknown): CatalogVersion | undefined {
  if (!isRecord(value) || typeof value.version !== 'string' || !SEMVER.test(value.version)) return undefined;
  if (!isRecord(value.source) || value.source.type !== 'zip' || typeof value.source.url !== 'string' || !/^https?:\/\//.test(value.source.url)) return undefined;
  const engines = isRecord(value.engines) && typeof value.engines['x-computer'] === 'string' ? { 'x-computer': value.engines['x-computer'] } : undefined;
  return { version: value.version, source: { type: 'zip', url: value.source.url }, ...(engines ? { engines } : {}) };
}

function parseEntry(value: unknown): CatalogEntry | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !ID.test(value.id) || typeof value.name !== 'string' || !value.name) return undefined;
  const versions = Array.isArray(value.versions) ? value.versions.map(parseVersion).filter((item): item is CatalogVersion => !!item) : [];
  if (versions.length === 0) return undefined;
  const text = (key: string) => (typeof value[key] === 'string' ? { [key]: (value[key] as string).slice(0, 1024) } : {});
  return { id: value.id, name: value.name.slice(0, 255), ...text('description'), ...text('icon'), ...text('author'), versions };
}

/** Parses an index document; entries that do not fit the format are dropped rather than failing the whole index. */
export function parseCatalogIndex(url: string, value: unknown): CatalogIndex {
  if (!isRecord(value) || value.format !== 1 || !Array.isArray(value.packages)) throw new Error('目录格式不正确（需要 format: 1 与 packages 数组）');
  const packages = value.packages.map(parseEntry).filter((item): item is CatalogEntry => !!item);
  return { url, title: typeof value.title === 'string' ? value.title : url, packages };
}

async function fetchBounded(fetchImpl: typeof fetch, url: string, maxBytes: number): Promise<Buffer> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  if (!response.ok) throw new Error(`下载失败：${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`);
  return buffer;
}

export class PackageCatalog {
  constructor(private readonly urls: string[], private readonly fetchImpl: typeof fetch = fetch) {}

  get configured(): boolean { return this.urls.length > 0; }

  async indexes(): Promise<CatalogIndex[]> {
    const results = await Promise.allSettled(this.urls.map(async (url) => parseCatalogIndex(url, JSON.parse((await fetchBounded(this.fetchImpl, url, MAX_INDEX_BYTES)).toString('utf8')))));
    return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  }

  async search(query: string): Promise<Array<CatalogEntry & { catalog: string }>> {
    const needle = query.trim().toLowerCase();
    const entries = (await this.indexes()).flatMap((index) => index.packages.map((entry) => ({ ...entry, catalog: index.title })));
    if (!needle) return entries;
    return entries.filter((entry) => [entry.id, entry.name, entry.description ?? '', entry.author ?? ''].some((field) => field.toLowerCase().includes(needle)));
  }

  async find(id: string, version?: string): Promise<{ entry: CatalogEntry; version: CatalogVersion } | undefined> {
    for (const index of await this.indexes()) {
      const entry = index.packages.find((item) => item.id === id);
      if (!entry) continue;
      const chosen = version ? entry.versions.find((item) => item.version === version) : latest(entry.versions);
      if (chosen) return { entry, version: chosen };
    }
    return undefined;
  }

  /** Downloads the zip, checks it, and writes its files under `apps/<id>/`. Returns the validated manifest. */
  async installZip(fs: SandboxFS, id: string, version: CatalogVersion): Promise<{ manifest: XPackageManifest; path: string }> {
    const zip = await JSZip.loadAsync(await fetchBounded(this.fetchImpl, version.source.url, MAX_ZIP_BYTES));
    const files = Object.values(zip.files).filter((file) => !file.dir);
    if (files.length === 0 || files.length > MAX_ZIP_FILES) throw new Error('压缩包为空或文件过多');
    const prefix = commonTopFolder(files.map((file) => file.name));
    const manifestFile = files.find((file) => file.name === `${prefix}${MANIFEST_FILE}`);
    if (!manifestFile) throw new Error(`压缩包里缺少 ${MANIFEST_FILE}`);
    const parsed = validatePackageManifest(JSON.parse(await manifestFile.async('string')));
    if (!parsed.ok) throw new Error(`包清单无效：${parsed.errors.join('；')}`);
    if (parsed.manifest.id !== id) throw new Error('压缩包里的包 id 与目录条目不一致');
    if (parsed.manifest.version !== version.version) throw new Error('压缩包里的版本与目录条目不一致');
    const target = `apps/${id}`;
    for (const file of files) {
      const relative = file.name.slice(prefix.length).replace(/\\/g, '/');
      if (!relative || relative.split('/').some((part) => part === '..' || part === '' || part.startsWith('.'))) throw new Error(`压缩包包含不允许的路径：${file.name}`);
      await fs.writeBinary(`${target}/${relative}`, await file.async('nodebuffer'));
    }
    return { manifest: parsed.manifest, path: target };
  }
}

function latest(versions: CatalogVersion[]): CatalogVersion | undefined {
  return [...versions].sort((a, b) => compareSemver(b.version, a.version))[0];
}

function compareSemver(a: string, b: string): number {
  const [ac, bc] = [a.split('-')[0].split('.').map(Number), b.split('-')[0].split('.').map(Number)];
  for (let i = 0; i < 3; i++) if (ac[i] !== bc[i]) return ac[i] - bc[i];
  return (a.includes('-') ? 0 : 1) - (b.includes('-') ? 0 : 1);
}

/** `pkg/x-package.json, pkg/index.html` → `pkg/`; files at the root → ``. */
function commonTopFolder(names: string[]): string {
  const tops = new Set(names.map((name) => (name.includes('/') ? name.slice(0, name.indexOf('/') + 1) : '')));
  if (tops.size === 1) return [...tops][0];
  return '';
}
