import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boundedHttpRequest } from '../mcp/httpTransport.js';
import { fetchModelsFromProvider } from './fetchModels.js';

vi.mock('../mcp/httpTransport.js', () => ({ boundedHttpRequest: vi.fn() }));

describe('model list discovery', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['', '/v1', '/anthropic', '/anthropic/v1/'])('uses the official catalog for a DeepSeek base %s', async path => {
    vi.mocked(boundedHttpRequest).mockResolvedValue({ status: 200, contentType: 'application/json', text: '{"data":[{"id":"deepseek-flash"}]}' });
    expect(await fetchModelsFromProvider('https://api.deepseek.com' + path, 'fixture-key')).toEqual([{ id: 'deepseek-flash' }]);
    expect(boundedHttpRequest).toHaveBeenCalledWith('https://api.deepseek.com/models',
      expect.objectContaining({ Authorization: 'Bearer fixture-key' }), '',
      { method: 'GET', trustedServer: false, allowHttpsProxyFakeIp: true });
  });

  it('keeps proxy exceptions off for other origins and ports', async () => {
    vi.mocked(boundedHttpRequest).mockResolvedValue({ status: 200, contentType: 'application/json', text: '{"data":[]}' });
    for (const origin of ['https://api.deepseek.com.example.test', 'https://api.deepseek.com:8443']) {
      await fetchModelsFromProvider(origin + '/v1', 'fixture-key');
      expect(boundedHttpRequest).toHaveBeenLastCalledWith(origin + '/v1/models', expect.anything(), '',
        { method: 'GET', trustedServer: false });
    }
  });

  it('reports authentication failure without returning the provider response', async () => {
    vi.mocked(boundedHttpRequest).mockResolvedValue({ status: 401, contentType: 'text/plain', text: 'private response' });
    await expect(fetchModelsFromProvider('https://api.deepseek.com/anthropic', 'fixture-key')).rejects.toThrow('HTTP 401');
    expect(boundedHttpRequest).toHaveBeenCalledOnce();
  });
});
