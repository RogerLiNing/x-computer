/**
 * 将云端用户配置应用到各 store（启动时与登录/注册后拉取并应用，实现换设备/换浏览器后配置同步回来）。
 */

import type { LLMSystemConfig, LLMProviderConfig } from '@shared/index';
import { useLLMConfigStore } from '@/store/llmConfigStore';
import { useDesktopStore } from '@/store/desktopStore';
import { getSystemLogStore, type SystemLogEntry } from '@/store/systemLogStore';
import { setInstalledFromCloud, getInstalledApps, setMiniAppsFromApi } from '@/appRegistry';
import { saveSecrets, loadSecrets } from '@/constants/llmPresets';
import { api } from '@/utils/api';

export type UserConfigMap = Record<string, unknown>;

/** 最近一次从云端应用的全量配置快照，供 Settings 内 MCP/Skills/多媒体等 tab 挂载时读取，保证登录后同步可见 */
let cloudConfigSnapshot: UserConfigMap = {};

export function getCloudConfigSnapshot(): UserConfigMap {
  return cloudConfigSnapshot;
}

function setCloudConfigSnapshot(c: UserConfigMap): void {
  cloudConfigSnapshot = { ...c };
}

type ProviderFromCloud = LLMProviderConfig & { apiKey?: string };

/** 将云端配置对象应用到 LLM、桌面、已安装应用、系统日志等 store */
export function applyUserConfigToStores(c: UserConfigMap): void {
  const raw = c?.llm_config;
  if (raw != null) {
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
        const provider = p as unknown as ProviderFromCloud;
        if (provider.apiKey) {
          secrets[provider.id] = provider.apiKey;
        }
      }
      saveSecrets(secrets);
      const configForStore: LLMSystemConfig = {
        ...parsed,
        providers: parsed.providers.map((p) => {
          const provider = p as unknown as ProviderFromCloud;
          const { apiKey: _, ...rest } = provider;
          return { ...rest, apiKeyConfigured: !!provider.apiKey } as LLMProviderConfig;
        }),
      };
      useLLMConfigStore.getState().setLLMConfig(configForStore, { skipCloudSync: true });
    }
  }
  useLLMConfigStore.getState().setConfigSyncStatus('ok');

  const logStore = getSystemLogStore();
  if (Array.isArray(c?.system_logs) && c.system_logs.length > 0) {
    logStore.replaceFromCloud(c.system_logs as SystemLogEntry[]);
  } else if (logStore.entries.length > 0) {
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

  setCloudConfigSnapshot(c);
}

/**
 * 从服务端拉取当前用户（X-User-Id）的配置并应用到各 store。
 * 用于：1) 启动时（Desktop）；2) 登录/注册成功后（换浏览器后配置同步回来）。
 */
export async function fetchAndApplyUserConfig(): Promise<void> {
  const c = await api.getUserConfig();
  applyUserConfigToStores(c ?? {});
  const apps = await api.getMiniApps().catch(() => ({ apps: [] }));
  setMiniAppsFromApi(apps?.apps ?? []);
}
