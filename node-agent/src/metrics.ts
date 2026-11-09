import fs from 'node:fs/promises';
import os from 'node:os';
import type { NodeMetrics, NodeSpecs } from '../../shared/src/nodeProtocol.js';
import { AGENT_VERSION } from './config.js';

export function collectSpecs(): NodeSpecs {
  return { hostname: os.hostname(), platform: process.platform, arch: process.arch, cpus: os.cpus().length, memoryMb: Math.round(os.totalmem() / 1024 / 1024), agentVersion: AGENT_VERSION };
}

export async function collectMetrics(workspace: string, runningTasks: number): Promise<NodeMetrics> {
  let diskFreeMb: number | undefined;
  try {
    const stats = await fs.statfs(workspace);
    diskFreeMb = Math.round((Number(stats.bavail) * Number(stats.bsize)) / 1024 / 1024);
  } catch {
    diskFreeMb = undefined;
  }
  return {
    load1: Number(os.loadavg()[0]?.toFixed(2) ?? 0),
    memoryUsedMb: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
    memoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
    ...(diskFreeMb !== undefined ? { diskFreeMb } : {}),
    runningTasks,
    uptimeSec: Math.round(process.uptime()),
  };
}
