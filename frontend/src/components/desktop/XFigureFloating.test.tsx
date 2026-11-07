import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ windows: [] as Array<{ isMaximized: boolean; isMinimized: boolean }>, openApp: vi.fn() }));
vi.mock('@/store/desktopStore', () => ({ useDesktopStore: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock('@/store/connectionStore', () => ({ useConnectionStore: (select: (value: { xProactiveMessages: unknown[] }) => unknown) => select({ xProactiveMessages: [] }) }));
vi.mock('@/store/digitalHumanStore', () => ({ useDigitalHumanStore: (select: (value: object) => unknown) => select({ activity: 'idle', scale: 'compact', showStatusBubble: true, setActivity: vi.fn() }) }));
vi.mock('@/appRegistry', () => ({ isAppEnabled: () => true }));
vi.mock('@/hooks/useAppRegistry', () => ({ useAppRegistryRevision: vi.fn() }));
import { XFigureFloating } from './XFigureFloating';
describe('floating assistant does not intercept maximized app controls', () => {
  it('hides the avatar when an app fills the workspace', () => {
    state.windows = [{ isMaximized: true, isMinimized: false }]; expect(renderToStaticMarkup(<XFigureFloating />)).toBe('');
  });
  it('is available again after that app is minimized', () => {
    state.windows = [{ isMaximized: true, isMinimized: true }]; expect(renderToStaticMarkup(<XFigureFloating />)).toContain('digital-human-floating');
  });
});
