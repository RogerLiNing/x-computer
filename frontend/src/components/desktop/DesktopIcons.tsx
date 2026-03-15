import { useRef, useCallback, useMemo } from 'react';
import { useDesktopStore } from '@/store/desktopStore';
import { useMiniAppsStore } from '@/store/miniAppsStore';
import { useAdminStore } from '@/store/adminStore';
import { getAllApps } from '@/appRegistry';
import { getUserId } from '@/utils/userId';
import {
  FolderOpen,
  Terminal,
  Globe,
  MessageSquare,
  Brain,
  Code,
  FileText,
  Mail,
  Calendar,
  Table,
  Settings,
  Clock,
  Layout,
  FileSpreadsheet,
  Image,
  Bot,
  Play,
  Kanban,
  CreditCard,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import type { AppIdentifier } from '@shared/index';

const API_BASE = '/api';

const ICON_MAP: Record<string, LucideIcon> = {
  FolderOpen,
  Terminal,
  Globe,
  MessageSquare,
  Brain,
  Code,
  FileText,
  Mail,
  Calendar,
  Table,
  Settings,
  Clock,
  Layout, // X 制作的小程序
  FileSpreadsheet,
  Image,
  Bot,
  Play,
  Kanban,
  CreditCard,
  Shield,
};

const GRID_COLS = 6;
const CELL_W = 96;
const CELL_H = 84;
const GAP = 10;

export function DesktopIcons() {
  const containerRef = useRef<HTMLDivElement>(null);
  const openApp = useDesktopStore((s) => s.openApp);
  const desktopIconPositions = useDesktopStore((s) => s.desktopIconPositions);
  const setDesktopIconPosition = useDesktopStore((s) => s.setDesktopIconPosition);
  const miniApps = useMiniAppsStore((s) => s.list);
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const apps = useMemo(() => getAllApps(), [miniApps, isAdmin]);

  // 预计算所有应用的位置，避免递归
  const allPositions = useMemo(() => {
    const positions = new Map<string, { col: number; row: number }>();
    const occupied = new Set<string>();
    
    apps.forEach((app, i) => {
      const key = String(app.id);
      const savedPos = desktopIconPositions[key];
      
      if (savedPos) {
        // 使用保存的位置
        positions.set(key, savedPos);
        occupied.add(`${savedPos.col},${savedPos.row}`);
      } else {
        // 计算默认位置，确保不重叠
        let col = i % GRID_COLS;
        let row = Math.floor(i / GRID_COLS);
        
        // 如果位置被占用，找下一个空位
        while (occupied.has(`${col},${row}`)) {
          col++;
          if (col >= GRID_COLS) {
            col = 0;
            row++;
          }
        }
        
        positions.set(key, { col, row });
        occupied.add(`${col},${row}`);
      }
    });
    
    return positions;
  }, [apps, desktopIconPositions]);

  const getPosition = useCallback(
    (appId: AppIdentifier) => {
      const key = String(appId);
      return allPositions.get(key) || { col: 0, row: 0 };
    },
    [allPositions],
  );

  const handleDragStart = useCallback((e: React.DragEvent, appId: AppIdentifier) => {
    e.dataTransfer.setData('application/x-desktop-icon', String(appId));
    e.dataTransfer.effectAllowed = 'move';
    (e.target as HTMLElement).classList.add('opacity-50');
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove('opacity-50');
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const appId = e.dataTransfer.getData('application/x-desktop-icon') || '';
      if (!appId || !apps.some((a) => a.id === appId)) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const col = Math.floor(x / (CELL_W + GAP));
      const row = Math.floor(y / (CELL_H + GAP));
      let c = Math.max(0, Math.min(col, GRID_COLS - 1));
      let r = Math.max(0, row);
      
      // 检查目标位置是否已被占用
      const isOccupied = apps.some((app) => {
        if (app.id === appId) return false; // 排除自己
        const pos = getPosition(app.id);
        return pos.col === c && pos.row === r;
      });
      
      // 如果位置被占用，找到最近的空位
      if (isOccupied) {
        const occupiedPositions = new Set<string>();
        apps.forEach((app) => {
          if (app.id !== appId) {
            const pos = getPosition(app.id);
            occupiedPositions.add(`${pos.col},${pos.row}`);
          }
        });
        
        // 从目标位置开始，螺旋搜索最近的空位
        let found = false;
        let radius = 1;
        while (!found && radius < 20) {
          for (let dr = -radius; dr <= radius && !found; dr++) {
            for (let dc = -radius; dc <= radius && !found; dc++) {
              if (Math.abs(dr) === radius || Math.abs(dc) === radius) {
                const testCol = c + dc;
                const testRow = r + dr;
                if (testCol >= 0 && testCol < GRID_COLS && testRow >= 0) {
                  if (!occupiedPositions.has(`${testCol},${testRow}`)) {
                    c = testCol;
                    r = testRow;
                    found = true;
                  }
                }
              }
            }
          }
          radius++;
        }
      }
      
      setDesktopIconPosition(appId, c, r);
    },
    [apps, setDesktopIconPosition, getPosition],
  );

  const sortedApps = useMemo(
    () => [...apps].sort((a, b) => {
      const pa = getPosition(a.id);
      const pb = getPosition(b.id);
      return pa.row !== pb.row ? pa.row - pb.row : pa.col - pb.col;
    }),
    [apps, getPosition],
  );

  return (
    <div className="absolute inset-0 pointer-events-none pt-4 pl-4">
      <div
        ref={containerRef}
        className="pointer-events-auto grid w-max"
        style={{
          gridTemplateColumns: `repeat(${GRID_COLS}, ${CELL_W}px)`,
          gridAutoRows: CELL_H,
          gap: GAP,
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {sortedApps.map((app) => {
          const pos = getPosition(app.id);
          const Icon = ICON_MAP[app.icon] ?? FileText;
          const isMiniApp = app.source === 'miniapp';
          const miniAppIconUrl = isMiniApp
            ? `${API_BASE}/apps/sandbox/${encodeURIComponent(getUserId())}/apps/${app.id}/icon.png`
            : '';
          return (
            <div
              key={app.id}
              className="flex items-center justify-center cursor-grab active:cursor-grabbing"
              style={{
                gridColumnStart: pos.col + 1,
                gridRowStart: pos.row + 1,
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, app.id)}
              onDragEnd={handleDragEnd}
            >
              <button
                type="button"
                className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-white/10 transition-colors text-left w-[88px] group touch-none"
                onDoubleClick={() => openApp(app.id)}
                onClick={(e) => e.preventDefault()}
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-desktop-accent to-desktop-highlight/60 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform shrink-0 relative overflow-hidden">
                  {isMiniApp && miniAppIconUrl ? (
                    <>
                      <img
                        src={miniAppIconUrl}
                        alt=""
                        className="w-full h-full object-contain rounded-xl"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ display: 'none' }}
                        aria-hidden
                      >
                        <Layout size={24} className="text-white" />
                      </div>
                    </>
                  ) : (
                    <Icon size={24} className="text-white" />
                  )}
                  {app.availability === 'demo' && (
                    <span className="absolute -top-0.5 -right-0.5 px-1 py-0.5 rounded text-[9px] bg-white/20 text-white/90">演示</span>
                  )}
                </div>
                <span className="text-[11px] text-desktop-text/80 group-hover:text-desktop-text text-center leading-tight line-clamp-2 w-full">
                  {app.name}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
