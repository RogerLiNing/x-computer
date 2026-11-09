import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { NodeLabel, NodeMetrics, NodeSpecs } from '../../../shared/src/nodeProtocol.js';
import type { AppDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export interface NodeRecord {
  id: string;
  userId: string;
  name: string;
  labels: NodeLabel[];
  specs?: NodeSpecs;
  metrics?: NodeMetrics;
  lastSeenAt?: number;
  createdAt: number;
}

export interface EnrollToken { token: string; expiresAt: number }
export interface Enrollment { node: NodeRecord; nodeKey: string }

interface NodeRow { id: string; user_id: string; name: string; labels_json: string; key_hash: string; specs_json: string | null; metrics_json: string | null; last_seen_at: number | null; created_at: number }
interface TokenRow { token_hash: string; user_id: string; name: string; labels_json: string; expires_at: number }

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const NAME = /^[\w一-鿿][\w一-鿿 .-]{0,63}$/;
const LABEL = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const ENROLL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function toRecord(row: NodeRow): NodeRecord {
  return { id: row.id, userId: row.user_id, name: row.name, labels: parseJson<NodeLabel[]>(row.labels_json, []), ...(row.specs_json ? { specs: parseJson<NodeSpecs | undefined>(row.specs_json, undefined) } : {}), ...(row.metrics_json ? { metrics: parseJson<NodeMetrics | undefined>(row.metrics_json, undefined) } : {}), ...(row.last_seen_at ? { lastSeenAt: Number(row.last_seen_at) } : {}), createdAt: Number(row.created_at) };
}

export function normalizeLabels(labels: unknown): NodeLabel[] {
  if (!Array.isArray(labels)) return [];
  return [...new Set(labels.filter((label): label is string => typeof label === 'string').map((label) => label.trim().toLowerCase()).filter((label) => LABEL.test(label)))].slice(0, 16);
}

/**
 * Nodes a user owns. Enrollment is a two-step handshake: the user mints a short-lived token in X,
 * the node presents it once and receives a long-lived key. Only hashes are stored.
 */
export class NodeRegistry {
  private readonly ready: Promise<void>;

  constructor(private readonly db: AppDatabase) {
    this.ready = (async () => {
      await db.run('CREATE TABLE IF NOT EXISTS x_nodes (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, name VARCHAR(128) NOT NULL, labels_json TEXT NOT NULL, key_hash VARCHAR(64) NOT NULL, specs_json TEXT NULL, metrics_json TEXT NULL, last_seen_at BIGINT NULL, created_at BIGINT NOT NULL)');
      await db.run('CREATE TABLE IF NOT EXISTS x_node_enroll_tokens (token_hash VARCHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, name VARCHAR(128) NOT NULL, labels_json TEXT NOT NULL, expires_at BIGINT NOT NULL)');
    })();
    void this.ready.catch((error: unknown) => serverLogger.warn('nodes', '创建节点表失败', error instanceof Error ? error.message : String(error)));
  }

  async createEnrollToken(userId: string, input: { name: string; labels?: unknown }): Promise<EnrollToken> {
    await this.ready;
    const name = String(input.name ?? '').trim();
    if (!NAME.test(name)) throw new Error('节点名只能用字母、数字、中文、空格、点和短横线，最长 64 个字符');
    const token = `xn_${randomBytes(24).toString('base64url')}`;
    const expiresAt = Date.now() + ENROLL_TOKEN_TTL_MS;
    await this.db.run('DELETE FROM x_node_enroll_tokens WHERE expires_at < ?', [Date.now()]);
    await this.db.run('INSERT INTO x_node_enroll_tokens (token_hash, user_id, name, labels_json, expires_at) VALUES (?, ?, ?, ?, ?)', [hash(token), userId, name, JSON.stringify(normalizeLabels(input.labels)), expiresAt]);
    return { token, expiresAt };
  }

  /** Consumes the token and registers the node; the returned key is shown once. */
  async enroll(token: string, specs?: NodeSpecs): Promise<Enrollment> {
    await this.ready;
    const [row] = await this.db.query<TokenRow>('SELECT * FROM x_node_enroll_tokens WHERE token_hash = ?', [hash(token)]);
    if (!row) throw new Error('注册令牌无效');
    await this.db.run('DELETE FROM x_node_enroll_tokens WHERE token_hash = ?', [row.token_hash]);
    if (Number(row.expires_at) < Date.now()) throw new Error('注册令牌已过期，请在 X 里重新生成');
    const nodeKey = `xk_${randomBytes(32).toString('base64url')}`;
    const node: NodeRecord = { id: `node-${randomUUID().slice(0, 12)}`, userId: row.user_id, name: row.name, labels: parseJson<NodeLabel[]>(row.labels_json, []), ...(specs ? { specs } : {}), createdAt: Date.now() };
    await this.db.run('INSERT INTO x_nodes (id, user_id, name, labels_json, key_hash, specs_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [node.id, node.userId, node.name, JSON.stringify(node.labels), hash(nodeKey), specs ? JSON.stringify(specs) : null, node.createdAt]);
    return { node, nodeKey };
  }

  async authenticate(nodeId: string, nodeKey: string): Promise<NodeRecord | undefined> {
    await this.ready;
    const [row] = await this.db.query<NodeRow>('SELECT * FROM x_nodes WHERE id = ?', [nodeId]);
    if (!row || row.key_hash !== hash(nodeKey)) return undefined;
    return toRecord(row);
  }

  async list(userId: string): Promise<NodeRecord[]> {
    await this.ready;
    return (await this.db.query<NodeRow>('SELECT * FROM x_nodes WHERE user_id = ? ORDER BY created_at ASC', [userId])).map(toRecord);
  }

  async get(userId: string, nodeId: string): Promise<NodeRecord | undefined> {
    await this.ready;
    const [row] = await this.db.query<NodeRow>('SELECT * FROM x_nodes WHERE id = ? AND user_id = ?', [nodeId, userId]);
    return row ? toRecord(row) : undefined;
  }

  /** Finds a node by id, exact name, or a label the node carries. */
  async resolve(userId: string, ref: string): Promise<NodeRecord | undefined> {
    const needle = ref.trim();
    const nodes = await this.list(userId);
    return nodes.find((node) => node.id === needle) ?? nodes.find((node) => node.name === needle) ?? nodes.find((node) => node.labels.includes(needle.toLowerCase()));
  }

  async touch(nodeId: string, update: { specs?: NodeSpecs; labels?: NodeLabel[]; metrics?: NodeMetrics }): Promise<void> {
    await this.ready;
    const sets = ['last_seen_at = ?'];
    const params: Array<string | number | null> = [Date.now()];
    if (update.specs) { sets.push('specs_json = ?'); params.push(JSON.stringify(update.specs)); }
    if (update.labels) { sets.push('labels_json = ?'); params.push(JSON.stringify(normalizeLabels(update.labels))); }
    if (update.metrics) { sets.push('metrics_json = ?'); params.push(JSON.stringify(update.metrics)); }
    await this.db.run(`UPDATE x_nodes SET ${sets.join(', ')} WHERE id = ?`, [...params, nodeId]);
  }

  async remove(userId: string, nodeId: string): Promise<boolean> {
    await this.ready;
    if (!(await this.get(userId, nodeId))) return false;
    await this.db.run('DELETE FROM x_nodes WHERE id = ? AND user_id = ?', [nodeId, userId]);
    return true;
  }
}
