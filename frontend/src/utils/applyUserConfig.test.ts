import { beforeEach, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ setLLMConfig: vi.fn(), setConfigSyncStatus: vi.fn(), saveSecrets: vi.fn() }));
vi.mock('@/store/llmConfigStore', () => ({ useLLMConfigStore: { getState: () => state } }));
vi.mock('@/store/configStore', () => ({ useConfigStore: { getState: () => ({ desktopIconPositions: {} }) } }));
vi.mock('@/store/systemLogStore', () => ({ getSystemLogStore: () => ({ entries: [] }) }));
vi.mock('@/appRegistry', () => ({ setInstalledFromCloud: vi.fn(), getInstalledApps: () => [], setMiniAppsFromApi: vi.fn() }));
vi.mock('@/utils/api', () => ({ api: {} }));
vi.mock('@/constants/llmPresets', () => ({ loadSecrets: () => ({}), saveSecrets: state.saveSecrets }));
import { applyUserConfigToStores, getCloudConfigSnapshot } from './applyUserConfig';
describe('public model configuration in the browser', () => {
  beforeEach(() => vi.clearAllMocks());
  it('keeps the configured flag without requiring a secret from the server', () => {
    applyUserConfigToStores({ llm_config: { providers: [{ id: 'platform', name: '平台模型', apiKeyConfigured: true }], defaultByModality: {} } });
    expect(state.setLLMConfig.mock.calls[0][0].providers[0].apiKeyConfigured).toBe(true);
    expect(state.saveSecrets).not.toHaveBeenCalled();
  });
  it('does not cache a legacy API key in model settings or the cloud snapshot', () => {
    applyUserConfigToStores({ llm_config: { providers: [{ id: 'platform', name: '平台模型', apiKey: 'legacy-private-key' }], defaultByModality: {} } });
    expect(JSON.stringify(state.setLLMConfig.mock.calls)).not.toContain('legacy-private-key');
    expect(JSON.stringify(getCloudConfigSnapshot())).not.toContain('legacy-private-key'); expect(state.saveSecrets).not.toHaveBeenCalled();
  });
});
