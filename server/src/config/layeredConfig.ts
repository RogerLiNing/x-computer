import fs from 'node:fs';
import path from 'node:path';

/**
 * Configuration is assembled from ordered layers, each a JSON object deep-merged over the previous:
 *   1. .x-config.json                      deployment defaults
 *   2. .x-config.<profile>.json            per runtime profile (X_COMPUTER_PROFILE)
 *   3. .x-config.local.json                machine-local patch, never committed
 *   4. X_CONFIG_PATCH_JSON                 an inline JSON patch from the environment
 * Arrays and scalars replace; objects merge. `null` deletes a key from the layer below.
 */
export interface ConfigLayer { name: string; source: string; value: Record<string, unknown> }

export const LOCAL_CONFIG_SUFFIX = '.local';
export const CONFIG_PATCH_ENV = 'X_CONFIG_PATCH_JSON';
const SECRET_KEY = /(key|secret|token|password|passwd|credential)/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Deep merge with "null deletes"; never mutates its inputs. */
export function mergeConfigLayer(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) { delete out[key]; continue; }
    const existing = out[key];
    out[key] = isObject(existing) && isObject(value) ? mergeConfigLayer(existing, value) : value;
  }
  return out;
}

/** Layer file names derived from the base config path, in application order (base excluded). */
export function layerPathsFor(basePath: string, profile: string | undefined): Array<{ name: string; path: string }> {
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const stem = path.basename(basePath, ext);
  const layers: Array<{ name: string; path: string }> = [];
  if (profile && /^[a-z][a-z0-9-]{0,31}$/i.test(profile)) layers.push({ name: `profile:${profile}`, path: path.join(dir, `${stem}.${profile}${ext}`) });
  layers.push({ name: 'local', path: path.join(dir, `${stem}${LOCAL_CONFIG_SUFFIX}${ext}`) });
  return layers;
}

function readJsonLayer(name: string, filePath: string): ConfigLayer | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!isObject(parsed)) throw new Error('顶层必须是 JSON 对象');
    return { name, source: filePath, value: parsed };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    console.warn(`[x-computer] 配置层 ${name} 无法读取（${filePath}）：`, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export function envPatchLayer(env: NodeJS.ProcessEnv = process.env): ConfigLayer | undefined {
  const raw = env[CONFIG_PATCH_ENV]?.trim();
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) throw new Error('必须是 JSON 对象');
    return { name: 'env', source: CONFIG_PATCH_ENV, value: parsed };
  } catch (error: unknown) {
    console.warn(`[x-computer] ${CONFIG_PATCH_ENV} 不是合法的 JSON 对象：`, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export interface LayeredConfig { layers: ConfigLayer[]; value: Record<string, unknown> }

/** Reads every layer above `base` and folds them in order. */
export function assembleLayers(base: ConfigLayer, options: { profile?: string; env?: NodeJS.ProcessEnv } = {}): LayeredConfig {
  const layers: ConfigLayer[] = [base];
  for (const candidate of layerPathsFor(base.source, options.profile)) {
    const layer = readJsonLayer(candidate.name, candidate.path);
    if (layer) layers.push(layer);
  }
  const env = envPatchLayer(options.env);
  if (env) layers.push(env);
  return { layers, value: layers.reduce<Record<string, unknown>>((acc, layer) => mergeConfigLayer(acc, layer.value), {}) };
}

/** A copy safe to show in an admin page: anything that looks like a credential is masked. */
export function redactConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConfig);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) && typeof item === 'string' && item ? '••••••' : redactConfig(item)]));
}

/** Watches the base config and its layer files; calls `onChange` once per change burst. */
export function watchConfigFiles(basePath: string, profile: string | undefined, onChange: (changed: string) => void): () => void {
  const files = [basePath, ...layerPathsFor(basePath, profile).map((layer) => layer.path)];
  const watchers: fs.FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  for (const file of files) {
    try {
      const watcher = fs.watch(path.dirname(file), (_event, name) => {
        if (name && path.join(path.dirname(file), String(name)) !== file) return;
        clearTimeout(timer);
        timer = setTimeout(() => onChange(file), 300);
      });
      watcher.on('error', () => {});
      watchers.push(watcher);
    } catch {
      // A missing directory cannot change under us; nothing to watch.
    }
  }
  return () => { clearTimeout(timer); for (const watcher of watchers) watcher.close(); };
}
