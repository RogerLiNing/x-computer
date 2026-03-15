import { useEffect } from 'react';
import { Settings } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';
import { useLLMConfigStore } from '@/store/llmConfigStore';
import { setInstalledFromCloud, getInstalledApps, setMiniAppsFromApi } from '@/appRegistry';
import { useAdminStore } from '@/store/adminStore';
import { getSystemLogStore, type SystemLogEntry } from '@/store/systemLogStore';
import { applyUserConfigToStores } from '@/utils/applyUserConfig';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMobileViewport } from '@/hooks/useMobileViewport';
import { api } from '@/utils/api';
import type { LLMSystemConfig } from '@shared/index';
import { saveSecrets, loadSecrets } from '@/constants/llmPresets';
import { Taskbar } from './Taskbar';
import { WindowManager } from './WindowManager';
import { DesktopIcons } from './DesktopIcons';
import { XFigureFloating } from './XFigureFloating';
import { NotificationCenter } from './NotificationCenter';
import { ContextMenu } from './ContextMenu';
import { SearchLauncher } from './SearchLauncher';
import { LockScreen } from './LockScreen';
import { StatusBar } from './StatusBar';
import { ChatApp } from '@/components/apps/ChatApp';
import { OnboardingOverlay } from '@/components/OnboardingOverlay';

export function Desktop() {
  const { showContextMenu, hideContextMenu, connected, openApp } = useDesktopStore();
  const isMobile = useMobileViewport();

  // Connect WebSocket
  useWebSocket();

  // 订阅浏览器通道：X 调用 browser.navigate 且 openIfNeeded 时，若浏览器未打开则自动打开
  useEffect(() => {
    const store = useDesktopStore.getState();
    store.sendWs?.({ type: 'subscribe_app', data: { appId: 'browser' } });
    const unsub = store.subscribeAppChannel('browser', (message: unknown) => {
      const msg = message as { action?: string; url?: string; openIfNeeded?: boolean };
      if (msg?.action === 'navigate' && msg?.openIfNeeded && typeof msg.url === 'string') {
        const { windows } = useDesktopStore.getState();
        const browserOpen = windows.some((w) => w.appId === 'browser');
        if (!browserOpen) {
          useDesktopStore.getState().openApp('browser', { url: msg.url });
        }
      }
    });
    return () => {
      unsub();
      useDesktopStore.getState().sendWs?.({ type: 'unsubscribe_app', data: { appId: 'browser' } });
    };
  }, []);

  // Register keyboard shortcuts
  useKeyboardShortcuts();

  // Admin 身份校验（控制 Admin 应用入口可见性）
  useEffect(() => {
    useAdminStore.getState().fetchAdminStatus();
  }, []);

  // D.1: 启动时从云端拉取用户配置并合并到 store（云端优先，本地作缓存）
  useEffect(() => {
    api
      .getUserConfig()
      .then((c) => {
        // 使用 applyUserConfigToStores 统一应用云端配置并填充 cloudConfigSnapshot，供 Settings 内 MCP/Skills 等 tab 刷新后能读到
        applyUserConfigToStores(c ?? {});
        const raw = c?.llm_config;
        const parsed: LLMSystemConfig | null =
          typeof raw === 'object' && raw !== null && 'providers' in raw
              ? (raw as LLMSystemConfig)
              : typeof raw === 'string' && raw
                ? (() => {
                    try {
                      return JSON.parse(raw) as LLMSystemConfig;
                    } catch {
                      return null;
                    }
                  })()
                : null;
          if (parsed?.providers) {
            const secrets = loadSecrets();
            for (const p of parsed.providers) {
              const prov = p as { id: string; apiKey?: string };
              if (prov.apiKey) secrets[prov.id] = prov.apiKey;
            }
            saveSecrets(secrets);
            const configForStore: LLMSystemConfig = {
              ...parsed,
              providers: parsed.providers.map((p) => {
                const prov = p as unknown as { id: string; apiKey?: string; [k: string]: unknown };
                const { apiKey: _ak, ...rest } = prov;
                return { ...rest, apiKeyConfigured: !!prov.apiKey } as LLMSystemConfig['providers'][0];
              }),
            };
            useLLMConfigStore.getState().setLLMConfig(configForStore, { skipCloudSync: true });
          }
        useLLMConfigStore.getState().setConfigSyncStatus('ok');

        // 系统日志、桌面图标布局、已安装应用：以云端为准覆盖本地
        const logStore = getSystemLogStore();
        if (Array.isArray(c?.system_logs) && c.system_logs.length > 0) {
          logStore.replaceFromCloud(c.system_logs as SystemLogEntry[]);
        } else if (logStore.entries.length > 0) {
          // 云端无日志但本地有：一次性上传，实现“所有数据在云端”
          api.setUserConfigKey('system_logs', logStore.entries).catch(() => {});
        }
        const desktopStore = useDesktopStore.getState();
        if (c?.desktop_layout && typeof c.desktop_layout === 'object' && !Array.isArray(c.desktop_layout)) {
          desktopStore.setDesktopIconPositionsFromCloud(c.desktop_layout as Record<string, { col: number; row: number }>);
        } else if (Object.keys(desktopStore.desktopIconPositions).length > 0) {
          api.setUserConfigKey('desktop_layout', desktopStore.desktopIconPositions).catch(() => {});
        }
        if (c?.installed_apps != null && Array.isArray(c.installed_apps)) {
          setInstalledFromCloud(c.installed_apps);
        } else if (getInstalledApps().length > 0) {
          api.setUserConfigKey('installed_apps', getInstalledApps()).catch(() => {});
        }
        // X 制作的小程序（从后端按用户拉取）
        api.getMiniApps().then((r) => setMiniAppsFromApi(r?.apps ?? [])).catch(() => setMiniAppsFromApi([]));
      })
      .catch(() => {
        // D.3: 无网络时使用本地缓存，不覆盖 store（初始状态已是 loadFromStorage）
        useLLMConfigStore.getState().setConfigSyncStatus('offline');
        api.getMiniApps().then((r) => setMiniAppsFromApi(r?.apps ?? [])).catch(() => setMiniAppsFromApi([]));
      });
  }, []);

  // D.3: 恢复网络后重试配置同步（将 pending 的本地配置推送到云端）
  useEffect(() => {
    const onOnline = () => useLLMConfigStore.getState().retryConfigSync();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = useDesktopStore.getState();
    showContextMenu(e.clientX, e.clientY, [
      { label: '新建文件夹', action: () => s.openApp('file-manager'), shortcut: '⌘N' },
      { label: '打开终端', action: () => s.openApp('terminal'), shortcut: '⌘T' },
      { label: '打开 AI 助手', action: () => s.openApp('chat') },
      { label: '打开 X 主脑', action: () => s.openApp('x') },
      { label: '', action: () => {}, separator: true },
      { label: '搜索', action: () => s.toggleSearch(), shortcut: '⌘K' },
      { label: '系统设置', action: () => s.openApp('settings') },
      { label: '', action: () => {}, separator: true },
      { label: '锁定屏幕', action: () => s.lockScreen(), shortcut: '⌘L' },
    ]);
  };

  // 手机模式：主显示 AI 助手对话，设置放右上角
  if (isMobile) {
    return (
      <div
        className="w-full h-full flex flex-col bg-desktop-bg relative overflow-hidden"
        onContextMenu={handleContextMenu}
        onClick={() => {
          const s = useDesktopStore.getState();
          if (s.contextMenu.visible) hideContextMenu();
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at 30% 20%, rgba(15, 52, 96, 0.6) 0%, transparent 50%), ' +
              'radial-gradient(ellipse at 70% 80%, rgba(233, 69, 96, 0.08) 0%, transparent 40%), ' +
              'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%)',
          }}
        />
        {/* 顶部栏：设置右上角 */}
        <header className="h-12 sm:h-14 shrink-0 flex items-center justify-between px-4 z-50 relative bg-black/20 backdrop-blur-md border-b border-white/5">
          <span className="text-sm font-medium text-desktop-text">AI 助手</span>
          <button
            className="p-2 rounded-lg hover:bg-white/10 text-desktop-muted hover:text-desktop-text transition-colors touch-manipulation"
            onClick={() => openApp('settings')}
            title="系统设置"
          >
            <Settings size={20} />
          </button>
        </header>
        {/* 主内容：对话区 */}
        <main className="flex-1 min-h-0 relative z-10">
          <ChatApp windowId="mobile-chat" embeddedInMobile />
        </main>
        <WindowManager />
        <NotificationCenter />
        <ContextMenu />
        <LockScreen />
        <OnboardingOverlay />
      </div>
    );
  }

  return (
    <div
      className="w-full h-full flex flex-col bg-desktop-bg relative overflow-hidden"
      onContextMenu={handleContextMenu}
      onClick={() => {
        const s = useDesktopStore.getState();
        if (s.contextMenu.visible) hideContextMenu();
      }}
    >
      {/* Desktop wallpaper gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 30% 20%, rgba(15, 52, 96, 0.6) 0%, transparent 50%), ' +
            'radial-gradient(ellipse at 70% 80%, rgba(233, 69, 96, 0.08) 0%, transparent 40%), ' +
            'radial-gradient(ellipse at 50% 50%, rgba(22, 33, 62, 0.5) 0%, transparent 60%), ' +
            'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%)',
        }}
      />

      {/* Status bar (top) */}
      <StatusBar />

      {/* Desktop area */}
      <div className="flex-1 relative z-10">
        <DesktopIcons />
        <WindowManager />
        <NotificationCenter />
        {/* X 主脑形象：浮动在桌面右下，点击打开 X 主脑 */}
        <XFigureFloating />
      </div>

      {/* Taskbar (bottom) */}
      <Taskbar />

      {/* Overlays */}
      <ContextMenu />
      <SearchLauncher />
      <LockScreen />
      <OnboardingOverlay />
    </div>
  );
}
