import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../server/dist/server/src/db/database.js';
import { SessionAuth } from '../server/dist/server/src/auth/sessionAuth.js';

const root = '/tmp/x-computer-browser-isolated-20261030';
const user = 'acceptance-20261030';
const config = JSON.parse(await readFile('/tmp/x-computer-browser-config-20261030.json', 'utf8'));
assert.equal(config.database?.type, 'sqlite');
const sqlite = new SqliteAppDatabase(root);
const db = new SqliteDatabaseAdapter(sqlite);
try {
  assert.ok(await db.getUser(user), 'Dedicated acceptance account must already exist');
  const cookie = await new SessionAuth(db).createCookie(user);
  const nonce = randomUUID().slice(0, 8);
  const file = `文档/手动后台验收-${nonce}.md`;
  const request = { requestId: `manual-acceptance-${nonce}`, intent: `手动后台验收：只输出两行正文，第一行“交办已完成”，第二行“等待确认”。保存到 ${file}。不要调用工具、不要联网、不要发送消息、不要修改记忆或设置。` };
  const send = async () => {
    const response = await fetch('http://127.0.0.1:4000/api/x/run-now', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(90000) });
    assert.equal(response.status, 200, 'Manual background endpoint must return a real completed run');
    return response.json();
  };
  const first = await send();
  const second = await send();
  assert.ok(first.runId && first.sessionId); assert.equal(second.runId, first.runId);
  const row = await db.queryOne('SELECT metadata_json FROM tasks WHERE id=? AND user_id=?', [first.runId, user]);
  const run = JSON.parse(row.metadata_json).chatRun;
  assert.equal(run.status, 'completed'); assert.equal(run.toolCalls.length, 0); assert.equal(run.artifacts.length, 1);
  assert.equal(run.artifacts[0].path, file);
  const body = await readFile(path.join(root, 'users', user, 'workspace', file), 'utf8');
  assert.equal(body, '交办已完成\n等待确认');
  const journals = await db.query('SELECT id,job_json,status FROM scheduled_occurrences WHERE run_id=?', [first.runId]);
  assert.equal(journals.length, 1); assert.equal(journals[0].status, 'completed');
  const keys = (config.llm_config?.providers ?? config.providers ?? []).map(provider => provider.apiKey).filter(value => typeof value === 'string' && value.length > 10);
  for (const key of keys) { assert.ok(!row.metadata_json.includes(key)); assert.ok(!journals[0].job_json.includes(key)); }
  const report = { success: true, taskId: first.runId, sessionId: first.sessionId, handoffId: journals[0].id,
    repeatedRequestDeduplicated: true, status: run.status, artifact: run.artifacts[0], body, toolCalls: run.toolCalls.length, isolatedSqlite: true };
  const out = '/Users/rogerlee/.codex/outputs/x-computer-background-20261031';
  await mkdir(out, { recursive: true }); await writeFile(path.join(out, `real-model-${nonce}.json`), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + '\n');
} finally { sqlite.close(); }
