import { useState, useEffect, useCallback } from 'react';
import { Activity, Cpu, HardDrive, MemoryStick, Clock, Server, Database, RefreshCw, AlertCircle } from 'lucide-react';
import { api } from '@/utils/api';

interface HealthData {
  uptime: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    systemTotal: number;
    systemFree: number;
    systemUsedPercent: number;
    heapUsedPercent: number;
  };
  cpu: { loadavg: number[]; cores: number };
  tasks: { total: number; pending: number; running: number; completed: number; failed: number };
  database: { dialect: string; status: string; error?: string };
  disk: Array<{ mount: string; total: number; free: number; usedPercent: number }>;
  version: string;
  pid: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

function PercentBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[11px] text-desktop-muted w-10 text-right shrink-0">{value}%</span>
    </div>
  );
}

function LoadBar({ value }: { value: number }) {
  // Normalize load average: each core can handle 1.0, so divide by core count
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 bg-blue-400"
          style={{ width: `${Math.min(value * 33, 100)}%` }}
        />
      </div>
      <span className="text-[11px] text-desktop-muted w-8 text-right shrink-0">{value.toFixed(2)}</span>
    </div>
  );
}

interface Props {
  windowId: string;
}

export function SystemMonitorApp({ windowId }: Props) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const data = await api.systemHealthGet();
      setHealth(data);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
    const interval = setInterval(loadHealth, 5000);
    return () => clearInterval(interval);
  }, [loadHealth]);

  const isHealthy = health && health.database.status === 'ok';

  return (
    <div className="h-full flex flex-col text-sm overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02] shrink-0">
        <Activity size={15} className="text-green-400" />
        <span className="text-xs font-medium text-desktop-text">系统监控</span>
        <div className="flex-1" />
        {isHealthy !== undefined && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            isHealthy ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
          }`}>
            {isHealthy ? '运行正常' : '异常'}
          </span>
        )}
        {lastUpdated && (
          <span className="text-[10px] text-desktop-muted/50">
            {lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
        <button
          onClick={loadHealth}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          title="刷新"
        >
          <RefreshCw size={13} className={`text-desktop-muted ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 text-xs border-b border-red-500/20">
          <AlertCircle size={13} />
          {error}
          <button className="ml-auto underline" onClick={() => setError(null)}>忽略</button>
        </div>
      )}

      {loading && !health ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw size={24} className="animate-spin text-desktop-muted" />
        </div>
      ) : health ? (
        <div className="flex-1 p-4 space-y-4 overflow-auto">
          {/* Top row: CPU + Memory */}
          <div className="grid grid-cols-2 gap-3">
            {/* CPU */}
            <div className="bg-white/[0.02] rounded-xl border border-white/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Cpu size={14} className="text-blue-400" />
                <span className="text-xs font-medium text-desktop-text">CPU</span>
                <span className="ml-auto text-[10px] text-desktop-muted">{health.cpu.cores} 核心</span>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] text-desktop-muted mb-1">
                    <span>1分钟负载</span>
                  </div>
                  <LoadBar value={health.cpu.loadavg[0]} />
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-desktop-muted mb-1">
                    <span>5分钟负载</span>
                  </div>
                  <LoadBar value={health.cpu.loadavg[1]} />
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-desktop-muted mb-1">
                    <span>15分钟负载</span>
                  </div>
                  <LoadBar value={health.cpu.loadavg[2]} />
                </div>
              </div>
            </div>

            {/* Memory */}
            <div className="bg-white/[0.02] rounded-xl border border-white/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <MemoryStick size={14} className="text-purple-400" />
                <span className="text-xs font-medium text-desktop-text">内存</span>
                <span className="ml-auto text-[10px] text-desktop-muted">
                  {formatBytes(health.memory.systemTotal - health.memory.systemFree)} / {formatBytes(health.memory.systemTotal)}
                </span>
              </div>
              <div className="space-y-2.5">
                <div>
                  <div className="flex justify-between text-[10px] text-desktop-muted mb-1">
                    <span>系统内存</span>
                  </div>
                  <PercentBar value={health.memory.systemUsedPercent} color="#a855f7" />
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-desktop-muted mb-1">
                    <span>Node 堆内存</span>
                  </div>
                  <PercentBar value={health.memory.heapUsedPercent} color="#8b5cf6" />
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="bg-white/[0.03] rounded-lg p-2 text-center">
                    <div className="text-[11px] text-desktop-muted">RSS</div>
                    <div className="text-[11px] font-medium text-desktop-text mt-0.5">{formatBytes(health.memory.rss)}</div>
                  </div>
                  <div className="bg-white/[0.03] rounded-lg p-2 text-center">
                    <div className="text-[11px] text-desktop-muted">堆使用</div>
                    <div className="text-[11px] font-medium text-desktop-text mt-0.5">{formatBytes(health.memory.heapUsed)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Disk usage */}
          {health.disk.length > 0 && (
            <div className="bg-white/[0.02] rounded-xl border border-white/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <HardDrive size={14} className="text-yellow-400" />
                <span className="text-xs font-medium text-desktop-text">磁盘</span>
              </div>
              <div className="space-y-2.5">
                {health.disk.map((d, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-[10px] text-desktop-muted mb-1">
                      <span>{d.mount}</span>
                      <span>{formatBytes(d.free)} 可用 / {formatBytes(d.total)}</span>
                    </div>
                    <PercentBar value={d.usedPercent} color="#f59e0b" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom row: Tasks + Server Info */}
          <div className="grid grid-cols-2 gap-3">
            {/* Tasks */}
            <div className="bg-white/[0.02] rounded-xl border border-white/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Server size={14} className="text-green-400" />
                <span className="text-xs font-medium text-desktop-text">任务统计</span>
                <span className="ml-auto text-[10px] text-desktop-muted">总计 {health.tasks.total}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '运行中', value: health.tasks.running, color: 'text-green-400', bg: 'bg-green-500/15' },
                  { label: '待处理', value: health.tasks.pending, color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
                  { label: '已完成', value: health.tasks.completed, color: 'text-blue-400', bg: 'bg-blue-500/15' },
                  { label: '失败', value: health.tasks.failed, color: 'text-red-400', bg: 'bg-red-500/15' },
                ].map((stat) => (
                  <div key={stat.label} className={`${stat.bg} rounded-lg p-2 text-center`}>
                    <div className={`text-sm font-bold ${stat.color}`}>{stat.value}</div>
                    <div className="text-[10px] text-desktop-muted mt-0.5">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Server Info */}
            <div className="bg-white/[0.02] rounded-xl border border-white/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Database size={14} className="text-cyan-400" />
                <span className="text-xs font-medium text-desktop-text">服务器</span>
                <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  isHealthy ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                }`}>
                  {health.database.status}
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-desktop-muted">数据库</span>
                  <span className="text-desktop-text/80 font-mono">{health.database.dialect}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-desktop-muted">Node 版本</span>
                  <span className="text-desktop-text/80 font-mono">{health.version}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-desktop-muted">进程 ID</span>
                  <span className="text-desktop-text/80 font-mono">{health.pid}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-desktop-muted">运行时长</span>
                  <span className="text-desktop-text/80">{formatUptime(health.uptime)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
