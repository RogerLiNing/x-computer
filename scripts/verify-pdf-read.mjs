import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const configPath = process.env.X_COMPUTER_CONFIG_PATH;
assert.ok(configPath, '必须显式指定独立验收配置');
assert.equal(JSON.parse(await readFile(configPath, 'utf8')).database.type, 'sqlite');
process.env.DATABASE_TYPE = 'sqlite';
const root = fileURLToPath(new URL('../', import.meta.url));
const work = await mkdtemp(path.join(os.tmpdir(), 'x-pdf-acceptance-'));
const out = process.argv[2] || await mkdtemp(path.join(os.tmpdir(), 'x-pdf-evidence-'));
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
const sqlite = new SqliteAppDatabase(work), db = new SqliteDatabaseAdapter(sqlite);
let browser, server;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const migrations = path.join(work, 'migrations');
  await mkdir(migrations, { recursive: true });
  await copyFile(path.join(root, 'server/migrations/001_add_subscriptions.sql'), path.join(migrations, '001_add_subscriptions.sql'));
  await runMigrations(db, migrations);
  const uid = 'pdf-reader-acceptance';
  await db.ensureUser(uid);
  const plans = new SubscriptionService(db, work), spaces = new UserSandboxManager(work);
  const sandbox = (await spaces.getForUser(uid)).sandboxFS;
  const config = await resolveLLMCredentials(uid, db, plans);
  assert.ok(config?.apiKey);
  const bytes = await readFile(path.join(root, 'server/src/office/fixtures/text-pages.pdf'));
  await sandbox.writeBinary('材料.pdf', bytes);
  const orchestrator = new AgentOrchestrator(new AuditLogger(), sandbox, spaces, db, undefined, undefined, undefined, plans);
  const runs = new ChatRunService({ db, orchestrator, modelBudget: plans, getSandboxFS: async () => sandbox, getLLMConfig: async () => config });
  const session = await db.createSession(uid, 'PDF 文字读取验收');
  const run = await runs.accept({ userId: uid, sessionId: session.id, requestId: randomUUID(),
    messages: [{ role: 'user', content: '请实际使用 file.extract_text 读取 材料.pdf，抄出第一页 PDF_FIRST_CODE 和最后一页 PDF_LAST_CODE 的值及所在原页码。说明中间页面能否认定没有内容、有没有进行 OCR。将核对结果写入 核对结果.md 并 file.present 交付，不修改材料。' }],
    providerId: config.providerId, modelId: config.modelId, systemPrompt: '只做本地材料核对。必须先实际读取，不猜测。注意提取警告，不将未识别页当作空白结论。',
    allowedToolNames: ['file.extract_text', 'file.write', 'file.present'], toolLoadingMode: 'all' });
  await runs.launch(uid, run.id);
  const done = await runs.get(uid, run.id);
  assert.equal(done.status, 'completed');
  const extracted = done.toolCalls.filter(tool => tool.toolName === 'file.extract_text' && tool.status === 'completed' && tool.output?.ok);
  assert.ok(extracted.some(tool => tool.output.content.includes('PDF_LAST_CODE')));
  assert.ok(extracted.some(tool => tool.output.warnings?.some(warning => warning.includes('第 2 页') && warning.includes('尚未进行 OCR'))));
  const artifact = done.artifacts.find(file => file.name === '核对结果.md');
  assert.ok(artifact);
  const result = await sandbox.read(artifact.path);
  for (const code of ['first-page-42', 'last-page-93', 'OCR']) assert.ok(result.includes(code));
  assert.equal(sha(await sandbox.readBinary('材料.pdf')), sha(bytes));
  const usage = await plans.getCurrentUsage(uid);

  const { createServer } = await import('vite'), { default: react } = await import('@vitejs/plugin-react');
  const { default: express } = await import('express');
  const { default: tailwindcss } = await import('tailwindcss'), { default: theme } = await import('../frontend/tailwind.config.js');
  const entry = path.join(work, 'main.tsx');
  await writeFile(entry, `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{OfficeViewerApp}from'${root}frontend/src/components/apps/OfficeViewerApp';import'${root}frontend/src/styles/global.css';localStorage.setItem('x-computer-user-id','${uid}');function App(){const[open,setOpen]=useState(true);return <div style={{height:'100dvh'}}><button onClick={()=>setOpen(false)}>关闭验收窗口</button>{open&&<OfficeViewerApp windowId="pdf-proof" metadata={{filePath:'材料.pdf',fileName:'材料.pdf'}}/>}</div>}createRoot(document.getElementById('root')).render(<App/>);`);
  server = await createServer({ configFile: false, root: path.join(root, 'frontend'), plugins: [react(), {
    name: 'owned-pdf-proof', configureServer(vite) {
      const api = express();
      api.use(createFSRouter(sandbox));
      vite.middlewares.use('/api/fs', api);
      vite.middlewares.use('/__pdf_proof', async (_req, res) => {
        const html = await vite.transformIndexHtml('/__pdf_proof', '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/@fs' + entry + '"></script></html>');
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
      });
    },
  }], css: { postcss: { plugins: [tailwindcss({ ...theme, content: [path.join(root, 'frontend/src/**/*.{ts,tsx}')] })] } }, resolve: { alias: { '@': path.join(root, 'frontend/src'), '@shared': path.join(root, 'shared/src') }, dedupe: ['react', 'react-dom'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root, work] } } });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  browser = await chromium.launch({ headless: true, ...(process.env.PDF_CHROME_PATH ? { executablePath: process.env.PDF_CHROME_PATH } : {}), args: ['--disable-background-networking'] });
  const scenarios = [];
  for (const [name, width, height] of [['desktop', 1100, 800], ['mobile', 320, 640]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', acceptDownloads: true });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/__pdf_proof');
    await page.getByText('PDF_LAST_CODE: last-page-93', { exact: false }).waitFor({ timeout: 15000 });
    assert.ok(await page.getByRole('status').textContent());
    assert.equal(await page.getByRole('button', { name: '保存', exact: true }).count(), 0);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载原文件', exact: true }).click();
    const file = await downloaded, downloadPath = path.join(out, name + '-original.pdf');
    await file.saveAs(downloadPath);
    assert.equal(sha(await readFile(downloadPath)), sha(bytes));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    scenarios.push({ name, originalDownloadUnchanged: true, warningsVisible: true, noHorizontalOverflow: true });
    let intercepted;
    const pending = new Promise(resolve => { intercepted = resolve; });
    let pendingRoute;
    await page.route('**/api/fs/read-office?*', route => { pendingRoute = route; intercepted(); });
    await page.reload();
    await pending;
    const cancelled = page.waitForEvent('requestfailed', { predicate: request => request.url().includes('/api/fs/read-office?') });
    await page.getByRole('button', { name: '关闭验收窗口' }).click();
    await cancelled;
    await pendingRoute.abort().catch(() => {});
    scenarios.at(-1).closingWindowCancelsRequest = true;
    await context.close();
  }
  const evidence = { success: true, database: 'fresh isolated SQLite', root: work, realModel: true, runId: done.id, status: done.status, artifact, extractedCalls: extracted.length, aiCalls: usage.aiCalls, originalUnchanged: true, toolWarnedAboutUnextractedPages: true, browser: scenarios, browserScope: 'real OfficeViewerApp with real local FS API; login and main desktop routing not exercised; close check intercepts HTTP before FS, parser abort verified separately in tests', originalMysqlAccessed: false, memoryPolicyChanged: false };
  const persisted = JSON.stringify(evidence);
  assert.ok(!persisted.includes(config.apiKey));
  await writeFile(path.join(out, 'evidence.json'), persisted, { mode: 0o600 });
  await writeFile(path.join(out, '核对结果.md'), result, { mode: 0o600 });
  console.log(JSON.stringify({ success: true, evidence: path.join(out, 'evidence.json') }));
} finally {
  await browser?.close();
  await server?.close();
  sqlite.close();
}
