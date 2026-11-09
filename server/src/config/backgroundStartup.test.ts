import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import {afterEach,it,expect,vi} from 'vitest';
import {createApp,type AppResult} from '../app.js';
import {LivingAIKernel} from '../living-ai/LivingAIKernel.js';
import {ScheduledOccurrenceService} from '../scheduler/ScheduledOccurrenceService.js';
import {XScheduler,setDefaultScheduler} from '../scheduler/XScheduler.js';
import {HeartbeatService} from '../heartbeat/HeartbeatService.js';
import * as email from '../email/emailCheckLoop.js';
import * as telegram from '../telegram/telegramService.js';
import * as discord from '../discord/discordService.js';
import * as slack from '../slack/slackService.js';
import * as qq from '../qq/qqService.js';
import * as whatsapp from '../whatsapp/whatsappService.js';

vi.mock('./defaultConfig.js',()=>({loadDefaultConfig:()=>({database:{type:'sqlite'},container:{enabled:false}}),startDefaultConfigWatcher:()=>()=>{},describeEffectiveConfig:()=>({layers:[],config:{}})}));
let result:AppResult|undefined;
afterEach(async()=>{await result?.db.close();result=undefined;setDefaultScheduler(null);vi.restoreAllMocks();vi.unstubAllEnvs();});
function starts(){
  return [
    vi.spyOn(LivingAIKernel.prototype,'start').mockImplementation(()=>{}),
    vi.spyOn(ScheduledOccurrenceService.prototype,'start').mockImplementation(()=>{}),
    vi.spyOn(XScheduler.prototype,'start').mockImplementation(()=>{}),
    vi.spyOn(HeartbeatService.prototype,'start').mockResolvedValue(),
    vi.spyOn(email,'startEmailCheckLoop').mockReturnValue(()=>{}),
    vi.spyOn(telegram,'reconnectTelegramForConfiguredUsers').mockResolvedValue(),
    vi.spyOn(discord,'reconnectDiscordForConfiguredUsers').mockResolvedValue(),
    vi.spyOn(slack,'reconnectSlackForConfiguredUsers').mockResolvedValue(),
    vi.spyOn(qq,'reconnectQQForConfiguredUsers').mockResolvedValue(),
    vi.spyOn(whatsapp,'reconnectWhatsAppForConfiguredUsers').mockResolvedValue(),
  ];
}
async function app(profile:'full'|'lightweight'){
  vi.stubEnv('NODE_ENV','development');
  result=await createApp({workspaceRoot:await mkdtemp(path.join(os.tmpdir(),'background-startup-')),runtimeProfile:profile,databaseType:'sqlite',useContainerIsolation:false,allowAnonymous:false});
  await result.db.ensureUser('fixture');const cookie=await result.app.locals.sessions.createCookie('fixture');
  await request(result.app).get('/api/x/scheduled-runs').set('Cookie',cookie).expect(200);
  return {result,cookie};
}
it('retains management routes while preventing every automatic background startup',async()=>{
  vi.stubEnv('X_COMPUTER_BACKGROUND_AUTOSTART','false');const calls=starts();const {result,cookie}=await app('full');
  for(const call of calls)expect(call).not.toHaveBeenCalled();
  expect((await request(result.app).get('/api/runtime/plugins')).body.backgroundAutostart).toBe(false);
  expect((await request(result.app).get('/api/x/scheduler-status').set('Cookie',cookie)).body.running).toBe(false);
  expect((await request(result.app).get('/api/x/life/status').set('Cookie',cookie)).body.running).toBe(false);
  await request(result.app).get('/api/telegram/status').set('Cookie',cookie).expect(200);
});
it('does not create an autonomous loop when its plugin is disabled',async()=>{
  vi.stubEnv('X_COMPUTER_BACKGROUND_AUTOSTART','true');const calls=starts();const {result,cookie}=await app('lightweight');
  expect(calls[0]).not.toHaveBeenCalled();
  await request(result.app).get('/api/x/life/status').set('Cookie',cookie).expect(404);
});
it('preserves automatic startup when explicitly enabled for the full profile',async()=>{
  vi.stubEnv('X_COMPUTER_BACKGROUND_AUTOSTART','true');const calls=starts();await app('full');
  for(const call of calls)expect(call).toHaveBeenCalledOnce();
});
