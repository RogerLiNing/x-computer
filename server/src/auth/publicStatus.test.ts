import {expect,it} from 'vitest';
import express from 'express';
import request from 'supertest';
import {SessionAuth} from './sessionAuth.js';
import {userContextMiddleware} from '../middleware/userContext.js';
import {createAuthEnhancedRoutes} from '../routes/authEnhanced.js';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';

it('lets the login page read provider availability without exposing credentials or opening other auth endpoints',async()=>{
 const native=new SqliteAppDatabase(await mkdtemp(path.join(os.tmpdir(),'auth-public-status-'))),db=new SqliteDatabaseAdapter(native);
 try{
 const app=express();app.use(express.json());
 app.locals.sessions=new SessionAuth({getConfig:async()=>undefined,setConfig:async()=>{}});
 app.use(userContextMiddleware(false));
 app.use('/api/auth',createAuthEnhancedRoutes(db,{callbackUrl:'https://fixture.example/oauth/callback',google:{clientId:'fixture-id',clientSecret:'fixture-private-value'}}));
 const response=await request(app).get('/api/auth/oauth/status');expect(response.status).toBe(200);expect(response.body).toEqual({google:true,github:false});expect(response.text).not.toContain('fixture-private-value');
 expect((await request(app).post('/api/auth/send-verification-code').send({email:'fixture@example.test'})).status).toBe(401);
 }finally{native.close();}
});
