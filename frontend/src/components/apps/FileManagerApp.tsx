import { useState, useEffect, useCallback } from 'react';
import {
  Folder, File, ChevronRight, ArrowUp, Home, HardDrive,
  Trash2, Search, RefreshCw, Edit, FolderPlus, FilePlus,
  ArrowUpDown, ArrowUp as ArrowUpIcon, ArrowDown, Download, Upload, Copy,
} from 'lucide-react';
import { api } from '@/utils/api';
import { useDesktopStore } from '@/store/desktopStore';
import type { FileEntry } from '@/store/desktopStore';

interface Props {
  windowId: string;
  metadata?: Record<string, unknown>;
}

export function FileManagerApp({ windowId, metadata }: Props) {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newItemMode, setNewItemMode] = useState<'file' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  type SortKey = 'name' | 'size' | 'modified' | 'created';
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);

  const { openApp, showContextMenu, addNotification } = useDesktopStore();

  useEffect(() => {
    api.getWorkspacePath()
      .then((r) => setWorkspacePath(r.path ?? null))
      .catch(() => setWorkspacePath(null));
  }, []);

  const formatDateTime = (iso: string | undefined): string => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).replace(/\//g, '-');
    } catch {
      return iso;
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const loadFiles = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listFiles(dirPath);
      setFiles(result.entries || []);
    } catch (err: any) {
      setError(err.message);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath, loadFiles]);

  const navigateTo = (name: string) => {
    const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    setCurrentPath(newPath);
    setSelectedFiles(new Set());
    setSearch('');
  };

  const goUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length === 0 ? '/' : '/' + parts.join('/'));
    setSelectedFiles(new Set());
  };

  const handleDelete = async (name: string) => {
    const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    try {
      await api.deleteFile(fullPath);
      addNotification({ type: 'info', title: '已删除', message: `${name} 已删除` });
      loadFiles(currentPath);
    } catch (err: any) {
      addNotification({ type: 'error', title: '删除失败', message: err.message });
    }
  };

  const handleRename = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) {
      setRenaming(null);
      return;
    }
    const oldPath = currentPath === '/' ? `/${oldName}` : `${currentPath}/${oldName}`;
    const newPath = currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;
    try {
      await api.renameFile(oldPath, newPath);
      addNotification({ type: 'info', title: '已重命名', message: `${oldName} → ${newName}` });
      loadFiles(currentPath);
    } catch (err: any) {
      addNotification({ type: 'error', title: '重命名失败', message: err.message });
    }
    setRenaming(null);
  };

  const handleCreateNew = async () => {
    if (!newItemName.trim()) {
      setNewItemMode(null);
      return;
    }
    const fullPath = currentPath === '/' ? `/${newItemName}` : `${currentPath}/${newItemName}`;
    try {
      if (newItemMode === 'folder') {
        await api.createDir(fullPath);
      } else {
        await api.writeFile(fullPath, '');
      }
      addNotification({
        type: 'info',
        title: `已创建${newItemMode === 'folder' ? '文件夹' : '文件'}`,
        message: newItemName,
      });
      loadFiles(currentPath);
    } catch (err: any) {
      addNotification({ type: 'error', title: '创建失败', message: err.message });
    }
    setNewItemMode(null);
    setNewItemName('');
  };

  const openFile = (name: string) => {
    const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'];
    const officeExts = ['docx', 'xlsx', 'pptx'];
    const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'json', 'yaml', 'yml', 'toml'];
    const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];
    const videoExts = ['mp4', 'webm', 'mov', 'ogg'];
    if (imageExts.includes(ext)) {
      openApp('image-viewer', { filePath: fullPath, fileName: name });
    } else if (officeExts.includes(ext)) {
      openApp('office-viewer', { filePath: fullPath, fileName: name });
    } else if (audioExts.includes(ext)) {
      openApp('media-viewer', { filePath: fullPath, fileName: name, mediaType: 'audio' });
    } else if (videoExts.includes(ext)) {
      openApp('media-viewer', { filePath: fullPath, fileName: name, mediaType: 'video' });
    } else if (codeExts.includes(ext)) {
      openApp('code-editor', { filePath: fullPath, fileName: name });
    } else {
      openApp('text-editor', { filePath: fullPath, fileName: name });
    }
  };

  const handleDownload = async (name: string) => {
    const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    try {
      await api.downloadFile(fullPath, name);
      addNotification({ type: 'info', title: '下载中', message: `${name} 正在下载` });
    } catch (err: any) {
      addNotification({ type: 'error', title: '下载失败', message: err.message });
    }
  };

  const handleUpload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = false;
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const targetPath = currentPath === '/' ? file.name : `${currentPath}/${file.name}`;
      try {
        await api.uploadFile(file, targetPath);
        addNotification({ type: 'info', title: '上传成功', message: `${file.name} 已上传到 ${targetPath}` });
        loadFiles(currentPath);
      } catch (err: any) {
        addNotification({ type: 'error', title: '上传失败', message: err.message });
      }
    };
    input.click();
  };

  const handleFileContextMenu = (e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    const copyPath = () => {
      navigator.clipboard.writeText(fullPath);
      addNotification({ type: 'info', title: '已复制', message: '路径已复制到剪贴板' });
    };
    const attrMsg = [
      `类型: ${file.type}`,
      `大小: ${formatSize(file.size)}`,
      `修改: ${formatDateTime(file.modified)}`,
      file.created != null ? `创建: ${formatDateTime(file.created)}` : null,
    ].filter(Boolean).join(' · ');
    showContextMenu(e.clientX, e.clientY, [
      { label: '打开', action: () => file.type === 'directory' ? navigateTo(file.name) : openFile(file.name) },
      { label: '复制路径', action: copyPath },
      ...(file.type === 'file' ? [{ label: '下载', action: () => handleDownload(file.name) }] : []),
      { label: '', action: () => {}, separator: true },
      { label: '重命名', action: () => { setRenaming(file.name); setRenameValue(file.name); }, shortcut: 'F2' },
      { label: '删除', action: () => handleDelete(file.name), shortcut: 'Del' },
      { label: '', action: () => {}, separator: true },
      { label: '属性', action: () => addNotification({ type: 'info', title: file.name, message: attrMsg }) },
    ]);
  };

  const breadcrumbs = currentPath === '/' ? ['根目录'] : ['根目录', ...currentPath.split('/').filter(Boolean)];
  let filtered = search ? files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase())) : files;
  filtered = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    switch (sortBy) {
      case 'name':
        cmp = a.name.localeCompare(b.name, 'zh-CN');
        break;
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'modified':
        cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
        break;
      case 'created':
        cmp = new Date(a.created || a.modified).getTime() - new Date(b.created || b.modified).getTime();
        break;
      default:
        cmp = a.name.localeCompare(b.name, 'zh-CN');
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-white/[0.02]">
        <button onClick={goUp} className="p-1.5 rounded hover:bg-white/10 transition-colors" title="上一级 (Alt+↑)">
          <ArrowUp size={14} className="text-desktop-muted" />
        </button>
        <button onClick={() => setCurrentPath('/')} className="p-1.5 rounded hover:bg-white/10 transition-colors" title="主目录">
          <Home size={14} className="text-desktop-muted" />
        </button>
        <button onClick={() => loadFiles(currentPath)} className="p-1.5 rounded hover:bg-white/10 transition-colors" title="刷新">
          <RefreshCw size={14} className={`text-desktop-muted ${loading ? 'animate-spin' : ''}`} />
        </button>

        <div className="w-px h-5 bg-white/10" />

        {/* New file/folder buttons */}
        <button
          onClick={() => { setNewItemMode('folder'); setNewItemName('新建文件夹'); }}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          title="新建文件夹"
        >
          <FolderPlus size={14} className="text-desktop-muted" />
        </button>
        <button
          onClick={() => { setNewItemMode('file'); setNewItemName('新建文件.txt'); }}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          title="新建文件"
        >
          <FilePlus size={14} className="text-desktop-muted" />
        </button>
        <button
          onClick={handleUpload}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          title="上传文件"
        >
          <Upload size={14} className="text-desktop-muted" />
        </button>

        {/* 宿主机路径 */}
        {workspacePath && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 text-[11px] text-desktop-muted shrink-0 max-w-[240px]" title="沙箱在宿主机上的路径，点击复制">
            <HardDrive size={12} className="shrink-0 text-desktop-muted/70" />
            <span className="truncate font-mono">{workspacePath}</span>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(workspacePath);
                  addNotification({ type: 'info', title: '已复制', message: '宿主机路径已复制到剪贴板' });
                } catch (_) {
                  addNotification({ type: 'error', title: '复制失败', message: '无法访问剪贴板' });
                }
              }}
              className="p-0.5 rounded hover:bg-white/10 shrink-0"
              title="复制路径"
            >
              <Copy size={12} />
            </button>
          </div>
        )}
        {workspacePath && <div className="w-px h-5 bg-white/10 shrink-0" />}

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 text-xs text-desktop-muted overflow-hidden mx-2">
          {breadcrumbs.map((part, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight size={10} className="shrink-0" />}
              <button
                className="hover:text-desktop-text truncate max-w-[120px]"
                onClick={() => {
                  if (i === 0) setCurrentPath('/');
                  else {
                    const path = '/' + breadcrumbs.slice(1, i + 1).join('/');
                    setCurrentPath(path);
                  }
                }}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-desktop-muted" />
          <input
            type="text"
            placeholder="搜索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-40 pl-7 pr-2 py-1 text-xs bg-white/5 border border-white/10 rounded-md text-desktop-text placeholder:text-desktop-muted/50 focus:outline-none focus:border-desktop-highlight/50"
          />
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto p-2">
        {error ? (
          <div className="text-center py-12 text-red-400/80 text-xs">
            <p>加载失败: {error}</p>
            <button
              onClick={() => loadFiles(currentPath)}
              className="mt-2 px-3 py-1 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-desktop-muted"
            >
              重试
            </button>
          </div>
        ) : (
          <div className="grid gap-px">
            {/* New item input */}
            {newItemMode && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-desktop-highlight/5 border border-desktop-highlight/20">
                {newItemMode === 'folder' ? (
                  <FolderPlus size={18} className="text-yellow-400/80 shrink-0" />
                ) : (
                  <FilePlus size={18} className="text-desktop-muted shrink-0" />
                )}
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateNew();
                    if (e.key === 'Escape') { setNewItemMode(null); setNewItemName(''); }
                  }}
                  onBlur={handleCreateNew}
                  className="flex-1 bg-transparent text-xs text-desktop-text outline-none"
                  autoFocus
                  onFocus={(e) => {
                    const dot = newItemName.lastIndexOf('.');
                    e.target.setSelectionRange(0, dot > 0 ? dot : newItemName.length);
                  }}
                />
              </div>
            )}

            {/* Sortable header */}
            <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg text-[11px] text-desktop-muted border-b border-white/5 mb-1">
              <span className="w-[18px] shrink-0" />
              <button
                className="flex-1 text-left hover:text-desktop-text flex items-center gap-0.5 min-w-0"
                onClick={() => toggleSort('name')}
              >
                <span className="truncate">名称</span>
                {sortBy === 'name' ? (sortDir === 'asc' ? <ArrowUpIcon size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} className="opacity-50" />}
              </button>
              <button
                className="w-16 text-right hover:text-desktop-text flex items-center justify-end gap-0.5 shrink-0"
                onClick={() => toggleSort('size')}
              >
                大小
                {sortBy === 'size' ? (sortDir === 'asc' ? <ArrowUpIcon size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} className="opacity-50" />}
              </button>
              <button
                className="w-36 text-right hover:text-desktop-text flex items-center justify-end gap-0.5 shrink-0"
                onClick={() => toggleSort('modified')}
              >
                修改时间
                {sortBy === 'modified' ? (sortDir === 'asc' ? <ArrowUpIcon size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} className="opacity-50" />}
              </button>
              <button
                className="w-36 text-right hover:text-desktop-text flex items-center justify-end gap-0.5 shrink-0"
                onClick={() => toggleSort('created')}
              >
                创建时间
                {sortBy === 'created' ? (sortDir === 'asc' ? <ArrowUpIcon size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} className="opacity-50" />}
              </button>
              <span className="w-14 shrink-0" />
            </div>

            {filtered.map((file) => (
              <div
                key={file.name}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors group ${
                  selectedFiles.has(file.name) ? 'bg-desktop-highlight/10' : 'hover:bg-white/5'
                }`}
                onClick={() => setSelectedFiles(new Set([file.name]))}
                onDoubleClick={() => {
                  if (file.type === 'directory') navigateTo(file.name);
                  else openFile(file.name);
                }}
                onContextMenu={(e) => handleFileContextMenu(e, file)}
              >
                {file.type === 'directory' ? (
                  <Folder size={18} className="text-yellow-400/80 shrink-0" />
                ) : (
                  <File size={18} className="text-desktop-muted shrink-0" />
                )}

                {renaming === file.name ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(file.name, renameValue);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => handleRename(file.name, renameValue)}
                    className="flex-1 bg-white/5 text-xs text-desktop-text outline-none px-1 py-0.5 rounded border border-desktop-highlight/30"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 text-desktop-text/90 truncate text-xs">{file.name}</span>
                )}

                <span className="w-16 text-[11px] text-desktop-muted text-right shrink-0">
                  {file.type === 'file' ? formatSize(file.size) : ''}
                </span>
                <span className="w-36 text-[11px] text-desktop-muted text-right shrink-0">{formatDateTime(file.modified)}</span>
                <span className="w-36 text-[11px] text-desktop-muted text-right shrink-0">{formatDateTime(file.created)}</span>

                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity w-20 justify-end">
                  {file.type === 'file' && (
                    <button
                      className="p-1 rounded hover:bg-white/10"
                      onClick={(e) => { e.stopPropagation(); handleDownload(file.name); }}
                      title="下载"
                    >
                      <Download size={12} className="text-desktop-muted" />
                    </button>
                  )}
                  <button
                    className="p-1 rounded hover:bg-white/10"
                    onClick={(e) => { e.stopPropagation(); setRenaming(file.name); setRenameValue(file.name); }}
                    title="重命名"
                  >
                    <Edit size={12} className="text-desktop-muted" />
                  </button>
                  <button
                    className="p-1 rounded hover:bg-red-500/20"
                    onClick={(e) => { e.stopPropagation(); handleDelete(file.name); }}
                    title="删除"
                  >
                    <Trash2 size={12} className="text-desktop-muted" />
                  </button>
                </div>
              </div>
            ))}

            {!loading && filtered.length === 0 && (
              <div className="text-center py-12 text-desktop-muted text-xs">
                {search ? '没有找到匹配的文件' : '此文件夹为空'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="px-3 py-1.5 border-t border-white/5 text-[11px] text-desktop-muted flex items-center gap-3">
        <HardDrive size={11} />
        <span>{filtered.length} 个项目</span>
        {selectedFiles.size > 0 && <span>· {selectedFiles.size} 个选中</span>}
        <span className="ml-auto font-mono">{currentPath}</span>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
