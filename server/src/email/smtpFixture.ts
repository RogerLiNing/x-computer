/** Loopback-only SMTP fixture for protocol acceptance tests; never delivers onward. */
import net from 'node:net';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
export async function createSmtpFixture(options: { passwords: Map<string, string>; rejected?: Set<string>; dropReply?: boolean; hold?: 'greeting' | 'auth' | 'receipt'; tls?: { key: string; cert: string }; startTls?: { key: string; cert: string } }) {
  const messages: Array<{ user: string; from: string; recipients: string[]; raw: string }> = [];
  const auth: Array<{ user: string; pass: string }> = [], sockets = new Set<net.Socket>();
  const phases: string[] = [];
  let connections = 0;
  const track = (socket: net.Socket) => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); };
  const accept = (initial: net.Socket) => {
    let socket = initial, encrypted = initial instanceof tls.TLSSocket;
    track(socket); connections++; phases.push('connected'); socket.setTimeout(30000, () => socket.destroy());
    let pending = '', step = '', user = '', authenticated = false, from = '', recipients: string[] = [], body: string[] = [], size = 0;
    const reply = (line: string) => socket.write(line + '\r\n');
    const authenticate = (name: string, pass: string) => {
      auth.push({ user: name, pass }); user = name; authenticated = options.passwords.get(name) === pass; step = '';
      phases.push('auth');
      if (options.hold !== 'auth') reply(authenticated ? '235 Authentication successful' : '535 Authentication rejected');
    };
    if (options.hold === 'greeting') { socket.on('data', () => {}); return; }
    reply('220 localhost synthetic SMTP acceptance');
    const data = (chunk: Buffer) => {
      pending += chunk.toString('utf8'); if (pending.length > 1024 * 1024) { socket.destroy(); return; }
      let end: number;
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 2);
        if (step === 'data') {
          if (line === '.') {
            messages.push({ user, from, recipients: [...recipients], raw: body.join('\r\n') }); step = ''; body = []; size = 0;
            phases.push('queued');
            if (options.dropReply) { socket.destroy(); return; }
            if (options.hold !== 'receipt') reply('250 Accepted into local fixture queue');
          } else {
            size += Buffer.byteLength(line); if (size > 1024 * 1024) { socket.destroy(); return; }
            body.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }
        if (step === 'login-user') { user = Buffer.from(line, 'base64').toString('utf8'); step = 'login-pass'; reply('334 UGFzc3dvcmQ6'); continue; }
        if (step === 'login-pass') { authenticate(user, Buffer.from(line, 'base64').toString('utf8')); continue; }
        if (/^EHLO\b|^HELO\b/i.test(line)) reply('250-localhost\r\n' + (options.startTls && !encrypted ? '250-STARTTLS\r\n' : '') + '250-AUTH PLAIN LOGIN\r\n250 SIZE 1048576');
        else if (/^STARTTLS$/i.test(line) && options.startTls && !encrypted) {
          reply('220 Begin TLS'); socket.removeListener('data', data);
          socket = new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext(options.startTls) });
          track(socket); encrypted = true; pending = ''; authenticated = false; socket.on('data', data); return;
        }
        else if (/^AUTH PLAIN /i.test(line)) {
          const parts = Buffer.from(line.slice(11), 'base64').toString('utf8').split('\0'); authenticate(parts.at(-2) ?? '', parts.at(-1) ?? '');
        } else if (/^AUTH LOGIN$/i.test(line)) { step = 'login-user'; reply('334 VXNlcm5hbWU6'); }
        else if (/^MAIL FROM:/i.test(line)) {
          if (!authenticated) { reply('530 Authenticate first'); continue; }
          from = /<([^>]*)>/.exec(line)?.[1] ?? ''; recipients = []; reply('250 Sender accepted');
        } else if (/^RCPT TO:/i.test(line)) {
          const to = /<([^>]*)>/.exec(line)?.[1] ?? '';
          if (!authenticated) reply('530 Authenticate first');
          else if (options.rejected?.has(to)) reply('550 Synthetic recipient rejected');
          else { recipients.push(to); reply('250 Recipient accepted'); }
        } else if (/^DATA$/i.test(line)) {
          if (!authenticated || !recipients.length) reply('554 No accepted recipient');
          else { step = 'data'; reply('354 End with dot'); }
        } else if (/^QUIT$/i.test(line)) { reply('221 Closing'); socket.end(); }
        else if (/^RSET$/i.test(line)) { recipients = []; reply('250 Reset'); }
        else if (/^NOOP$/i.test(line)) reply('250 OK');
        else reply('502 Unsupported fixture command');
      }
    };
    socket.on('data', data);
  };
  const server = options.tls ? tls.createServer(options.tls, accept) : net.createServer(accept);
  if (options.tls) server.on('connection', track);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: (server.address() as AddressInfo).port, messages, auth, phases, get activeConnections() { return sockets.size; }, get connections() { return connections; },
    close: async () => { for (const socket of sockets) socket.destroy(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
