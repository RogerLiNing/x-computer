import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface NodeConfig {
  serverUrl: string;
  nodeId: string;
  nodeKey: string;
  name: string;
  labels: string[];
  /** Where tasks read and write files. */
  workspace: string;
}

export const AGENT_VERSION = '0.1.0';

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.X_NODE_HOME?.trim() || path.join(os.homedir(), '.x-node');
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configDir(env), 'config.json');
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<NodeConfig | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(env), 'utf8')) as Partial<NodeConfig>;
    if (typeof parsed.serverUrl !== 'string' || typeof parsed.nodeId !== 'string' || typeof parsed.nodeKey !== 'string') return undefined;
    return { serverUrl: parsed.serverUrl, nodeId: parsed.nodeId, nodeKey: parsed.nodeKey, name: parsed.name ?? os.hostname(), labels: Array.isArray(parsed.labels) ? parsed.labels.filter((label): label is string => typeof label === 'string') : [], workspace: parsed.workspace ?? path.join(configDir(env), 'workspace') };
  } catch {
    return undefined;
  }
}

export async function saveConfig(config: NodeConfig, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const file = configPath(env);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.mkdir(config.workspace, { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  return file;
}

/** Turns the X base URL the person typed into the node WebSocket URL. */
export function websocketUrl(serverUrl: string, wsPath: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = wsPath;
  url.search = '';
  url.hash = '';
  return url.toString();
}
