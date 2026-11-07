/**
 * Context Usage Treemap — ECharts treemap with drill-down
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as echarts from 'echarts';

interface TreemapItem {
  name: string;
  value: number;
  children?: TreemapItem[];
  content?: string;
}

interface ContextBreakdown {
  system: { tokens: number; chars: number };
  user: { tokens: number; chars: number };
  assistant: { tokens: number; chars: number };
  toolCalls: { tokens: number; chars: number };
}

interface ContextTreemapProps {
  stats: {
    estimatedTokens: number;
    modelContextLimit: number;
    usagePercent: number;
    treemapData: Array<{ name: string; value: number; chars: number; children: unknown[] }>;
    breakdown: ContextBreakdown;
  } | null;
  onClose?: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  '系统消息': '#7c3aed',
  '用户消息': '#2563eb',
  '助手回复': '#059669',
  '工具调用': '#d97706',
};

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
}

function makeColorPalette(baseColor: string, count: number): string[] {
  const hex = baseColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return Array.from({ length: count }, (_, i) => {
    const t = 0.5 + (i / Math.max(1, count - 1)) * 0.5;
    const rr = Math.round(r * t + 30 * (1 - t));
    const gg = Math.round(g * t + 30 * (1 - t));
    const bb = Math.round(b * t + 30 * (1 - t));
    return `rgb(${rr},${gg},${bb})`;
  });
}

export function ContextTreemap({ stats, onClose }: ContextTreemapProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const gaugeRef = useRef<HTMLDivElement>(null);
  const gaugeInstanceRef = useRef<echarts.ECharts | null>(null);
  // drill-down 栈：每层是当前可见的节点列表
  const [drillStack, setDrillStack] = useState<TreemapItem[][]>([]);
  // 面包屑路径：记录每层被点击的父节点名
  const [drillPath, setDrillPath] = useState<string[]>([]);
  const [selectedLeaf, setSelectedLeaf] = useState<{ name: string; content: string } | null>(null);

  // 构建顶层数据
  const topLevelData: TreemapItem[] = stats?.treemapData.map((item) => ({
    name: item.name,
    value: item.value,
    children: (item.children as TreemapItem[]) || [],
  })) ?? [];

  // 当前可见的数据
  const currentData: TreemapItem[] = drillStack.length > 0
    ? drillStack[drillStack.length - 1]
    : topLevelData;

  const isTopLevel = drillStack.length === 0;

  const handleBack = useCallback(() => {
    setDrillStack((prev) => prev.slice(0, -1));
    setDrillPath((prev) => prev.slice(0, -1));
    setSelectedLeaf(null);
  }, []);

  useEffect(() => {
    // 数据变化时重置 drill-down
    setDrillStack([]);
    setDrillPath([]);
    setSelectedLeaf(null);
  }, [stats?.estimatedTokens]);

  useEffect(() => {
    if (!chartRef.current || !stats) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;

    // 确保 chart 有合适的尺寸
    chart.resize();

    const totalTokens = stats.estimatedTokens;

    // 构建 treemap 数据，为 children 着色
    const parentColor = isTopLevel ? '' : (drillStack.length > 0 ? CATEGORY_COLORS[drillStack[drillStack.length - 1]?.[0]?.name] || '' : '');

    const data: TreemapItem[] = currentData.map((item) => {
      const color = CATEGORY_COLORS[item.name] || '#6b7280';
      // 保证每个块至少有 0.5% 的最小可见面积
      const minVisible = Math.max(1, Math.ceil(totalTokens * 0.005));
      const hasChildren = item.children && item.children.length > 0;
      let children: TreemapItem[] | undefined;
      if (hasChildren) {
        const palette = makeColorPalette(color, item.children!.length);
        children = item.children!.map((child: TreemapItem, i: number) => ({
          ...child,
          value: Math.max(child.value, 1),
          itemStyle: { color: palette[i] },
        }));
      }
      const displayValue = item.value > 0 ? Math.max(item.value, minVisible) : minVisible;
      return {
        name: item.name,
        value: displayValue,
        itemStyle: { color, ...(item.value === 0 ? { opacity: 0.3 } : {}) },
        children,
      } as TreemapItem;
    });

    // 计算合适的 label 字号
    const showSubLabel = currentData.length <= 12;

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number; treePathInfo?: Array<{ name: string }> };
          const path = p.treePathInfo?.map((n) => n.name).join(' › ') || p.name;
          const percent = totalTokens > 0 ? Math.round((p.value / totalTokens) * 100) : 0;
          return `<b>${p.name}</b><br/>${formatTokens(p.value)} tokens (${percent}%)<br/><span style="color:#999;font-size:10px">${path}</span>`;
        },
      },
      series: [
        {
          type: 'treemap',
          width: '100%',
          height: '100%',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: {
            show: true,
            formatter: (params: unknown) => {
              const p = params as { name: string; value: number };
              const percent = totalTokens > 0 ? Math.round((p.value / totalTokens) * 100) : 0;
              if (percent < 1) return '';
              if (showSubLabel) {
                return `{name|${p.name}}\n{val|${formatTokens(p.value)} (${percent}%)}`;
              }
              return `{name|${p.name}}\n{val|${formatTokens(p.value)}}`;
            },
            rich: {
              name: { fontSize: 11, color: '#fff', lineHeight: 16 },
              val: { fontSize: 10, color: 'rgba(255,255,255,0.7)', lineHeight: 14 },
            },
          },
          upperLabel: {
            show: true,
            height: 22,
            formatter: (params: unknown) => {
              const p = params as { name: string; value: number };
              const percent = totalTokens > 0 ? Math.round((p.value / totalTokens) * 100) : 0;
              return `${p.name}  ${formatTokens(p.value)} (${percent}%)`;
            },
            fontSize: 11,
            fontWeight: 'bold',
            color: '#fff',
          },
          itemStyle: {
            borderColor: 'rgba(255,255,255,0.12)',
            borderWidth: 2,
            gapWidth: 2,
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0,0,0,0.6)',
              borderWidth: 3,
            },
          },
          data,
        },
      ],
    };

    chart.setOption(option);

    // 点击事件：有 children → drill down；无 children → 选为叶子
    const clickHandler = (params: { name: string; data?: { children?: TreemapItem[]; value: number } }) => {
      const node = params.data;
      if (node?.children && node.children.length > 0) {
        setDrillStack((prev: TreemapItem[][]) => [...prev, node.children!]);
        setDrillPath((prev: string[]) => [...prev, params.name]);
        setSelectedLeaf(null);
      } else if (node) {
        setSelectedLeaf({
          name: params.name,
          content: (node as TreemapItem).content || `${formatTokens(node.value)} tokens`,
        });
      }
    };
    chart.on('click', clickHandler as unknown as (params: unknown) => void);

    const resizeHandler = () => chart.resize();
    window.addEventListener('resize', resizeHandler);

    return () => {
      chart.off('click', clickHandler);
      window.removeEventListener('resize', resizeHandler);
    };
  }, [stats, currentData, isTopLevel, drillStack]);

  // Gauge chart
  useEffect(() => {
    if (!gaugeRef.current || !stats) return;

    if (!gaugeInstanceRef.current) {
      gaugeInstanceRef.current = echarts.init(gaugeRef.current);
    }
    const gauge = gaugeInstanceRef.current;

    const usagePercent = stats.usagePercent;
    const colorStops = usagePercent > 80
      ? [[0.6, '#ef4444'], [0.8, '#f59e0b'], [1, '#ef4444']]
      : usagePercent > 60
        ? [[0.6, '#f59e0b'], [0.8, '#22c55e'], [1, '#f59e0b']]
        : [[0.6, '#22c55e'], [0.8, '#22c55e'], [1, '#f59e0b']];

    gauge.setOption({
      series: [{
        type: 'gauge',
        startAngle: 210,
        endAngle: -30,
        center: ['50%', '55%'],
        radius: '90%',
        min: 0,
        max: 100,
        splitNumber: 5,
        axisLine: {
          show: true,
          lineStyle: {
            width: 8,
            color: [colorStops],
          },
        },
        pointer: {
          icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
          length: '60%',
          width: 4,
          offsetCenter: [0, '-10%'],
          itemStyle: {
            color: '#fff',
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          valueAnimation: true,
          formatter: '{value}%',
          fontSize: 16,
          fontWeight: 'bold',
          color: '#fff',
          offsetCenter: [0, '40%'],
        },
        data: [{ value: usagePercent }],
      }],
    });

    const resizeHandler = () => gauge.resize();
    window.addEventListener('resize', resizeHandler);

    return () => {
      window.removeEventListener('resize', resizeHandler);
    };
  }, [stats]);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
      gaugeInstanceRef.current?.dispose();
      gaugeInstanceRef.current = null;
    };
  }, []);

  if (!stats) return null;

  const { breakdown, estimatedTokens, modelContextLimit, usagePercent } = stats;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#161616] border border-white/20 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#C8A96E] to-purple-500 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-200">上下文使用分析</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Breadcrumb + Stats */}
        <div className="px-5 py-2 border-b border-white/10 space-y-1.5">
          {/* Breadcrumb path */}
          {!isTopLevel && drillPath.length > 0 && (
            <div className="flex items-center gap-1 text-[11px] flex-wrap">
              <button
                className="text-gray-400 hover:text-purple-400 transition-colors font-medium"
                onClick={() => { setDrillStack([]); setDrillPath([]); setSelectedLeaf(null); }}
              >
                全部
              </button>
              {drillPath.map((name, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-white/20">/</span>
                  <button
                    className={`hover:text-purple-400 transition-colors truncate max-w-[160px] ${
                      i === drillPath.length - 1 ? 'text-gray-200 font-medium' : 'text-gray-400'
                    }`}
                    onClick={() => {
                      setDrillStack((prev) => prev.slice(0, i + 1));
                      setDrillPath((prev) => prev.slice(0, i + 1));
                      setSelectedLeaf(null);
                    }}
                  >
                    {name}
                  </button>
                </span>
              ))}
              <button
                onClick={handleBack}
                className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-white/10 hover:bg-white/15 text-gray-400 hover:text-gray-200 transition-colors"
              >
                ← 返回
              </button>
            </div>
          )}
          {isTopLevel && (
            <p className="text-[11px] text-gray-400">点击区块进入详情，点击叶子查看内容</p>
          )}

          {/* Stats + Gauge */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-sm font-bold text-gray-200">{formatTokens(estimatedTokens)}</div>
                <div className="text-[10px] text-gray-400">已用</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold text-gray-200">{formatTokens(modelContextLimit)}</div>
                <div className="text-[10px] text-gray-400">上限</div>
              </div>
            </div>
            <div ref={gaugeRef} className="w-[80px] h-[50px] shrink-0" />
          </div>
        </div>

        {/* Treemap Chart */}
        <div className="flex-1 p-3 min-h-[300px] relative">
          <div ref={chartRef} className="w-full h-full" style={{ minHeight: '280px' }} />

          {/* Selected leaf detail panel */}
          {selectedLeaf && (
            <div className="absolute inset-0 flex flex-col bg-[#0D0D0D]/95 border border-white/10 rounded-lg m-1 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.03] shrink-0">
                <span className="text-xs font-medium text-gray-200 truncate">{selectedLeaf.name}</span>
                <button
                  className="text-[10px] text-gray-400 hover:text-gray-200 px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
                  onClick={() => setSelectedLeaf(null)}
                >
                  关闭 ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <pre className="text-[11px] text-gray-200 whitespace-pre-wrap break-words font-sans leading-relaxed m-0">
                  {selectedLeaf.content}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="px-5 py-2.5 border-t border-white/10 bg-white/[0.02]">
          <div className="grid grid-cols-4 gap-3">
            {Object.entries(breakdown).map(([key, data]) => {
              const labels: Record<string, string> = {
                system: '系统消息',
                user: '用户消息',
                assistant: '助手回复',
                toolCalls: '工具调用',
              };
              const label = labels[key] || key;
              const percent = Math.round((data.tokens / estimatedTokens) * 100) || 0;

              return (
                <div key={key} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: CATEGORY_COLORS[label] || '#6b7280' }}
                  />
                  <div className="min-w-0">
                    <div className="text-[10px] text-gray-400 truncate">{label}</div>
                    <div className="text-[11px] font-medium text-gray-200">
                      {formatTokens(data.tokens)} <span className="text-gray-400 text-[10px]">({percent}%)</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
