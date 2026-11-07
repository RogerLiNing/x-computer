import express from 'express';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { createScheduledJobsRouter } from './scheduledJobs.js';
import { createSchedulerRouter } from './scheduler.js';
import { ScheduledOccurrenceService } from '../scheduler/ScheduledOccurrenceService.js';
import { XScheduler, setDefaultScheduler } from '../scheduler/XScheduler.js';

describe('owned schedule HTTP management', () => {
  let sqlite: SqliteAppDatabase; let db: SqliteDatabaseAdapter; let server: Server; let base: string;
  let service: ScheduledOccurrenceService;
  beforeEach(async () => {
    sqlite = new SqliteAppDatabase(await mkdtemp(path.join(os.tmpdir(), 'schedule-http-'))); db = new SqliteDatabaseAdapter(sqlite);
    service = new ScheduledOccurrenceService({ db, getRuns: () => undefined, getSystemPrompt: async () => '', getLLMConfig: async () => null });
    setDefaultScheduler(new XScheduler(async () => {}, { loadAll: async () => [], save: async () => {}, updateRunAt: async () => {}, remove: id => service.cancelJob(id) }));
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.userId = String(req.headers['x-test-user'] ?? 'owner'); next(); });
    app.use('/scheduled-jobs', createScheduledJobsRouter(db)); app.use(createSchedulerRouter(db, () => service));
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>(r => server.close(() => r())); setDefaultScheduler(null);sqlite.close(); });
  const api = (url: string, method = 'GET', body?: object, user = 'owner') => fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-test-user': user }, ...(body ? { body: JSON.stringify(body) } : {}) });
  it('validates time and cron before saving, including reminder session ownership', async () => {
    for (const body of [{ intent: 'test', cron: '99 * * * *' }, { intent: 'test', nextRun: 'oops' }, { intent: 2 }]) expect((await api('/scheduled-jobs', 'POST', body)).status).toBe(400);
    const session = await db.createSession('other');
    expect((await api('/reminders', 'POST', { message: 'test', at: Date.now(), sessionId: session.id })).status).toBe(400);
    expect((await api('/reminders', 'POST', { message: 'test', at: 'oops' })).status).toBe(400);
    expect(await db.getAllScheduledJobs()).toEqual([]);
    const created = await (await api('/scheduled-jobs', 'POST', { intent: 'test', cron: '0 9 1 * *' })).json();
    expect(created.data.nextRun).toBeGreaterThan(Date.now()); expect(new Date(created.data.nextRun).getDate()).toBe(1);
  });
  it('creates an owned reminder conversation when the caller has not started chatting',async()=>{
    const response=await api('/reminders','POST',{message:'整理书包',at:Date.now()+60000});expect(response.status).toBe(201);
    const result=await response.json();expect((await db.getSession(result.sessionId))?.user_id).toBe('owner');expect(result.sessionId).toBeTruthy();
  });
  it('cancels queued occurrences when a user disables a plan, retaining history', async () => {
    const created = await (await api('/scheduled-jobs', 'POST', { intent: 'test', nextRun: 100 })).json();
    await service.queue({ id: created.data.id, userId: 'owner', intent: 'test', runAt: 100, createdAt: 1 }, 200);
    expect((await api(`/scheduled-jobs/${created.data.id}/toggle`, 'POST', {}, 'other')).status).toBe(404);
    expect((await api(`/scheduled-jobs/${created.data.id}/toggle`, 'POST', {})).status).toBe(200);
    expect((await service.list('owner'))[0].status).toBe('cancelled'); expect((await db.getAllScheduledJobs())[0].enabled).toBe(0);
    expect((await (await api('/x/scheduled-runs', 'GET', undefined, 'other')).json()).runs).toEqual([]);
    const id = (await service.list('owner'))[0].id;
    expect((await api(`/x/scheduled-runs/${id}/stop`, 'POST', {}, 'other')).status).toBe(404);
  });
});
