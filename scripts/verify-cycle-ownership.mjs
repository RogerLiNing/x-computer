import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const role = process.argv[2];
if (role === 'owner' || role === 'competitor' || role === 'replacement') {
  const { SqliteAppDatabase, SqliteDatabaseAdapter } = await import('../server/dist/server/src/db/database.js');
  const { LivingAIKernel } = await import('../server/dist/server/src/living-ai/LivingAIKernel.js');
  const { ChatRunService } = await import('../server/dist/server/src/chat/ChatRunService.js');
  const { ScheduledOccurrenceService } = await import('../server/dist/server/src/scheduler/ScheduledOccurrenceService.js');
  const { AgentOrchestrator } = await import('../server/dist/server/src/orchestrator/AgentOrchestrator.js');
  const { AuditLogger } = await import('../server/dist/server/src/observability/AuditLogger.js');
  const { UserSandboxManager } = await import('../server/dist/server/src/tooling/UserSandboxManager.js');
  const { SubscriptionService } = await import('../server/dist/server/src/subscription/SubscriptionService.js');
  const { resolveLLMCredentials } = await import('../server/dist/server/src/llm/credentialResolver.js');
  const root = process.env.CYCLE_PROBE_ROOT, uid = 'cycle-ownership-acceptance';
  const noticeProbe=process.env.CYCLE_PROBE_NOTICE==='1';
  const native = new SqliteAppDatabase(root), db = new SqliteDatabaseAdapter(native);
  let providerRequests = 0, notifications = 0, kernel, scheduler;
  const originalFetch = globalThis.fetch;
  try {
    if (role === 'owner') {
      const { runMigrations } = await import('../server/dist/server/src/db/migrate.js');
      const migrations = path.join(root, 'probe-migrations'); await mkdir(migrations);
      await copyFile(new URL('../server/migrations/001_add_subscriptions.sql', import.meta.url), path.join(migrations, '001_add_subscriptions.sql'));
      await runMigrations(db, migrations);
    }
    const plans = new SubscriptionService(db, root), spaces = new UserSandboxManager(root);
    const credentials = async (user, selection) => {
      const config = await resolveLLMCredentials(user, db, plans, selection); assert.ok(config?.apiKey); return config;
    };
    const config = await credentials(uid), providerOrigin = new URL(config.baseUrl).origin;
    const orchestrator = new AgentOrchestrator(new AuditLogger(), undefined, spaces, db, undefined, undefined, undefined, plans);
    const runs = new ChatRunService({ db, orchestrator, modelBudget: plans, getSandboxFS: async user => (await spaces.getForUser(user)).sandboxFS, getLLMConfig: (user, providerId, modelId) => credentials(user, { providerId, modelId }) });
    scheduler = new ScheduledOccurrenceService({ db, getRuns: () => runs, getLLMConfig: credentials, getSystemPrompt: async () => '' });
    orchestrator.setBackgroundIntentRunner(input => scheduler.run(input));
    kernel = new LivingAIKernel({ db, orchestrator, getLLMConfig: credentials, getSystemPrompt: async () => '', notify: () => notifications++, cancelCycles: user => scheduler.cancelLivingCycles(user), resumeCycle:(user,source,revision,signal)=>scheduler.resumeLivingCycle(user,source,revision,signal) });
    if(process.env.CYCLE_PROBE_CRASH==='1'&&role==='owner'){
      const write=db.run.bind(db);let held=false;
      db.run=async(sql,params)=>{
        if(!held&&sql.startsWith('UPDATE user_config SET value=?,updated_at=?')){
          const value=JSON.parse(String(params[0]));
          if(value.episodes?.length===1&&!value.pendingCycle&&(!noticeProbe||value.pendingNotices?.length===0)){
            held=true;await scheduler.wait();const record=(await scheduler.list(uid))[0],run=await runs.get(uid,record.run_id);
            assert.equal(run.status,'completed');const state=JSON.parse(await db.getConfig(uid,'living_ai_state_v1'));assert.ok(noticeProbe?state.pendingNotices?.length===1:state.pendingCycle);assert.ok(!JSON.stringify(state).includes(config.apiKey));
            if(noticeProbe)await db.markNotificationRead(state.pendingNotices[0].id,uid);
            process.send({phase:'receipt-ready',pid:process.pid,runId:run.id,providerRequests,modelUsage:(await plans.getCurrentUsage(uid)).aiCalls,cycleCount:state.cycleCount,episodeCount:state.episodes.length,noticeId:state.pendingNotices?.[0]?.id,noticeCount:(await db.getNotifications(uid,{includeRead:true})).length});
            await new Promise(()=>{});
          }
        }
        return write(sql,params);
      };
    }
    globalThis.fetch = async (url, init) => {
      if (new URL(String(url)).origin !== providerOrigin || init?.method !== 'POST') return originalFetch(url, init);
      providerRequests++; assert.equal(role, 'owner'); assert.equal(providerRequests, 1);
      const response = await originalFetch(url, init), bytes = await response.arrayBuffer(); assert.equal(response.status, 200); assert.ok(bytes.byteLength);
      if(process.env.CYCLE_PROBE_CRASH==='1')return new Response(bytes,{status:response.status,headers:response.headers});
      const released = new Promise(resolve => process.once('message', resolve));
      process.send({ phase: 'response-held', pid: process.pid, bytes: bytes.byteLength, status: response.status });
      await released;
      return new Response(bytes, { status: response.status, headers: response.headers });
    };
    if (role === 'owner') {
      await kernel.updateConfig(uid, { enabled: false, allowLowRiskActions: false, autonomyMode: 'observe', quietHours: { enabled: false, startHour: 23, endHour: 7 } });
      await kernel.addGoal(uid, { title: '多实例执行权验收', description: `只返回JSON：decision=idle，summary=已完成一次只读核查，messageToUser${noticeProbe?'必须填写：本轮只读核查已经完成':'为空'}。不使用工具，不增加或完成任何目标。`, priority: 100 });
      await kernel.updateConfig(uid, { enabled: true });
    }
    const state = (await (noticeProbe&&role==='replacement'?kernel.recoverNotifications(uid):kernel.runCycle(uid))).state;
    await scheduler.wait();
    const notices=await db.getNotifications(uid,{includeRead:true});
    process.send({ phase: 'finished', role, pid: process.pid, providerRequests, notifications, cycleCount: state.cycleCount, episodeCount: state.episodes.length, taskCount: (await db.getAllTasks()).length, runId:(await scheduler.list(uid))[0]?.run_id, modelUsage: (await plans.getCurrentUsage(uid)).aiCalls,noticeCount:notices.length,noticeId:notices[0]?.id,noticeRead:notices[0]?.read,pendingNoticeCount:state.pendingNotices?.length??0 });
  } catch (error) { process.send({ phase: 'failed', role, errorName: error.name }); process.exitCode = 1; }
  finally { globalThis.fetch = originalFetch; native.close(); process.disconnect(); }
} else {
  const noticeProbe=role==='--notice-recovery',crash=role==='--crash-recovery'||noticeProbe;
  const configPath = process.env.X_COMPUTER_CONFIG_PATH;
  assert.ok(configPath, '显式指定专用验收配置，禁止回退原配置');
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).database?.type, 'sqlite');
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'x-cycle-processes-'));
  const out = await mkdtemp(path.join(os.tmpdir(), 'x-cycle-evidence-'));
  const children = [], logs = [];
  function message(child) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('owned worker timed out')); }, 90000);
      const receive = data => { cleanup(); if (data.phase === 'failed') reject(new Error(`owned worker failed: ${data.errorName}`)); else resolve(data); };
      const exit = () => { cleanup(); reject(new Error('owned worker exited before receipt')); };
      function cleanup() { clearTimeout(timer); child.off('message', receive); child.off('exit', exit); }
      child.once('message', receive); child.once('exit', exit);
    });
  }
  async function start(workerRole) {
    const log = await open(path.join(out, `${workerRole}.log`), 'wx', 0o600); logs.push(log);
    const child = fork(fileURLToPath(import.meta.url), [workerRole], { env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, X_COMPUTER_CONFIG_PATH: configPath, DATABASE_TYPE: 'sqlite', CYCLE_PROBE_ROOT: root, CYCLE_PROBE_CRASH:crash?'1':'0',CYCLE_PROBE_NOTICE:noticeProbe?'1':'0' }, stdio: ['ignore', log.fd, log.fd, 'ipc'] });
    children.push(child); return child;
  }
  try {
    if(crash){
      const owner=await start('owner'),saved=await message(owner);assert.equal(saved.phase,'receipt-ready');assert.equal(saved.providerRequests,1);assert.equal(saved.episodeCount,noticeProbe?1:0);
      const terminal=once(owner,'exit');owner.kill('SIGKILL');const [,signal]=await terminal;assert.equal(signal,'SIGKILL');
      const {default:Database}=await import('better-sqlite3'),db=new Database(path.join(root,'x-computer.db'),{readonly:true});
      const clock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)",deadline=Date.now()+60000;
      try{while(db.prepare(`SELECT 1 FROM chat_run_ownership WHERE user_id=? AND scope_id LIKE 'record:living-cycle:%' AND expires_at>${clock}`).get('cycle-ownership-acceptance')){assert.ok(Date.now()<deadline);await delay(250);}}finally{db.close();}
      const replacement=await start('replacement'),recovered=await message(replacement);
      assert.equal(recovered.phase,'finished');assert.equal(recovered.providerRequests,0);assert.equal(recovered.runId,saved.runId);assert.equal(recovered.cycleCount,saved.cycleCount);assert.equal(recovered.episodeCount,1);assert.equal(recovered.taskCount,1);assert.equal(recovered.modelUsage,saved.modelUsage);
      if(noticeProbe){assert.equal(recovered.noticeCount,1);assert.equal(recovered.noticeId,saved.noticeId);assert.equal(recovered.noticeRead,1);assert.equal(recovered.pendingNoticeCount,0);}
      const evidence={success:true,root,database:'isolated SQLite',crashAfterDurableResultBeforeCycleCommit:!noticeProbe,crashAfterNoticeBeforeAcknowledgement:noticeProbe,readStateSetByTest:noticeProbe,owner:saved,replacement:recovered,signal,naturalDatabaseClockExpiry:true,leaseForced:false,sameRunId:true,realProviderRequests:1,recoveryProviderRequests:0,originalMysqlAccessed:false,memoryManagementChanged:false,browserVerified:false};
      await writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({success:true,evidence:path.join(out,'evidence.json')}));
    }else{
    const owner = await start('owner'), held = await message(owner); assert.equal(held.phase, 'response-held');
    const competitor = await start('competitor'), other = await message(competitor);
    assert.equal(other.phase, 'finished'); assert.equal(other.providerRequests, 0); assert.equal(other.cycleCount, 1); assert.equal(other.episodeCount, 0);
    const pending = message(owner); owner.send({ release: true }); const finished = await pending;
    assert.equal(finished.phase, 'finished'); assert.equal(finished.providerRequests, 1); assert.equal(finished.cycleCount, 1); assert.equal(finished.episodeCount, 1); assert.equal(finished.taskCount, 1); assert.equal(finished.modelUsage, 1);
    const evidence = { success: true, database: 'isolated SQLite', root, owner: finished, competitor: other, originalProviderResponseHeld: held, realProviderRequests: 1, distinctOsProcesses: owner.pid !== competitor.pid, originalMysqlAccessed: false, memoryManagementChanged: false, browserVerified: false, crashTakeoverVerified: false };
    await writeFile(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ success: true, evidence: path.join(out, 'evidence.json') }));
    }
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    for (const log of logs) await log.close();
  }
}
