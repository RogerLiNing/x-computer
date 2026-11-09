import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { XPackageRecord } from '@x-computer/shared';
import { InstalledPackagesSection } from './InstalledPackagesSection';

vi.mock('@/utils/api', () => ({ api: {} }));
vi.mock('@/appRegistry', () => ({ setMiniAppsFromApi: vi.fn() }));

const record: XPackageRecord = {
  userId: 'roger', enabled: true, source: 'space', path: 'apps/counter', installedAt: 1, updatedAt: 1,
  manifest: { format: 1, id: 'counter', name: '计数器', version: '0.1.0', kinds: ['ui'], ui: { entry: 'index.html' }, permissions: ['kv'] },
};

describe('InstalledPackagesSection', () => {
  it('renders the section shell before data arrives and does not throw', () => {
    const client = { listPackages: vi.fn(async () => ({ packages: [record], builtin: [] })), setPackageEnabled: vi.fn(), removePackage: vi.fn(), getMiniApps: vi.fn() };
    const html = renderToStaticMarkup(<InstalledPackagesSection client={client as never} />);
    expect(html).toContain('已安装的包');
    expect(html).not.toContain('计数器');
  });
});
