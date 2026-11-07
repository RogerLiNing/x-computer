import { create } from 'zustand';
import type {
  LLMSystemConfig,
  LLMProviderConfig,
  LLMModality,
  ModalityModelSelection,
} from '@shared/index';
import type { ImportedModel, ImportedModelsByProvider } from '@/constants/llmPresets';
import {
  loadFromStorage,
  saveToStorage,
  loadImportedModels,
  saveImportedModels,
  PROVIDER_META,
} from '@/constants/llmPresets';
import { api } from '@/utils/api';
import { getUserIdOrNull } from '@/utils/userId';

/** 普通同步只包含公开配置。 */
function buildConfigForCloud(config: LLMSystemConfig): LLMSystemConfig {
  return { ...config };
}

/** D.3 离线/降级：配置与云端的同步状态 */
export type ConfigSyncStatus = 'ok' | 'offline' | 'pending';

interface LLMConfigStore {
  /** 当前配置（从 localStorage 初始化） */
  llmConfig: LLMSystemConfig;
  /** 各提供商从 /models 导入的模型列表 */
  importedModelsByProvider: ImportedModelsByProvider;
  /** 配置同步状态：ok=已同步，offline=启动时拉取失败用本地，pending=本地有修改未推送到云端 */
  configSyncStatus: ConfigSyncStatus;
  /** 整体替换配置并持久化；options.skipCloudSync 为 true 时不推送到云端（用于从云端拉取后写入本地） */
  setLLMConfig: (config: LLMSystemConfig, options?: { skipCloudSync?: boolean }) => void;
  /** 设置同步状态（内部或 Desktop 拉取/重试时使用） */
  setConfigSyncStatus: (status: ConfigSyncStatus) => void;
  /** 恢复网络后重试将当前配置推送到云端 */
  retryConfigSync: () => Promise<void>;
  /** 将当前配置（含 API Key）推送到云端，供定时任务等使用；失败时设 configSyncStatus 为 pending */
  syncToCloud: () => void;
  /** 立即同步到云端并返回 Promise，供「保存到云端」按钮等待结果并提示 */
  syncToCloudNow: () => Promise<void>;
  /** 更新某个提供商信息（name, baseUrl）；不包含 API Key */
  updateProvider: (providerId: string, updates: Partial<Pick<LLMProviderConfig, 'name' | 'baseUrl' | 'apiType'>>) => void;
  /** 添加提供商 */
  addProvider: (providerId: string) => void;
  /** 移除提供商；会清理该提供商的 API Key、导入列表并修正 defaultByModality */
  removeProvider: (providerId: string) => void;
  /** 设置某模态的默认提供商+模型 */
  setDefaultForModality: (modality: LLMModality, selection: ModalityModelSelection) => void;
  /** 提交密钥到服务端，只保留公开的配置状态。 */
  setProviderApiKey: (providerId: string, apiKey: string) => Promise<void>;
  /** 清除提供商 API Key */
  clearProviderApiKey: (providerId: string) => Promise<void>;
  /** 获取某提供商的 API Key（供调用方使用，不暴露在 UI 明文） */
  getProviderApiKey: (providerId: string) => string;
  /** 设置某提供商从 API 导入的模型列表并持久化 */
  setImportedModelsForProvider: (providerId: string, models: ImportedModel[]) => void;
}

let configWrite: Promise<unknown> = Promise.resolve();

function queueConfigWrite<T>(write: () => Promise<T>): Promise<T> {
  const owner = getUserIdOrNull();
  const request = configWrite.then(() => {
    if (!owner || getUserIdOrNull() !== owner) throw new Error('登录状态已变化，请重新操作');
    return write();
  });
  configWrite = request.catch(() => {});
  return request;
}

export const useLLMConfigStore = create<LLMConfigStore>((set, get) => ({
  llmConfig: loadFromStorage(),
  importedModelsByProvider: loadImportedModels(),
  configSyncStatus: 'ok',

  setConfigSyncStatus: (status) => set({ configSyncStatus: status }),

  retryConfigSync: async () => {
    const status = get().configSyncStatus;
    if (status !== 'pending') return;
    try {
      await get().syncToCloudNow();
    } catch {
      // 保持 pending，下次 online 再试
    }
  },

  syncToCloud: () => {
    const owner = getUserIdOrNull();
    void get().syncToCloudNow().catch(() => {
      if (getUserIdOrNull() === owner) set({ configSyncStatus: 'pending' });
    });
  },

  syncToCloudNow: async () => {
    const owner = getUserIdOrNull();
    await queueConfigWrite(() => api.setUserConfigKey('llm_config', buildConfigForCloud(get().llmConfig)));
    if (getUserIdOrNull() === owner) set({ configSyncStatus: 'ok' });
  },

  setLLMConfig: (config, options) => {
    set({ llmConfig: config });
    saveToStorage(config);
    if (!options?.skipCloudSync) {
      get().syncToCloud();
    }
  },

  updateProvider: (providerId, updates) => {
    set((s) => {
      const providers = s.llmConfig.providers.map((p) =>
        p.id === providerId ? { ...p, ...updates } : p,
      );
      const config: LLMSystemConfig = { ...s.llmConfig, providers };
      saveToStorage(config);
      return { llmConfig: config };
    });
    get().syncToCloud();
  },

  addProvider: (providerId) => {
    const meta = PROVIDER_META[providerId];
    const name = meta?.name ?? providerId;
    const baseUrl = meta?.baseUrl ?? '';
    const newProvider: LLMProviderConfig = {
      id: providerId,
      name,
      baseUrl: baseUrl || undefined,
      apiKeyConfigured: false, // API Key 由服务器端管理，前端不存储
    };
    set((s) => {
      if (s.llmConfig.providers.some((p) => p.id === providerId)) return {};
      const providers = [...s.llmConfig.providers, newProvider];
      const config: LLMSystemConfig = { ...s.llmConfig, providers };
      saveToStorage(config);
      return { llmConfig: config };
    });
    get().syncToCloud();
  },

  removeProvider: (providerId) => {
    const imported = loadImportedModels();
    delete imported[providerId];
    saveImportedModels(imported);
    set((s) => {
      const providers = s.llmConfig.providers.filter((p) => p.id !== providerId);
      const firstId = providers[0]?.id;
      const defaultByModality = { ...s.llmConfig.defaultByModality };
      (Object.keys(defaultByModality) as LLMModality[]).forEach((mod) => {
        if (defaultByModality[mod].providerId === providerId && firstId) {
          defaultByModality[mod] = { providerId: firstId, modelId: '__custom__' };
        }
      });
      const config: LLMSystemConfig = { ...s.llmConfig, providers, defaultByModality };
      saveToStorage(config);
      return { llmConfig: config, importedModelsByProvider: { ...imported } };
    });
    get().syncToCloud();
  },

  setImportedModelsForProvider: (providerId, models) => {
    const imported = loadImportedModels();
    imported[providerId] = models;
    saveImportedModels(imported);
    set((s) => ({ importedModelsByProvider: { ...s.importedModelsByProvider, [providerId]: models } }));
  },

  setDefaultForModality: (modality, selection) => {
    set((s) => {
      const defaultByModality = { ...s.llmConfig.defaultByModality, [modality]: selection };
      const config: LLMSystemConfig = { ...s.llmConfig, defaultByModality };
      saveToStorage(config);
      return { llmConfig: config };
    });
    get().syncToCloud();
  },

  setProviderApiKey: async (providerId, apiKey) => {
    const owner = getUserIdOrNull();
    const saved = await queueConfigWrite(async () => {
      const config = get().llmConfig;
      if (!config.providers.some(provider => provider.id === providerId)) throw new Error('提供商已移除');
      const providers = config.providers.map(provider => provider.id === providerId ? { ...provider, apiKey } : provider);
      const response = await api.setUserConfigKey('llm_config', { ...config, providers });
      const publicConfig = response.value as LLMSystemConfig | undefined;
      const provider = publicConfig?.providers.find(item => item.id === providerId);
      if (!provider || provider.apiKeyConfigured !== Boolean(apiKey)) throw new Error('服务器未确认密钥状态，请重试');
      return provider;
    });
    if (getUserIdOrNull() !== owner) return;
    set(state => {
      const providers = state.llmConfig.providers.map(provider => provider.id === providerId
        ? { ...provider, apiKeyConfigured: saved.apiKeyConfigured } : provider);
      const config = { ...state.llmConfig, providers };
      saveToStorage(config);
      return { llmConfig: config, configSyncStatus: 'ok' };
    });
  },
  clearProviderApiKey: (providerId) => get().setProviderApiKey(providerId, ''),
  /** 获取某提供商的 API Key（已废弃：始终返回空字符串）
   *  @deprecated 此函数已废弃，API Key 由服务器端统一管理
   */
  getProviderApiKey: (_providerId: string) => '',
}));
