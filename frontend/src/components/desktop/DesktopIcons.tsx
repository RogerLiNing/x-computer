import { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import { useDesktopStore } from '@/store/desktopStore';
import { useConfigStore } from '@/store/configStore';
import { useMiniAppsStore } from '@/store/miniAppsStore';
import { useAdminStore } from '@/store/adminStore';
import { getAllApps } from '@/appRegistry';
import { useAppRegistryRevision } from '@/hooks/useAppRegistry';
import { getUserId } from '@/utils/userId';
import {
  FolderOpen,
  Folder,
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
  Puzzle,
  Trash2,
  Pencil,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { AppIdentifier, AppManifest } from '@shared/index';

const API_BASE = '/api';

const ICON_MAP: Record<string, LucideIcon> = {
  FolderOpen,
  Folder,
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
  Puzzle,
};

const GRID_COLS = 6;
const CELL_W = 96;
const CELL_H = 84;
const GAP = 10;

// Folder popup sizing - macOS style
const FOLDER_POPUP_MIN_COLS = 4;
const FOLDER_ICON_SIZE = 64;
const FOLDER_ICON_GAP = 12;

export function DesktopIcons() {
  const containerRef = useRef<HTMLDivElement>(null);
  const folderPopupRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const openApp = useDesktopStore((s) => s.openApp);
  const desktopIconPositions = useConfigStore((s) => s.desktopIconPositions);
  const setDesktopIconPosition = useConfigStore((s) => s.setDesktopIconPosition);
  const appFolders = useConfigStore((s) => s.appFolders);
  const appFolderAssignments = useConfigStore((s) => s.appFolderAssignments);
  const renameFolder = useConfigStore((s) => s.renameFolder);
  const removeFolder = useConfigStore((s) => s.removeFolder);
  const addAppToFolder = useConfigStore((s) => s.addAppToFolder);
  const removeAppFromFolder = useConfigStore((s) => s.removeAppFromFolder);
  const toggleFolderExpanded = useConfigStore((s) => s.toggleFolderExpanded);
  const miniApps = useMiniAppsStore((s) => s.list);
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const registryRevision = useAppRegistryRevision();
  const apps = useMemo(() => getAllApps(), [miniApps, isAdmin, registryRevision]);
  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);
  const [draggedAppId, setDraggedAppId] = useState<AppIdentifier | null>(null);
  const [hoveredFolderId, setHoveredFolderId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showFolderMenu, setShowFolderMenu] = useState<string | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number; above: boolean } | null>(null);

  // Filter apps into root-level and foldered apps
  const { rootApps } = useMemo(() => {
    const root: AppManifest[] = [];
    apps.forEach((app) => {
      const folderId = appFolderAssignments[app.id];
      if (!folderId) {
        root.push(app);
      }
    });
    return { rootApps: root };
  }, [apps, appFolderAssignments]);

  // Get apps for a specific folder
  const getAppsInFolder = useCallback((folderId: string) => {
    return apps.filter((app) => appFolderAssignments[app.id] === folderId);
  }, [appFolderAssignments, apps]);

  // Calculate popup size based on number of apps
  const getPopupGrid = useCallback((appCount: number) => {
    const cols = Math.max(FOLDER_POPUP_MIN_COLS, Math.min(appCount, 6));
    const rows = Math.ceil(appCount / cols) || 1;
    return { cols, rows };
  }, []);

  // Calculate popup position (smart - above or below based on space)
  const calculatePopupPosition = useCallback((folderId: string) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const folder = appFolders.find((f) => f.id === folderId);
    if (!folder) return null;

    const folderX = folder.col * (CELL_W + GAP) + 32;
    const folderY = folder.row * (CELL_H + GAP);
    const folderBottom = folderY + CELL_H;

    const viewportHeight = window.innerHeight;
    const popupHeight = 180; // Approximate, will be refined
    const spaceBelow = viewportHeight - folderBottom - rect.top - 20;
    const spaceAbove = folderY - 60;

    const above = spaceBelow < popupHeight && spaceAbove > spaceBelow;
    const x = Math.min(folderX, rect.width - 280);
    const y = above ? folderY - popupHeight - 10 : folderBottom + 10;

    return { x, y, above };
  }, [appFolders]);

  // Click outside to close folder popup and menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showFolderMenu && !document.getElementById(`folder-menu-${showFolderMenu}`)?.contains(e.target as Node)) {
        setShowFolderMenu(null);
      }
      if (renamingFolderId && !document.getElementById(`folder-${renamingFolderId}`)?.contains(e.target as Node)) {
        setRenamingFolderId(null);
      }
      if (
        expandedFolderId &&
        folderPopupRef.current &&
        !folderPopupRef.current.contains(e.target as Node) &&
        !document.getElementById(`folder-${expandedFolderId}`)?.contains(e.target as Node)
      ) {
        setExpandedFolderId(null);
        toggleFolderExpanded(expandedFolderId);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expandedFolderId, toggleFolderExpanded, showFolderMenu, renamingFolderId]);

  // Close folder on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (renamingFolderId) {
          setRenamingFolderId(null);
        } else if (expandedFolderId) {
          setExpandedFolderId(null);
          toggleFolderExpanded(expandedFolderId);
        } else if (showFolderMenu) {
          setShowFolderMenu(null);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expandedFolderId, toggleFolderExpanded, showFolderMenu, renamingFolderId]);

  // Focus rename input when renaming starts
  useEffect(() => {
    if (renamingFolderId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingFolderId]);

  // Position popup when folder expands
  useEffect(() => {
    if (expandedFolderId) {
      const pos = calculatePopupPosition(expandedFolderId);
      setPopupPosition(pos);
    }
  }, [expandedFolderId, calculatePopupPosition]);

  // Pre-calculate all positions
  const allPositions = useMemo(() => {
    const positions = new Map<string, { col: number; row: number }>();
    const occupied = new Set<string>();

    appFolders.forEach((folder) => {
      occupied.add(`${folder.col},${folder.row}`);
      positions.set(`folder_${folder.id}`, { col: folder.col, row: folder.row });
    });

    rootApps.forEach((app, i) => {
      const key = String(app.id);
      const savedPos = desktopIconPositions[key];

      if (savedPos) {
        positions.set(key, savedPos);
        occupied.add(`${savedPos.col},${savedPos.row}`);
      } else {
        let col = i % GRID_COLS;
        let row = Math.floor(i / GRID_COLS);

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
  }, [rootApps, desktopIconPositions, appFolders]);

  const getPosition = useCallback(
    (appId: AppIdentifier) => {
      const key = String(appId);
      return allPositions.get(key) || { col: 0, row: 0 };
    },
    [allPositions],
  );

  const getFolderPosition = useCallback(
    (folderId: string) => {
      const folder = appFolders.find((f) => f.id === folderId);
      return folder ? { col: folder.col, row: folder.row } : { col: 0, row: 0 };
    },
    [appFolders],
  );

  const handleDragStart = useCallback((e: React.DragEvent, appId: AppIdentifier) => {
    e.dataTransfer.setData('application/x-desktop-icon', String(appId));
    e.dataTransfer.effectAllowed = 'move';
    setDraggedAppId(appId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedAppId(null);
    setHoveredFolderId(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleFolderDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setHoveredFolderId(folderId);
  }, []);

  const handleFolderDragLeave = useCallback(() => {
    setHoveredFolderId(null);
  }, []);

  const handleFolderDrop = useCallback(
    (e: React.DragEvent, folderId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const appId = e.dataTransfer.getData('application/x-desktop-icon') || '';
      if (appId) {
        addAppToFolder(folderId, appId as AppIdentifier);
      }
      setHoveredFolderId(null);
      setExpandedFolderId(null);
      toggleFolderExpanded(folderId);
    },
    [addAppToFolder, toggleFolderExpanded],
  );

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

      const isOccupied = rootApps.some((app) => {
        if (app.id === appId) return false;
        const pos = getPosition(app.id);
        return pos.col === c && pos.row === r;
      });

      if (isOccupied) {
        const occupiedPositions = new Set<string>();
        rootApps.forEach((app) => {
          if (app.id !== appId) {
            const pos = getPosition(app.id);
            occupiedPositions.add(`${pos.col},${pos.row}`);
          }
        });

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
    [rootApps, apps, setDesktopIconPosition, getPosition],
  );

  const handleFolderClick = useCallback((folderId: string) => {
    if (expandedFolderId === folderId) {
      setExpandedFolderId(null);
      toggleFolderExpanded(folderId);
    } else {
      setExpandedFolderId(folderId);
      toggleFolderExpanded(folderId);
    }
  }, [expandedFolderId, toggleFolderExpanded]);

  const handleFolderDoubleClick = useCallback((folderId: string, currentName: string) => {
    setRenamingFolderId(folderId);
    setRenameValue(currentName);
  }, []);

  const handleRenameSubmit = useCallback((folderId: string) => {
    if (renameValue.trim()) {
      renameFolder(folderId, renameValue.trim());
    }
    setRenamingFolderId(null);
    setRenameValue('');
  }, [renameValue, renameFolder]);

  const handleDeleteFolder = useCallback((folderId: string) => {
    if (expandedFolderId === folderId) {
      setExpandedFolderId(null);
      toggleFolderExpanded(folderId);
    }
    removeFolder(folderId);
    setShowFolderMenu(null);
  }, [expandedFolderId, toggleFolderExpanded, removeFolder]);

  const handleRemoveAppFromFolder = useCallback((folderId: string, appId: string) => {
    removeAppFromFolder(folderId, appId);
  }, [removeAppFromFolder]);

  const sortedApps = useMemo(
    () => [...rootApps].sort((a, b) => {
      const pa = getPosition(a.id);
      const pb = getPosition(b.id);
      return pa.row !== pb.row ? pa.row - pb.row : pa.col - pb.col;
    }),
    [rootApps, getPosition],
  );

  const sortedFolders = useMemo(
    () => [...appFolders].sort((a, b) => {
      return a.row !== b.row ? a.row - b.row : a.col - b.col;
    }),
    [appFolders],
  );

  const expandedFolder = useMemo(
    () => appFolders.find((f) => f.id === expandedFolderId),
    [appFolders, expandedFolderId],
  );

  const expandedFolderApps = expandedFolder ? getAppsInFolder(expandedFolder.id) : [];
  const popupGrid = getPopupGrid(expandedFolderApps.length);

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
        {/* Render folders */}
        {sortedFolders.map((folder) => {
          const pos = getFolderPosition(folder.id);
          const isExpanded = expandedFolderId === folder.id;
          const folderApps = getAppsInFolder(folder.id);
          const isHovered = hoveredFolderId === folder.id && draggedAppId !== null;
          const isRenaming = renamingFolderId === folder.id;

          return (
            <div
              id={`folder-${folder.id}`}
              key={`folder_${folder.id}`}
              data-folder-id={folder.id}
              className="flex items-center justify-center relative"
              style={{
                gridColumnStart: pos.col + 1,
                gridRowStart: pos.row + 1,
              }}
              onDragOver={(e) => handleFolderDragOver(e, folder.id)}
              onDragLeave={handleFolderDragLeave}
              onDrop={(e) => handleFolderDrop(e, folder.id)}
            >
              {/* macOS-style folder icon */}
              <div
                className={`relative flex flex-col items-center cursor-pointer select-none transition-all duration-200 ${
                  isExpanded ? 'scale-110' : isHovered ? 'scale-105' : 'hover:scale-105'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleFolderClick(folder.id);
                }}
              >
                {/* Folder icon container */}
                <div className={`
                  relative w-16 h-14 transition-all duration-200
                  ${isHovered && draggedAppId ? 'scale-110' : ''}
                `}>
                  {/* macOS folder shape - back panel */}
                  <div className="absolute inset-0 bg-gradient-to-b from-amber-300 to-amber-500 rounded-lg shadow-lg" />
                  {/* macOS folder shape - front flap */}
                  <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-b from-amber-200 to-amber-400 rounded-b-lg" style={{ clipPath: 'polygon(0 30%, 15% 0, 85% 0, 100% 30%, 100% 100%, 0 100%)' }} />
                  {/* Folder tab */}
                  <div className="absolute -top-0.5 left-1 w-5 h-2 bg-gradient-to-b from-amber-200 to-amber-400 rounded-t-md" />
                  {/* App count badge */}
                  {folderApps.length > 0 && (
                    <div className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-desktop-accent rounded-full flex items-center justify-center shadow-md">
                      <span className="text-[10px] font-semibold text-white">{folderApps.length}</span>
                    </div>
                  )}
                  {/* Hover/highlight effect */}
                  {isHovered && draggedAppId && (
                    <div className="absolute inset-0 bg-white/20 rounded-lg border-2 border-dashed border-white/50" />
                  )}
                  {isExpanded && (
                    <div className="absolute inset-0 bg-white/10 rounded-lg ring-2 ring-desktop-accent" />
                  )}
                </div>

                {/* Label */}
                <div className="mt-1 max-w-[72px]">
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(folder.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSubmit(folder.id);
                        if (e.key === 'Escape') {
                          setRenamingFolderId(null);
                          setRenameValue('');
                        }
                      }}
                      className="w-full bg-black/60 text-white text-[11px] text-center rounded px-1 py-0.5 outline-none border border-desktop-accent"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="block text-[11px] text-white text-center drop-shadow-lg leading-tight line-clamp-2 px-1 py-0.5 rounded hover:bg-white/20 cursor-text"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleFolderDoubleClick(folder.id, folder.name);
                      }}
                    >
                      {folder.name}
                    </span>
                  )}
                </div>
              </div>

              {/* Folder context menu */}
              {showFolderMenu === folder.id && (
                <div
                  id={`folder-menu-${folder.id}`}
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-desktop-surface/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl py-1 min-w-[140px] overflow-hidden animate-scale-in"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-desktop-text hover:bg-white/10 transition-colors"
                    onClick={() => {
                      handleFolderDoubleClick(folder.id, folder.name);
                      setShowFolderMenu(null);
                    }}
                  >
                    <Pencil size={12} />
                    <span>重命名</span>
                  </button>
                  <div className="h-px bg-white/10 my-1" />
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                    onClick={() => handleDeleteFolder(folder.id)}
                  >
                    <Trash2 size={12} />
                    <span>删除</span>
                  </button>
                </div>
              )}

              {/* Right-click trigger */}
              <div
                className="absolute top-1 -right-1 w-4 h-4 opacity-0 hover:opacity-100 cursor-pointer z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFolderMenu(showFolderMenu === folder.id ? null : folder.id);
                }}
              >
                <div className="w-full h-full bg-black/40 rounded-full flex items-center justify-center">
                  <span className="text-[8px] text-white/70">⋮</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Render root-level apps */}
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
              <div className="flex flex-col items-center cursor-pointer select-none group" onDoubleClick={() => openApp(app.id)}>
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-desktop-accent to-desktop-highlight/60 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform relative overflow-hidden">
                  {isMiniApp && miniAppIconUrl ? (
                    <>
                      <img
                        src={miniAppIconUrl}
                        alt=""
                        className="w-full h-full object-contain rounded-2xl"
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
                    <Icon size={28} className="text-white drop-shadow-lg" />
                  )}
                  {app.availability === 'demo' && (
                    <span className="absolute -top-0.5 -right-0.5 px-1 py-0.5 rounded text-[9px] bg-white/20 text-white/90 backdrop-blur-sm">演示</span>
                  )}
                </div>
                <span className="mt-1 text-[11px] text-white drop-shadow-lg group-hover:text-desktop-text text-center leading-tight line-clamp-2 max-w-[72px] px-1 py-0.5 rounded hover:bg-white/20">
                  {app.name}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Folder popup - macOS style */}
      {expandedFolder && popupPosition && (
        <div
          ref={folderPopupRef}
          className="fixed z-[9999] pointer-events-auto animate-scale-in"
          style={{
            left: popupPosition.x,
            top: popupPosition.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Popup arrow */}
          <div
            className={`absolute left-8 -translate-x-0 w-4 h-2 overflow-hidden ${
              popupPosition.above ? '-bottom-2 rotate-180' : '-top-2'
            }`}
          >
            <div className="w-4 h-4 bg-desktop-surface/95 backdrop-blur-xl border border-white/20 mx-auto" style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }} />
          </div>

          {/* Popup content */}
          <div className="bg-desktop-surface/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen size={16} className="text-amber-400" />
                <span className="text-sm font-medium text-desktop-text">{expandedFolder.name}</span>
              </div>
              <button
                className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-desktop-muted hover:text-desktop-text transition-colors"
                onClick={() => {
                  setExpandedFolderId(null);
                  toggleFolderExpanded(expandedFolder.id);
                }}
              >
                <X size={14} />
              </button>
            </div>

            {/* App grid */}
            <div
              className="p-3"
              style={{
                minWidth: popupGrid.cols * (FOLDER_ICON_SIZE / 2 + FOLDER_ICON_GAP),
              }}
            >
              {expandedFolderApps.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-white/5 flex items-center justify-center">
                    <Folder size={32} className="text-desktop-muted/30" />
                  </div>
                  <p className="text-xs text-desktop-muted">拖拽应用到此处添加</p>
                </div>
              ) : (
                <div
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns: `repeat(${popupGrid.cols}, ${FOLDER_ICON_SIZE / 2 + FOLDER_ICON_GAP}px)`,
                  }}
                >
                  {expandedFolderApps.map((app) => {
                    const Icon = ICON_MAP[app.icon] ?? FileText;
                    const isMiniApp = app.source === 'miniapp';
                    const miniAppIconUrl = isMiniApp
                      ? `${API_BASE}/apps/sandbox/${encodeURIComponent(getUserId())}/apps/${app.id}/icon.png`
                      : '';
                    return (
                      <div key={app.id} className="flex flex-col items-center group">
                        <button
                          className="w-14 h-14 rounded-xl bg-gradient-to-br from-desktop-accent/80 to-desktop-highlight/40 flex items-center justify-center shadow-md hover:scale-105 transition-transform relative"
                          onDoubleClick={() => openApp(app.id)}
                        >
                          {isMiniApp && miniAppIconUrl ? (
                            <>
                              <img
                                src={miniAppIconUrl}
                                alt=""
                                className="w-full h-full object-contain rounded-xl"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            </>
                          ) : (
                            <Icon size={22} className="text-white" />
                          )}
                          {/* Remove button */}
                          <button
                            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity hover:bg-red-500"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveAppFromFolder(expandedFolder.id, app.id as string);
                            }}
                          >
                            <X size={10} />
                          </button>
                        </button>
                        <span className="mt-1 text-[10px] text-desktop-text/80 text-center leading-tight line-clamp-2 max-w-[60px]">
                          {app.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
