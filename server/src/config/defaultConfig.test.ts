import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadDefaultConfig,
  clearDefaultConfigCache,
  type XConfig,
} from './defaultConfig.js';

describe('defaultConfig', () => {
  let tmpDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    clearDefaultConfigCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-computer-config-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('returns empty object when no config file exists', () => {
    process.env.X_COMPUTER_CONFIG_PATH = path.join(tmpDir, 'nonexistent.json');
    expect(loadDefaultConfig()).toEqual({});
  });

  it('loads config from X_COMPUTER_CONFIG_PATH', () => {
    const cfg: XConfig = {
      llm_config: {
        providers: [
          { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
        ],
      },
    };
    const cfgPath = path.join(tmpDir, 'test-config.json');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    process.env.X_COMPUTER_CONFIG_PATH = cfgPath;
    expect(loadDefaultConfig()).toEqual(cfg);
  });

  it('resolves {env:VAR} placeholders', () => {
    process.env.MY_TEST_KEY = 'secret123';
    const cfgPath = path.join(tmpDir, 'env-config.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        llm_config: {
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              apiKey: '{env:MY_TEST_KEY}',
            },
          ],
        },
      })
    );
    process.env.X_COMPUTER_CONFIG_PATH = cfgPath;
    const loaded = loadDefaultConfig();
    expect((loaded.llm_config as any)?.providers?.[0]?.apiKey).toBe('secret123');
  });

  it('caches config', () => {
    const cfgPath = path.join(tmpDir, 'cache-config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ foo: 1 }));
    process.env.X_COMPUTER_CONFIG_PATH = cfgPath;
    const first = loadDefaultConfig();
    fs.writeFileSync(cfgPath, JSON.stringify({ foo: 2 }));
    const second = loadDefaultConfig();
    expect(first).toBe(second);
    expect(second).toEqual({ foo: 1 });
    clearDefaultConfigCache();
    const third = loadDefaultConfig();
    expect(third).toEqual({ foo: 2 });
  });
});
