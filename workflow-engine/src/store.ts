/**
 * 工作流存储：流程定义与实例，SQLite 持久化
 */

import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { WorkflowDefinition, WorkflowInstance } from './types.js';

export class WorkflowStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const p = dbPath ?? path.join(process.cwd(), 'workflow-data.sqlite');
    this.db = new Database(p);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_definitions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        nodes TEXT NOT NULL,
        edges TEXT NOT NULL,
        triggers TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_def_user ON workflow_definitions(user_id);

      CREATE TABLE IF NOT EXISTS workflow_instances (
        id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_node_ids TEXT NOT NULL,
        variables TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_inst_user ON workflow_instances(user_id);
      CREATE INDEX IF NOT EXISTS idx_inst_def ON workflow_instances(definition_id);
    `);
  }

  deploy(userId: string, def: WorkflowDefinition): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO workflow_definitions (id, user_id, name, version, nodes, edges, triggers, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM workflow_definitions WHERE id = ?), ?), ?)`,
      )
      .run(
        def.id,
        userId,
        def.name,
        def.version,
        JSON.stringify(def.nodes),
        JSON.stringify(def.edges),
        def.triggers ? JSON.stringify(def.triggers) : null,
        def.id,
        now,
        now,
      );
  }

  getDefinition(userId: string, definitionId: string): WorkflowDefinition | null {
    const row = this.db
      .prepare('SELECT * FROM workflow_definitions WHERE id = ? AND user_id = ?')
      .get(definitionId, userId) as { id: string; name: string; version: number; nodes: string; edges: string; triggers: string | null } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      nodes: JSON.parse(row.nodes),
      edges: JSON.parse(row.edges),
      triggers: row.triggers ? JSON.parse(row.triggers) : undefined,
    };
  }

  listDefinitions(userId: string): WorkflowDefinition[] {
    const rows = this.db.prepare('SELECT * FROM workflow_definitions WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Array<{
      id: string;
      name: string;
      version: number;
      nodes: string;
      edges: string;
      triggers: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      nodes: JSON.parse(r.nodes),
      edges: JSON.parse(r.edges),
      triggers: r.triggers ? JSON.parse(r.triggers) : undefined,
    }));
  }

  deleteDefinition(userId: string, definitionId: string): boolean {
    const r = this.db.prepare('DELETE FROM workflow_definitions WHERE id = ? AND user_id = ?').run(definitionId, userId);
    return r.changes > 0;
  }

  createInstance(definitionId: string, userId: string): string {
    const id = `inst-${uuid().slice(0, 8)}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO workflow_instances (id, definition_id, user_id, status, current_node_ids, variables, created_at, updated_at)
         VALUES (?, ?, ?, 'running', '[]', '{}', ?, ?)`,
      )
      .run(id, definitionId, userId, now, now);
    return id;
  }

  getInstance(userId: string, instanceId: string): WorkflowInstance | null {
    const row = this.db
      .prepare('SELECT * FROM workflow_instances WHERE id = ? AND user_id = ?')
      .get(instanceId, userId) as
      | {
          id: string;
          definition_id: string;
          user_id: string;
          status: string;
          current_node_ids: string;
          variables: string;
          error: string | null;
          created_at: number;
          updated_at: number;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      definitionId: row.definition_id,
      userId: row.user_id,
      status: row.status as WorkflowInstance['status'],
      currentNodeIds: JSON.parse(row.current_node_ids),
      variables: JSON.parse(row.variables),
      error: row.error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listInstances(userId: string, definitionId?: string): WorkflowInstance[] {
    const sql = definitionId
      ? 'SELECT * FROM workflow_instances WHERE user_id = ? AND definition_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM workflow_instances WHERE user_id = ? ORDER BY created_at DESC';
    const rows = this.db
      .prepare(sql)
      .all(definitionId ? [userId, definitionId] : [userId]) as Array<{
      id: string;
      definition_id: string;
      user_id: string;
      status: string;
      current_node_ids: string;
      variables: string;
      error: string | null;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      definitionId: r.definition_id,
      userId: r.user_id,
      status: r.status as WorkflowInstance['status'],
      currentNodeIds: JSON.parse(r.current_node_ids),
      variables: JSON.parse(r.variables),
      error: r.error ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  updateInstance(
    userId: string,
    instanceId: string,
    update: Partial<Pick<WorkflowInstance, 'status' | 'currentNodeIds' | 'variables' | 'error'>>,
  ): boolean {
    const inst = this.getInstance(userId, instanceId);
    if (!inst) return false;
    const now = Date.now();
    const status = update.status ?? inst.status;
    const currentNodeIds = update.currentNodeIds ?? inst.currentNodeIds;
    const variables = update.variables ?? inst.variables;
    const error = update.error !== undefined ? update.error : inst.error;
    const r = this.db
      .prepare(
        `UPDATE workflow_instances SET status = ?, current_node_ids = ?, variables = ?, error = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      )
      .run(status, JSON.stringify(currentNodeIds), JSON.stringify(variables), error ?? null, now, instanceId, userId);
    return r.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
