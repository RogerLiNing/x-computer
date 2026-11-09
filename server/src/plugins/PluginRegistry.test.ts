import { afterEach, describe, expect, it } from 'vitest';
import { createPluginRegistry } from './PluginRegistry.js';

const originalEnabled = process.env.X_COMPUTER_PLUGINS;
const originalDisabled = process.env.X_COMPUTER_DISABLED_PLUGINS;

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.X_COMPUTER_PLUGINS;
  else process.env.X_COMPUTER_PLUGINS = originalEnabled;
  if (originalDisabled === undefined) delete process.env.X_COMPUTER_DISABLED_PLUGINS;
  else process.env.X_COMPUTER_DISABLED_PLUGINS = originalDisabled;
});

describe('PluginRegistry', () => {
  it('keeps background plugins disabled in lightweight profile', () => {
    const registry = createPluginRegistry('lightweight');

    expect(registry.isEnabled('billing')).toBe(true);
    expect(registry.isEnabled('automation')).toBe(false);
    expect(registry.isEnabled('messaging')).toBe(false);
    expect(registry.isEnabled('heartbeat')).toBe(false);
  });

  it('enables every bundled plugin in full profile', () => {
    const registry = createPluginRegistry('full');

    expect(registry.list().every((plugin) => plugin.enabled)).toBe(true);
  });

  it('applies explicit enable and disable overrides', () => {
    process.env.X_COMPUTER_PLUGINS = 'mcp,messaging';
    process.env.X_COMPUTER_DISABLED_PLUGINS = 'messaging';

    const registry = createPluginRegistry('lightweight');

    expect(registry.isEnabled('mcp')).toBe(true);
    expect(registry.isEnabled('messaging')).toBe(false);
  });
});
