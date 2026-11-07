import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';
import express from 'express';import request from 'supertest';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {PasswordResetService} from './passwordReset.js';
import {SessionAuth} from './sessionAuth.js';
import {hashPassword,verifyPassword} from './password.js';
import {createAuthRouter} from '../routes/auth.js';
import {createAuthEnhancedRoutes} from '../routes/authEnhanced.js';
import {userContextMiddleware} from '../middleware/userContext.js';
import {clearDefaultConfigCache} from '../config/defaultConfig.js';
const mail=vi.hoisted(()=>vi.fn(async()=>({ok:true})));
vi.mock('../email/emailService.js',()=>({sendSystemEmail:mail}));

let first:SqliteAppDatabase,second:SqliteAppDatabase,a:SqliteDatabaseAdapter,b:SqliteDatabaseAdapter;
const uid='reset-fixture',email='reset@example.test',oldPassword='Old-Fixture-Password',newPassword='New-Fixture-Password';
beforeEach(async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'password-reset-'));
 first=new SqliteAppDatabase(root);second=new SqliteAppDatabase(root);a=new SqliteDatabaseAdapter(first);b=new SqliteDatabaseAdapter(second);
 await a.ensureUser(uid);await a.createAuthAccount(email,await hashPassword(oldPassword),uid);
 const config=path.join(root,'config.json');await writeFile(config,JSON.stringify({email:{smtp:{host:'fixture.invalid',user:'fixture',pass:'fixture-only'}}}),{mode:0o600});vi.stubEnv('X_COMPUTER_CONFIG_PATH',config);clearDefaultConfigCache();mail.mockClear();mail.mockResolvedValue({ok:true});
});
afterEach(()=>{first.close();second.close();vi.unstubAllEnvs();clearDefaultConfigCache();});
const token=()=>String((mail.mock.calls as unknown as Array<[{subject:string;body:string}]>).find(([value])=>value.subject.includes('重置码'))?.[0].body.split('\n\n')[1]);
function app(){
 const sessions=new SessionAuth(a),app=express();app.locals.sessions=sessions;app.use(express.json());app.use(userContextMiddleware(false));
 app.use('/api/auth',createAuthRouter(a,undefined as never));app.use('/api/auth',createAuthEnhancedRoutes(a,undefined,sessions));app.get('/api/private',(_req,res)=>res.json({ok:true}));return{app,sessions};
}
async function login(appInstance:express.Express,password:string){const challenge=(await request(appInstance).get('/api/auth/captcha')).body;const numbers=challenge.question.match(/(\d+)\s*\+\s*(\d+)/);return request(appInstance).post('/api/auth/login').send({email,password,captchaId:challenge.id,captchaAnswer:String(Number(numbers[1])+Number(numbers[2]))});}
describe('password recovery without an existing login',()=>{
 it('returns the same neutral response, keeps tokens out of responses and hashes tokens at rest',async()=>{
  const {app:server}=app();const known=await request(server).post('/api/auth/request-password-reset').send({email}),unknown=await request(server).post('/api/auth/request-password-reset').send({email:'missing@example.test'});
  expect(known.status).toBe(200);expect(unknown.body).toEqual(known.body);expect(known.body.code).toBeUndefined();
  const code=token();expect(/^[\w-]{32}$/.test(code)).toBe(true);
  const row=await a.queryOne<{code_hash:string}>('SELECT code_hash FROM password_reset_requests');expect(row?.code_hash===code).toBe(false);expect(row?.code_hash===createHash('sha256').update(code).digest('hex')).toBe(true);
 });
 it('serializes resend and token consumption across independent connections',async()=>{
  const one=new PasswordResetService(a),two=new PasswordResetService(b);await Promise.all([one.requestPasswordReset(email),two.requestPasswordReset(email)]);expect(mail).toHaveBeenCalledTimes(1);
  const code=token(),results=await Promise.all([one.resetPassword(email,code,newPassword),two.resetPassword(email,code,'Competing-Fixture-Password')]);expect(results.filter(Boolean)).toHaveLength(1);
  expect(await one.resetPassword(email,code,'Replay-Fixture-Password')).toBe(false);
 });
 it('rejects expired and superseded tokens without changing the password',async()=>{
  const service=new PasswordResetService(a);await service.requestPasswordReset(email);const expired=token();
  await a.run('UPDATE password_reset_requests SET expires_at=0');expect(await service.resetPassword(email,expired,newPassword)).toBe(false);
  await a.run('UPDATE password_reset_requests SET next_send_at=0');mail.mockClear();await service.requestPasswordReset(email);expect(await service.resetPassword(email,expired,newPassword)).toBe(false);
  expect(await verifyPassword(oldPassword,(await a.getPasswordHashByEmail(email))!)).toBe(true);
 });
 it('resets once, revokes old and legacy sessions, and requires normal login with the new password',async()=>{
  const {app:server,sessions}=app(),cookie=await sessions.createCookie(uid),oldHash=(await a.getPasswordHashByEmail(email))!;
  const legacyToken=uid+'.'+randomBytes(32).toString('base64url');await a.setConfig(uid,'auth_session:'+createHash('sha256').update(legacyToken).digest('hex'),JSON.stringify({expiresAt:Date.now()+60000}));
  expect(await sessions.authenticate('x_session='+legacyToken)).not.toBeNull();
  const changed=vi.fn();sessions.on('credentials_changed',changed);
  await request(server).post('/api/auth/request-password-reset').send({email});const response=await request(server).post('/api/auth/reset-password').send({email,code:token(),newPassword});
  expect(response.status).toBe(200);expect(response.headers['set-cookie']).toBeUndefined();expect(await sessions.authenticate(cookie)).toBeNull();expect(await sessions.authenticate('x_session='+legacyToken)).toBeNull();expect(changed).toHaveBeenCalledWith(uid);
  await expect(sessions.createCookie(uid,{email,passwordHash:oldHash})).rejects.toThrow('密码已更新');
  expect((await login(server,oldPassword)).status).toBe(401);const signedIn=await login(server,newPassword);expect(signedIn.status).toBe(200);
  expect((await request(server).get('/api/private').set('Cookie',signedIn.headers['set-cookie'])).status).toBe(200);
 });
 it('rejects invalid input before sending mail or changing any password',async()=>{
  const {app:server}=app();for(const body of [{email:[]},{email,code:{},newPassword},{email,code:'x'.repeat(32),newPassword:true},{email,code:'x'.repeat(32),newPassword:'x'.repeat(257)}])expect((await request(server).post('/api/auth/reset-password').send(body)).status).toBe(400);
  expect(mail).not.toHaveBeenCalled();expect(await verifyPassword(oldPassword,(await a.getPasswordHashByEmail(email))!)).toBe(true);
 });
 it('keeps credential storage errors separate from a logged-out session',async()=>{
  const sessions=new SessionAuth(a),cookie=await sessions.createCookie(uid);vi.spyOn(a,'query').mockRejectedValueOnce(new Error('credential store offline'));
  await expect(sessions.authenticate(cookie)).rejects.toThrow('credential store offline');
 });
 it('reports unavailable email recovery before promising that a code was sent',async()=>{
  const config=path.join(await mkdtemp(path.join(os.tmpdir(),'reset-disabled-')),'config.json');await writeFile(config,JSON.stringify({auth:{allowRegister:true}}));vi.stubEnv('X_COMPUTER_CONFIG_PATH',config);clearDefaultConfigCache();
  const {app:server}=app();expect((await request(server).get('/api/auth/settings')).body.passwordResetAvailable).toBe(false);
  expect((await request(server).post('/api/auth/request-password-reset').send({email})).status).toBe(503);expect(mail).not.toHaveBeenCalled();
 });
 it('recognizes an explicitly configured local mail relay without requiring remote mailbox credentials',async()=>{
  const config=path.join(await mkdtemp(path.join(os.tmpdir(),'reset-relay-')),'config.json');await writeFile(config,JSON.stringify({email:{smtp:{host:'localhost',user:'',pass:''}}}));vi.stubEnv('X_COMPUTER_CONFIG_PATH',config);clearDefaultConfigCache();
  const {app:server}=app();expect((await request(server).get('/api/auth/settings')).body.passwordResetAvailable).toBe(true);
 });
});
