import {describe,it,expect,vi,afterEach} from 'vitest';import express from 'express';import request from 'supertest';import {serviceAuth} from './serviceAuth.js';
afterEach(()=>vi.unstubAllEnvs());
describe('private workflow service boundary',()=>{
 it('rejects missing configuration, missing tokens and user-id-only callers',async()=>{const app=express();app.use(serviceAuth);app.get('/api',(_q,r)=>r.json({ok:true}));vi.stubEnv('WORKFLOW_SERVICE_TOKEN','');expect((await request(app).get('/api').set('X-User-Id','victim')).status).toBe(503);vi.stubEnv('WORKFLOW_SERVICE_TOKEN','private-workflow-token-for-testing-2026');expect((await request(app).get('/api').set('X-User-Id','victim')).status).toBe(401);expect((await request(app).get('/api').set('Authorization','Bearer private-workflow-token-for-testing-2026')).status).toBe(200);});
});
