import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import express from 'express';
import tailwindcss from 'tailwindcss';
import theme from '../frontend/tailwind.config.js';

const configPath = process.env.X_COMPUTER_CONFIG_PATH;
assert.ok(configPath, '必须显式指定独立验收配置');
assert.equal(JSON.parse(await readFile(configPath, 'utf8')).database.type, 'sqlite');
process.env.DATABASE_TYPE = 'sqlite';
const root = fileURLToPath(new URL('../', import.meta.url));
const work = await mkdtemp(path.join(os.tmpdir(), 'x-office-edit-'));
const out = process.argv[2] || await mkdtemp(path.join(os.tmpdir(), 'x-office-edit-proof-'));
await mkdir(out, { recursive: true });
const { SqliteAppDatabase, SqliteDatabaseAdapter } = await import('../server/dist/server/src/db/database.js');
const { runMigrations } = await import('../server/dist/server/src/db/migrate.js');
const { UserSandboxManager } = await import('../server/dist/server/src/tooling/UserSandboxManager.js');
const { SubscriptionService } = await import('../server/dist/server/src/subscription/SubscriptionService.js');
const { resolveLLMCredentials } = await import('../server/dist/server/src/llm/credentialResolver.js');
const { AgentOrchestrator } = await import('../server/dist/server/src/orchestrator/AgentOrchestrator.js');
const { AuditLogger } = await import('../server/dist/server/src/observability/AuditLogger.js');
const { ChatRunService } = await import('../server/dist/server/src/chat/ChatRunService.js');
const { createFSRouter } = await import('../server/dist/server/src/routes/fs.js');
const { officeReadFixtures } = await import('../server/dist/server/src/office/readFixtures.js');
const sqlite = new SqliteAppDatabase(work), db = new SqliteDatabaseAdapter(sqlite);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let browser, server;
try {
  const migrations = path.join(work, 'migrations'); await mkdir(migrations);
  await copyFile(path.join(root, 'server/migrations/001_add_subscriptions.sql'), path.join(migrations, '001_add_subscriptions.sql'));
  await runMigrations(db, migrations);
  const uid = 'office-edit-acceptance'; await db.ensureUser(uid);
  const spaces = new UserSandboxManager(work), sandbox = (await spaces.getForUser(uid)).sandboxFS;
  const fixtures = await officeReadFixtures({ word: 'OLD_CODE', sheet: 'OLD_SHEET', slide: 'unused' });
  await sandbox.writeBinaryNew('原稿.docx', fixtures.docx); await sandbox.writeBinaryNew('原表.xlsx', fixtures.xlsx);
  await writeFile(path.join(out, '原稿.docx'), fixtures.docx); await writeFile(path.join(out, '原表.xlsx'), fixtures.xlsx);
  const entry = path.join(work, 'main.tsx');
  await writeFile(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{OfficeViewerApp}from'${root}frontend/src/components/apps/OfficeViewerApp';import{useDesktopStore}from'${root}frontend/src/store/desktopStore';import'${root}frontend/src/styles/global.css';localStorage.setItem('x-computer-user-id','${uid}');function App(){const windows=useDesktopStore(s=>s.windows),win=windows.find(w=>w.isFocused),file=new URL(location.href).searchParams.get('kind')==='sheet'?'原表.xlsx':'原稿.docx';return <div style={{height:'100dvh'}}><OfficeViewerApp windowId={win?.id||'proof'} metadata={win?.metadata||{filePath:file,fileName:file}}/></div>}createRoot(document.getElementById('root')).render(<App/>);`);
  server = await createServer({ configFile: false, root: path.join(root, 'frontend'), plugins: [react(), { name: 'owned-office-edit', configureServer(vite) {
    const api = express(); api.use(express.json()); api.use(createFSRouter(sandbox)); vite.middlewares.use('/api/fs', api);
    vite.middlewares.use('/__office_edit', async (_req, res) => {
      const html = await vite.transformIndexHtml('/__office_edit', '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/@fs' + entry + '"></script></html>');
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
    });
  } }], css: { postcss: { plugins: [tailwindcss({ ...theme, content: [path.join(root, 'frontend/src/**/*.{ts,tsx}')] })] } }, resolve: { alias: { '@': path.join(root, 'frontend/src'), '@shared': path.join(root, 'shared/src') }, dedupe: ['react', 'react-dom'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root, work] } } });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  browser = await chromium.launch({ headless: true, ...(process.env.OFFICE_CHROME_PATH ? { executablePath: process.env.OFFICE_CHROME_PATH } : {}), args: ['--disable-background-networking'] });
  const scenarios = [];
  for (const [size, width, height] of [['desktop', 1100, 900], ['mobile', 320, 760]]) {
    for (const kind of ['word', 'sheet']) {
      const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/__office_edit?kind=' + kind);
      const input = kind === 'word' ? page.getByRole('textbox', { name: '改成什么', exact: true }) : page.getByRole('textbox', { name: '材料表 B2', exact: true });
      await input.waitFor({ timeout: 15000 });
      const contrast = await input.evaluate(element => {
        const style = getComputedStyle(element);
        const luminance = color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
        let background = 'rgb(255,255,255)';
        for (let node=element;node;node=node.parentElement) { const color=getComputedStyle(node).backgroundColor; if(color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)'){background=color;break;} }
        const a=luminance(style.color),b=luminance(background);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
      });
      assert.ok(contrast >= 4.5, 'editable text must have readable contrast');
      if (kind === 'word') {
        await page.getByRole('textbox', { name: '原来的文字', exact: true }).fill('OLD_CODE');
        await page.getByRole('spinbutton', { name: '预计修改几处' }).fill('2');
        await input.fill('UI_UPDATED'); await page.getByRole('button', { name: '保存修改副本' }).click();
        await page.getByRole('alert').filter({ hasText: '匹配' }).waitFor();
        await page.getByRole('spinbutton', { name: '预计修改几处' }).fill('1');
      } else await input.fill('UI_UPDATED');
      let release, observed;
      const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { observed = resolve; });
      await page.route('**/api/fs/edit-office', async route => { observed(); await gate; await route.continue(); });
      await page.getByRole('button', { name: '保存修改副本' }).click(); await reached;
      assert.equal(await input.isDisabled(), true); release();
      await page.getByRole('status').filter({ hasText: '上一次修改副本已保存' }).waitFor();
      assert.equal(await page.getByRole('button', { name: '保存修改副本' }).isDisabled(), true);
      await page.screenshot({ path: path.join(out, `${size}-${kind}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByRole('button', { name: '打开修改副本' }).click();
      // Wait until the copy's asynchronous read has replaced the source values.
      await page.waitForFunction(({kind}) => kind === 'word' ? document.querySelector('textarea[aria-label="原文预览"]')?.value.includes('UI_UPDATED') : document.querySelector('input[aria-label="材料表 B2"]')?.value === 'UI_UPDATED', {kind});
      assert.deepEqual(errors, []);
      scenarios.push({ size, kind, saveInputsDisabledWhilePending: true, copyOpened: true, noHorizontalOverflow: true, sourcePreserved: true, editableTextContrast: contrast });
      await context.close();
    }
  }
  await browser.close(); browser = undefined; await server.close(); server = undefined;
  assert.equal(sha(await sandbox.readBinary('原稿.docx')), sha(fixtures.docx)); assert.equal(sha(await sandbox.readBinary('原表.xlsx')), sha(fixtures.xlsx));
  // Run the billable model only after the browser checks have passed.
  const plans = new SubscriptionService(db, work), config = await resolveLLMCredentials(uid, db, plans); assert.ok(config?.apiKey);
  const orchestrator = new AgentOrchestrator(new AuditLogger(), sandbox, spaces, db, undefined, undefined, undefined, plans);
  const runs = new ChatRunService({ db, orchestrator, modelBudget: plans, getSandboxFS: async () => sandbox, getLLMConfig: async () => config });
  const session = await db.createSession(uid, 'Office 原稿保留与修改副本');
  const run = await runs.accept({ userId: uid, sessionId: session.id, requestId: randomUUID(), providerId: config.providerId, modelId: config.modelId,
    messages: [{ role: 'user', content: '实际读取 原稿.docx 和 原表.xlsx 取得各自 sha256，再调用 office.edit_copy 生成修改副本：Word 将 OLD_CODE 换成 MODEL_UPDATED，预期1处；Excel 将材料表 B2 改成 MODEL_SHEET。只改这两项，分别 file.present 交付工具返回的副本路径。保留原稿，说明公式缓存需要办公软件重算。' }], systemPrompt: '只做用户指定的本地 XML 副本修改。必须使用真实文件指纹和工具回执，不虚构修改或计算结果。', allowedToolNames: ['file.extract_text', 'office.edit_copy', 'file.present'], toolLoadingMode: 'all' });
  await runs.launch(uid, run.id); const done = await runs.get(uid, run.id); assert.equal(done.status, 'completed');
  const edited = done.toolCalls.filter(tool => tool.toolName === 'office.edit_copy' && tool.status === 'completed' && tool.output?.ok);
  assert.equal(edited.length, 2); assert.equal(done.artifacts.length, 2);
  const packages = [];
  for (const tool of edited) {
    const result = tool.output, isWord = result.path.endsWith('.docx'), bytes = await sandbox.readBinary(result.path), zip = await JSZip.loadAsync(bytes);
    const text = await zip.file(isWord ? 'word/document.xml' : 'xl/worksheets/sheet1.xml').async('string');
    assert.ok(text.includes(isWord ? 'MODEL_UPDATED' : 'MODEL_SHEET'));
    if (!isWord) { assert.ok(text.includes('<f>SUM(3,4,5)</f>')); assert.ok(result.warnings.some(warning => warning.includes('重算'))); }
    const source = await JSZip.loadAsync(isWord ? fixtures.docx : fixtures.xlsx), allowed = isWord ? ['word/document.xml'] : ['xl/worksheets/sheet1.xml', 'xl/workbook.xml'];
    for (const [name, entry] of Object.entries(source.files)) if (!entry.dir && !allowed.includes(name)) assert.equal(sha(await entry.async('nodebuffer')), sha(await zip.file(name).async('nodebuffer')));
    await writeFile(path.join(out, isWord ? '模型修改稿.docx' : '模型修改表.xlsx'), bytes);
    packages.push({ path: result.path, changes: result.changes, unrelatedPartsUnchanged: true });
  }
  assert.equal(sha(await sandbox.readBinary('原稿.docx')), sha(fixtures.docx)); assert.equal(sha(await sandbox.readBinary('原表.xlsx')), sha(fixtures.xlsx));
  const evidence = { success: true, root: work, database: 'fresh isolated SQLite', browser: scenarios, realModel: { runId: done.id, status: done.status, packages }, originalFilesUnchanged: true, originalMysqlAccessed: false, memoryPolicyChanged: false, browserScope: 'real OfficeViewerApp and FS API; login/main desktop router not exercised', nativeOfficeRenderingVerified: false };
  const encoded = JSON.stringify(evidence); assert.ok(!encoded.includes(config.apiKey));
  await writeFile(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ success: true, evidence: path.join(out, 'evidence.json') }));
} finally { await browser?.close(); await server?.close(); sqlite.close(); }
