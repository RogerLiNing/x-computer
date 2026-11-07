import { execFile, execFileSync, fork } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { createSmtpFixture } from './smtpFixture.js';
const hasOpenSSL = (() => { try { execFileSync('openssl', ['version'], { stdio: 'ignore', timeout: 3000 }); return true; } catch { return false; } })();
it.runIf(hasOpenSSL).each(['implicit', 'starttls', 'untrusted'] as const)('preserves TLS verification and closes %s SMTP connections without replaying', async mode => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smtp-tls-stop-'));
  const keyPath = path.join(root, 'key.pem'), certPath = path.join(root, 'cert.pem'), configPath = path.join(root, 'openssl.cnf');
  await writeFile(configPath, '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n', { mode: 0o600 });
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-config', configPath], { timeout: 10000 });
  const material = { key: await readFile(keyPath, 'utf8'), cert: await readFile(certPath, 'utf8') };
  const smtp = await createSmtpFixture({ passwords: new Map([['sender@example.test', 'fixture']]), hold: 'receipt', ...(mode !== 'starttls' ? { tls: material } : { startTls: material }) });
  const file = path.join(root, 'client.mjs');
  const config = { host: '127.0.0.1', port: smtp.port, secure: mode !== 'starttls', user: 'sender@example.test', pass: 'fixture' };
  await writeFile(file, `import {sendEmail} from ${JSON.stringify(new URL('./emailService.ts', import.meta.url).href)};
import {SendExecutionDeniedError} from ${JSON.stringify(new URL('../tooling/sendApproval.ts', import.meta.url).href)};
import {UncertainToolOutcomeError} from ${JSON.stringify(new URL('../tooling/UncertainToolOutcomeError.ts', import.meta.url).href)};
const controller=new AbortController();process.once('message',()=>controller.abort());
let result;try{await sendEmail(()=>JSON.stringify(${JSON.stringify(config)}),'owner',{to:'recipient@example.test',subject:'TLS 合成验收',body:'TLS 合成正文',signal:controller.signal});result={kind:'unexpected-success'};}catch(error){result={kind:error instanceof UncertainToolOutcomeError?'unknown':error instanceof SendExecutionDeniedError?'not-dispatched':'error',message:error.message};}
process.send(result,()=>process.exit(0));`, { mode: 0o600 });
  const child = fork(file, [], { execArgv: ['--import', 'tsx'], cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, NODE_ENV: 'test', X_COMPUTER_ISOLATED: '1', ...(mode === 'untrusted' ? { NODE_TLS_REJECT_UNAUTHORIZED: '0' } : { NODE_EXTRA_CA_CERTS: certPath }) }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = once(child, 'exit'); let stderr = '', result: any;
  child.stderr?.on('data', chunk => { if (stderr.length < 2048) stderr += String(chunk); });
  const report = new Promise<any>((resolve, reject) => { child.once('message', message => { result = message; resolve(message); }); child.once('error', reject); child.once('exit', code => { if (!result) reject(new Error('TLS fixture child exited: ' + code + ' ' + stderr)); }); });
  try {
    if (mode === 'untrusted') {
      expect((await report).kind).toBe('not-dispatched'); await exited; await vi.waitFor(() => expect(smtp.activeConnections).toBe(0)); expect(smtp.messages).toHaveLength(0); expect(smtp.auth).toHaveLength(0); return;
    }
    await vi.waitFor(() => { if (result) throw new Error(JSON.stringify(result)); expect(smtp.phases).toContain('queued'); }, { timeout: 10000 });
    child.send('stop'); expect((await report).kind).toBe('unknown'); await exited;
    await vi.waitFor(() => expect(smtp.activeConnections).toBe(0)); expect(smtp.messages).toHaveLength(1); expect(smtp.connections).toBe(1);
  } finally { child.kill('SIGKILL'); await exited; await smtp.close(); }
});
