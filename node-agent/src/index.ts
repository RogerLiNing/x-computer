#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { NodeAgent } from './agent.js';
import { AGENT_VERSION, configDir, loadConfig, saveConfig, type NodeConfig } from './config.js';
import { collectSpecs } from './metrics.js';

const USAGE = `x-node ${AGENT_VERSION} —— 运行在节点服务器上的 X 子智能体

用法：
  x-node enroll <X地址> <注册令牌> [--name 名称] [--labels gpu,overseas] [--workspace 目录]
  x-node run                      连接 X 并等待任务（配 systemd 常驻）
  x-node status                   显示本机配置
环境变量：X_NODE_HOME 配置目录（默认 ~/.x-node）`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function enroll(args: string[]): Promise<void> {
  const [serverUrl, token] = args;
  if (!serverUrl || !token) { console.error(USAGE); process.exit(2); }
  const base = serverUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/api/nodes/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, specs: collectSpecs() }) });
  const body = await response.json().catch(() => ({})) as { nodeId?: string; nodeKey?: string; name?: string; labels?: string[]; error?: string };
  if (!response.ok || !body.nodeId || !body.nodeKey) { console.error(`注册失败：${body.error ?? response.status}`); process.exit(1); }
  const config: NodeConfig = {
    serverUrl: base, nodeId: body.nodeId, nodeKey: body.nodeKey,
    name: flag(args, 'name') ?? body.name ?? os.hostname(),
    labels: (flag(args, 'labels') ?? body.labels?.join(',') ?? '').split(',').map((label) => label.trim()).filter(Boolean),
    workspace: flag(args, 'workspace') ?? path.join(configDir(), 'workspace'),
  };
  const file = await saveConfig(config);
  console.log(`已注册为节点 ${config.nodeId}（${config.name}），配置写入 ${file}\n现在运行：x-node run`);
}

async function run(): Promise<void> {
  const config = await loadConfig();
  if (!config) { console.error('尚未注册，请先运行 x-node enroll'); process.exit(1); }
  const agent = new NodeAgent(config);
  await agent.start();
  const stop = () => { agent.stop(); setTimeout(() => process.exit(0), 300).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'enroll') return enroll(rest);
  if (command === 'run') return run();
  if (command === 'status') { const config = await loadConfig(); console.log(config ? JSON.stringify({ ...config, nodeKey: '••••••' }, null, 2) : '未注册'); return; }
  console.log(USAGE);
  if (command && command !== 'help' && command !== '--help') process.exit(2);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
