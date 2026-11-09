import type { XPackageManifest, XPackageRecord, XPackageSource } from '@x-computer/shared';
import type { AppDatabase } from '../db/database.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { MANIFEST_FILE, manifestForMiniApp, validatePackageManifest } from './manifest.js';

interface Row { user_id: string; pkg_id: string; manifest_json: string; enabled: number; source: string; path: string | null; installed_at: number; updated_at: number }

export interface InstallOptions { source: XPackageSource; path?: string }

const LEGACY_APPS_KEY = 'x_mini_apps';
const SOURCES: XPackageSource[] = ['generated', 'installed', 'space', 'catalog', 'builtin'];

function toRecord(row: Row): XPackageRecord | undefined {
  const parsed = validatePackageManifest(JSON.parse(row.manifest_json));
  if (!parsed.ok) { serverLogger.warn('packages', `忽略损坏的包记录 ${row.pkg_id}`, parsed.errors.join('; ')); return undefined; }
  const source = SOURCES.includes(row.source as XPackageSource) ? (row.source as XPackageSource) : 'installed';
  return { userId: row.user_id, manifest: parsed.manifest, enabled: Number(row.enabled) === 1, source, ...(row.path ? { path: row.path } : {}), installedAt: Number(row.installed_at), updatedAt: Number(row.updated_at) };
}

/**
 * The per-user table of installed packages. Phase one covers manifest validation, install/enable/remove,
 * and a one-time migration of the legacy mini-app list. Tool registration from `tools` packages comes next.
 */
export class PackageRegistry {
  private readonly ready: Promise<void>;

  constructor(private readonly db: AppDatabase) {
    const text = db.getDialect() === 'mysql' ? 'MEDIUMTEXT' : 'TEXT';
    this.ready = db.run(`CREATE TABLE IF NOT EXISTS x_packages (user_id VARCHAR(128) NOT NULL, pkg_id VARCHAR(128) NOT NULL, manifest_json ${text} NOT NULL, enabled TINYINT NOT NULL DEFAULT 1, source VARCHAR(32) NOT NULL, path VARCHAR(512) NULL, installed_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, pkg_id))`);
    void this.ready.catch((error: unknown) => serverLogger.warn('packages', '创建 x_packages 表失败', error instanceof Error ? error.message : String(error)));
  }

  async list(userId: string): Promise<XPackageRecord[]> {
    await this.ready;
    const rows = await this.db.query<Row>('SELECT * FROM x_packages WHERE user_id = ? ORDER BY installed_at ASC, pkg_id ASC', [userId]);
    return rows.map(toRecord).filter((record): record is XPackageRecord => record !== undefined);
  }

  async get(userId: string, pkgId: string): Promise<XPackageRecord | undefined> {
    await this.ready;
    const rows = await this.db.query<Row>('SELECT * FROM x_packages WHERE user_id = ? AND pkg_id = ?', [userId, pkgId]);
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  /** Validates, then inserts or replaces the manifest. A reinstall keeps the user's enabled choice. */
  async install(userId: string, input: unknown, options: InstallOptions): Promise<XPackageRecord> {
    const parsed = validatePackageManifest(input);
    if (!parsed.ok) throw new Error(`包清单无效：${parsed.errors.join('；')}`);
    await this.ready;
    const now = Date.now();
    const existing = await this.get(userId, parsed.manifest.id);
    const enabled = existing?.enabled ?? true;
    const installedAt = existing?.installedAt ?? now;
    const path = options.path ?? existing?.path ?? null;
    const json = JSON.stringify(parsed.manifest);
    if (existing) {
      await this.db.run('UPDATE x_packages SET manifest_json = ?, enabled = ?, source = ?, path = ?, updated_at = ? WHERE user_id = ? AND pkg_id = ?', [json, enabled ? 1 : 0, options.source, path, now, userId, parsed.manifest.id]);
    } else {
      await this.db.run('INSERT INTO x_packages (user_id, pkg_id, manifest_json, enabled, source, path, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [userId, parsed.manifest.id, json, 1, options.source, path, now, now]);
    }
    return { userId, manifest: parsed.manifest, enabled, source: options.source, ...(path ? { path } : {}), installedAt, updatedAt: now };
  }

  async setEnabled(userId: string, pkgId: string, enabled: boolean): Promise<boolean> {
    await this.ready;
    if (!(await this.get(userId, pkgId))) return false;
    await this.db.run('UPDATE x_packages SET enabled = ?, updated_at = ? WHERE user_id = ? AND pkg_id = ?', [enabled ? 1 : 0, Date.now(), userId, pkgId]);
    return true;
  }

  /**
   * Removes the registration only; files and source snapshots stay so the package can be restored.
   * The legacy mini-app entry goes too, otherwise the next migration would resurrect the package.
   */
  async remove(userId: string, pkgId: string): Promise<boolean> {
    await this.ready;
    if (!(await this.get(userId, pkgId))) return false;
    await this.db.run('DELETE FROM x_packages WHERE user_id = ? AND pkg_id = ?', [userId, pkgId]);
    const legacy = await this.readLegacyApps(userId);
    if (legacy.some((app) => app.id === pkgId)) {
      await this.db.setConfig(userId, LEGACY_APPS_KEY, JSON.stringify(legacy.filter((app) => app.id !== pkgId)));
    }
    return true;
  }

  /** Enabled ui packages in the shape the desktop and `x.list_apps` already consume. */
  async listApps(userId: string): Promise<Array<{ id: string; name: string; path: string }>> {
    return (await this.list(userId))
      .filter((record) => record.enabled && record.manifest.kinds.includes('ui') && record.path)
      .map((record) => ({ id: record.manifest.id, name: record.manifest.name, path: record.path! }));
  }

  /**
   * Registers every legacy `x_mini_apps` entry that is not in the table yet. A manifest file the model
   * already wrote wins over the derived default; otherwise the default is written beside the app.
   */
  async migrateMiniApps(userId: string, sandbox: SandboxFS): Promise<XPackageRecord[]> {
    const legacy = await this.readLegacyApps(userId);
    if (legacy.length === 0) return [];
    const known = new Set((await this.list(userId)).map((record) => record.manifest.id));
    const migrated: XPackageRecord[] = [];
    for (const app of legacy) {
      if (known.has(app.id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(app.id)) continue;
      const manifest = await this.readOrWriteManifest(sandbox, app);
      if (!manifest) continue;
      try {
        migrated.push(await this.install(userId, manifest, { source: 'generated', path: app.path }));
      } catch (error: unknown) {
        serverLogger.warn('packages', `迁移应用 ${app.id} 失败`, error instanceof Error ? error.message : String(error));
      }
    }
    return migrated;
  }

  private async readLegacyApps(userId: string): Promise<Array<{ id: string; name: string; path: string }>> {
    const raw = await this.db.getConfig(userId, LEGACY_APPS_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is { id: string; name: string; path: string } =>
        !!item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
        && typeof (item as { name?: unknown }).name === 'string' && typeof (item as { path?: unknown }).path === 'string') : [];
    } catch {
      return [];
    }
  }

  private async readOrWriteManifest(sandbox: SandboxFS, app: { id: string; name: string; path: string }): Promise<XPackageManifest | undefined> {
    const file = `${app.path.replace(/\/?$/, '')}/${MANIFEST_FILE}`;
    try {
      if (await sandbox.exists(file)) {
        const parsed = validatePackageManifest(JSON.parse(await sandbox.read(file)));
        if (parsed.ok && parsed.manifest.id === app.id) return parsed.manifest;
        serverLogger.warn('packages', `应用 ${app.id} 的清单无效，改用默认清单`, parsed.ok ? 'id 不匹配' : parsed.errors.join('; '));
      }
      const manifest = manifestForMiniApp(app);
      // A registration whose folder is gone stays recoverable from its source snapshot; do not recreate the folder.
      if (await sandbox.exists(app.path)) await sandbox.writeOverwrite(file, JSON.stringify(manifest, null, 2));
      return manifest;
    } catch (error: unknown) {
      serverLogger.warn('packages', `无法读写应用 ${app.id} 的清单`, error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }
}
