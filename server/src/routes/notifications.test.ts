import {describe,it,expect,vi} from 'vitest';
import express from 'express';import request from 'supertest';
import {mkdtemp} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {createNotificationsRouter} from './notifications.js';

describe('partial DND updates',()=>{
 it('uses DATETIME values and MySQL JSON syntax in the MySQL branch without connecting to MySQL',async()=>{
  const before={enabled:false,quietHoursStart:'22:00',quietHoursEnd:'07:00'},run=vi.fn(async()=>{}),db={getDialect:()=> 'mysql',getConfig:vi.fn().mockResolvedValueOnce(JSON.stringify(before)).mockResolvedValueOnce(JSON.stringify({...before,enabled:true})),run};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.userId='owner';next();});app.use(createNotificationsRouter(db as never));
  expect((await request(app).put('/dnd').send({enabled:true})).status).toBe(200);
  const calls=run.mock.calls as unknown as Array<[string,unknown[]]>;expect(calls[0][0]).toContain('INSERT IGNORE');expect(calls[1][0]).toContain('JSON_SET');expect(calls[1][0]).toContain('CAST(? AS JSON)');
  expect(calls[0][1][2]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);expect(calls[1][1][1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
 });
 it('preserves existing quiet hours and concurrent changes to unrelated fields',async()=>{
  const native=new SqliteAppDatabase(await mkdtemp(path.join(os.tmpdir(),'dnd-api-'))),db=new SqliteDatabaseAdapter(native);try{
   await db.ensureUser('owner');await db.setConfig('owner','dnd_preferences',JSON.stringify({enabled:false,quietHoursStart:'22:00',quietHoursEnd:'07:00'}));
   const app=express();app.use(express.json());app.use((req,_res,next)=>{req.userId='owner';next();});app.use(createNotificationsRouter(db));
   const results=await Promise.all([request(app).put('/dnd').send({enabled:true}),request(app).put('/dnd').send({quietHoursStart:'23:00'})]);expect(results.every(response=>response.status===200)).toBe(true);
   expect((await request(app).get('/dnd')).body.data).toEqual({enabled:true,quietHoursStart:'23:00',quietHoursEnd:'07:00'});
   await request(app).put('/dnd').send({quietHoursStart:null});expect((await request(app).get('/dnd')).body.data.quietHoursStart).toBeNull();
   expect((await request(app).put('/dnd').send({enabled:'false'})).status).toBe(400);
   await db.setConfig('owner','dnd_preferences','[]');expect((await request(app).put('/dnd').send({enabled:true})).status).toBe(409);expect(await db.getConfig('owner','dnd_preferences')).toBe('[]');
  }finally{native.close();}
 });
});
