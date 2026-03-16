import type { AppIdentifier, AppManifest, BuiltinAppId } from '@shared/index';
import { api } from '@/utils/api';
import { useMiniAppsStore } from '@/store/miniAppsStore';
import { useAdminStore } from '@/store/adminStore';
import i18n from './i18n';

const INSTALLED_APPS_KEY = 'x-computer-installed-apps';

export function setMiniAppsFromApi(list: Array<{ id: string; name: string; path: string }>): void {
  useMiniAppsStore.getState().set(list ?? []);
}

/** 获取翻译后的应用名称 */
function getAppName(appId: BuiltinAppId): string {
  return i18n.t(`apps.${appId}`);
}

/** 获取翻译后的应用描述 */
function getAppDescription(appId: BuiltinAppId): string {
  return i18n.t(`appDescriptions.${appId}`);
}

/** 内置应用清单（与 shared 中 BuiltinAppId 一一对应） */
export const BUILTIN_MANIFESTS: AppManifest[] = [
  { id: 'file-manager', name: getAppName('file-manager'), description: getAppDescription('file-manager'), source: 'builtin', icon: 'FolderOpen' },
  { id: 'terminal', name: getAppName('terminal'), description: getAppDescription('terminal'), source: 'builtin', icon: 'Terminal' },
  { id: 'browser', name: getAppName('browser'), description: getAppDescription('browser'), source: 'builtin', icon: 'Globe' },
  { id: 'chat', name: getAppName('chat'), description: getAppDescription('chat'), source: 'builtin', icon: 'MessageSquare' },
  { id: 'x', name: getAppName('x'), description: getAppDescription('x'), source: 'builtin', icon: 'Brain' },
  { id: 'code-editor', name: getAppName('code-editor'), description: getAppDescription('code-editor'), source: 'builtin', icon: 'Code' },
  { id: 'text-editor', name: getAppName('text-editor'), description: getAppDescription('text-editor'), source: 'builtin', icon: 'FileText' },
  { id: 'spreadsheet', name: getAppName('spreadsheet'), description: getAppDescription('spreadsheet'), source: 'builtin', icon: 'Table', availability: 'demo' },
  { id: 'email', name: getAppName('email'), description: getAppDescription('email'), source: 'builtin', icon: 'Mail' },
  { id: 'calendar', name: getAppName('calendar'), description: getAppDescription('calendar'), source: 'builtin', icon: 'Calendar', availability: 'demo' },
  { id: 'settings', name: getAppName('settings'), description: getAppDescription('settings'), source: 'builtin', icon: 'Settings' },
  { id: 'task-timeline', name: getAppName('task-timeline'), description: getAppDescription('task-timeline'), source: 'builtin', icon: 'Clock' },
  { id: 'image-viewer', name: getAppName('image-viewer'), description: getAppDescription('image-viewer'), source: 'builtin', icon: 'Image' },
  { id: 'office-viewer', name: getAppName('office-viewer'), description: getAppDescription('office-viewer'), source: 'builtin', icon: 'FileSpreadsheet' },
  { id: 'media-viewer', name: getAppName('media-viewer'), description: getAppDescription('media-viewer'), source: 'builtin', icon: 'Play' },
  { id: 'agent-manager', name: getAppName('agent-manager'), description: getAppDescription('agent-manager'), source: 'builtin', icon: 'Bot' },
  { id: 'x-board', name: getAppName('x-board'), description: getAppDescription('x-board'), source: 'builtin', icon: 'Kanban' },
  { id: 'subscription', name: getAppName('subscription'), description: getAppDescription('subscription'), source: 'builtin', icon: 'CreditCard' },
  { id: 'admin', name: getAppName('admin'), description: getAppDescription('admin'), source: 'builtin', icon: 'Shield' },
  { id: 'extensions', name: getAppName('extensions'), description: getAppDescription('extensions'), source: 'builtin', icon: 'Sparkles' },
];

const BUILTIN_IDS = new Set<string>(BUILTIN_MANIFESTS.map((m) => m.id));

const DEFAULT_SIZES: Record<BuiltinAppId, { width: number; height: number }> = {
  'file-manager': { width: 720, height: 520 },
  'text-editor': { width: 720, height: 540 },
  terminal: { width: 700, height: 440 },
  browser: { width: 940, height: 620 },
  chat: { width: 760, height: 640 },
  x: { width: 480, height: 560 },
  'code-editor': { width: 860, height: 600 },
  spreadsheet: { width: 880, height: 560 },
  email: { width: 820, height: 560 },
  calendar: { width: 740, height: 540 },
  settings: { width: 640, height: 500 },
  'task-timeline': { width: 800, height: 540 },
  'image-viewer': { width: 640, height: 520 },
  'office-viewer': { width: 800, height: 600 },
  'media-viewer': { width: 640, height: 420 },
  'agent-manager': { width: 720, height: 560 },
  'x-board': { width: 900, height: 600 },
  subscription: { width: 1000, height: 680 },
  admin: { width: 1000, height: 680 },
  extensions: { width: 900, height: 650 },
};

function loadInstalled(): AppManifest[] {
  try {
    const raw = localStorage.getItem(INSTALLED_APPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppManifest[];
    return Array.isArray(parsed) ? parsed.filter((m) => m.id && m.name && m.source === 'installed') : [];
  } catch {
    return [];
  }
}

function saveInstalled(list: AppManifest[]) {
  try {
    localStorage.setItem(INSTALLED_APPS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

/** 从云端覆盖已安装列表（启动时拉取后调用）；仅写本地缓存，不推回云端 */
export function setInstalledFromCloud(list: unknown): void {
  if (!Array.isArray(list)) return;
  const valid = list.filter((m): m is AppManifest => m && typeof m === 'object' && !!(m as AppManifest).id && !!(m as AppManifest).name && (m as AppManifest).source === 'installed');
  saveInstalled(valid);
}

/** 是否内置应用 */
export function isBuiltin(id: AppIdentifier): id is BuiltinAppId {
  return typeof id === 'string' && BUILTIN_IDS.has(id);
}

/** 获取所有应用（内置 + 已安装 + X 制作的小程序）；Admin 仅管理员可见 */
export function getAllApps(): AppManifest[] {
  const isAdmin = useAdminStore.getState().isAdmin;
  const miniAppsList = useMiniAppsStore.getState().list;
  const miniapps: AppManifest[] = miniAppsList.map((m) => ({
    id: m.id,
    name: m.name,
    description: i18n.t('appDescriptions.miniapp'),
    source: 'miniapp' as const,
    icon: 'Layout',
    defaultSize: { width: 640, height: 480 },
  }));
  const builtin = isAdmin ? BUILTIN_MANIFESTS : BUILTIN_MANIFESTS.filter((m) => m.id !== 'admin');
  return [...builtin, ...loadInstalled(), ...miniapps];
}

/** 根据 id 获取清单 */
export function getApp(id: AppIdentifier): AppManifest | undefined {
  const s = String(id);
  const builtin = BUILTIN_MANIFESTS.find((m) => m.id === s);
  if (builtin) return builtin;
  const installed = loadInstalled().find((m) => m.id === s);
  if (installed) return installed;
  const ma = useMiniAppsStore.getState().list.find((m) => m.id === s);
  if (ma) return { id: ma.id, name: ma.name, description: 'X 制作的应用', source: 'miniapp', icon: 'Layout', defaultSize: { width: 640, height: 480 } };
  return undefined;
}

/** 是否 X 制作的小程序 */
export function isMiniApp(id: AppIdentifier): boolean {
  return useMiniAppsStore.getState().list.some((m) => m.id === String(id));
}

/** 获取应用显示名称 */
export function getAppTitle(id: AppIdentifier): string {
  return getApp(id)?.name ?? String(id);
}

const MOBILE_BREAKPOINT = 640;

/** 是否小屏（手机/窄屏），用于窗口默认全屏 */
export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

/** 获取应用默认窗口大小；小屏下返回全屏尺寸（减去任务栏，移动端任务栏 48px） */
export function getAppDefaultSize(id: AppIdentifier): { w: number; h: number } {
  if (typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT) {
    return {
      w: window.innerWidth,
      h: Math.max(280, window.innerHeight - 48),
    };
  }
  const app = getApp(id);
  if (app?.defaultSize) return { w: app.defaultSize.width, h: app.defaultSize.height };
  if (isBuiltin(id)) {
    const size = DEFAULT_SIZES[id];
    if (size) return { w: size.width, h: size.height };
  }
  return { w: 640, h: 480 };
}

/** 安装应用（写入已安装列表） */
export function installApp(manifest: AppManifest): { ok: boolean; error?: string } {
  if (manifest.source !== 'installed') return { ok: false, error: 'source 必须为 installed' };
  if (!manifest.id || !manifest.name) return { ok: false, error: 'id、name 必填' };
  if (BUILTIN_IDS.has(manifest.id)) return { ok: false, error: 'id 不能与内置应用重复' };
  const installed = loadInstalled();
  if (installed.some((m) => m.id === manifest.id)) return { ok: false, error: '该应用已安装' };
  installed.push(manifest);
  saveInstalled(installed);
  api.setUserConfigKey('installed_apps', installed).catch(() => {});
  return { ok: true };
}

/** 卸载已安装应用 */
export function uninstallApp(id: string): { ok: boolean; error?: string } {
  if (BUILTIN_IDS.has(id)) return { ok: false, error: '不能卸载内置应用' };
  const installed = loadInstalled().filter((m) => m.id !== id);
  if (installed.length === loadInstalled().length) return { ok: false, error: '未找到该应用' };
  saveInstalled(installed);
  api.setUserConfigKey('installed_apps', installed).catch(() => {});
  return { ok: true };
}

/** 已安装应用列表（只读） */
export function getInstalledApps(): AppManifest[] {
  return loadInstalled();
}

/** 解析运行时的“实际”内置 ID：若为安装应用的 alias，返回 aliasBuiltin；若为小程序则返回 null（由 MiniAppView 渲染） */
export function resolveBuiltinId(id: AppIdentifier): BuiltinAppId | null {
  const app = getApp(id);
  if (!app) return null;
  if (app.source === 'builtin') return id as BuiltinAppId;
  if (app.aliasBuiltin) return app.aliasBuiltin;
  if (app.source === 'miniapp') return null;
  return null;
}
