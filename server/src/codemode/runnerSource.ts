/**
 * The script that runs inside the codemode child process. It is written to a temp file and started
 * with `node --permission`, so it can read nothing but itself and has no network; every effect goes
 * through the stdio bridge back to the host, which executes tools through the normal pipeline.
 *
 * Protocol (one JSON object per line):
 *   child → host  { type: 'call', id, tool, args }   a tool call to execute
 *   host  → child { type: 'result', id, ok, value | error }
 *   child → host  { type: 'output', items: [...] }     final output (text / console lines)
 *   child → host  { type: 'error', message }           script threw
 */
export const CODEMODE_RUNNER_SOURCE = String.raw`
'use strict';
const readline = require('node:readline');
const pending = new Map();
let nextId = 1;
const outputs = [];
const consoleLines = [];
let outputChars = 0;
const MAX_OUTPUT = Number(process.env.CODEMODE_MAX_OUTPUT || 20000);

function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
function pushText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  outputChars += text.length;
  if (outputChars > MAX_OUTPUT * 4) throw new Error('脚本输出过多，请把大结果写入文件');
  outputs.push(text);
}
const toolNames = JSON.parse(process.env.CODEMODE_TOOLS || '[]');
const tools = {};
for (const name of toolNames) {
  const key = name.replace(/[^A-Za-z0-9_$]/g, '_');
  const call = (args) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ type: 'call', id, tool: name, args: args || {} });
  });
  tools[key] = call;
  tools[name] = call;
}
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.type !== 'result') return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.ok) waiter.resolve(message.value);
  else waiter.reject(new Error(message.error || '工具调用失败'));
});
const sandboxConsole = { log: (...a) => consoleLines.push(a.map(String).join(' ')), info: (...a) => consoleLines.push(a.map(String).join(' ')), warn: (...a) => consoleLines.push(a.map(String).join(' ')), error: (...a) => consoleLines.push(a.map(String).join(' ')) };
const source = Buffer.from(process.env.CODEMODE_SCRIPT_B64 || '', 'base64').toString('utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
(async () => {
  try {
    const fn = new AsyncFunction('tools', 'text', 'console', 'ALL_TOOLS', source);
    const result = await fn(tools, pushText, sandboxConsole, toolNames.slice());
    if (result !== undefined) pushText(result);
    send({ type: 'output', items: outputs, console: consoleLines });
  } catch (error) {
    send({ type: 'error', message: error && error.message ? error.message : String(error), items: outputs, console: consoleLines });
  } finally {
    process.exit(0);
  }
})();
`;
