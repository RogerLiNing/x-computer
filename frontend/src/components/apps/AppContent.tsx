import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import type { AppIdentifier, BuiltinAppId } from '@shared/index';
import { isMiniApp, resolveBuiltinId } from '@/appRegistry';
import { APP_LOADERS, type AppComponentProps } from './appLoaders';
import { MiniAppView } from './MiniAppView';

interface Props {
  appId: AppIdentifier;
  windowId: string;
  metadata?: Record<string, unknown>;
}

const cache = new Map<BuiltinAppId, LazyExoticComponent<ComponentType<AppComponentProps>>>();

function getComponent(id: BuiltinAppId): LazyExoticComponent<ComponentType<AppComponentProps>> {
  const cached = cache.get(id);
  if (cached) return cached;
  const component = lazy(APP_LOADERS[id]);
  cache.set(id, component);
  return component;
}

function AppLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-desktop-window text-desktop-muted">
      <div className="flex items-center gap-2 text-xs">
        <span className="h-2 w-2 animate-pulse rounded-full bg-desktop-highlight" />
        正在按需加载应用…
      </div>
    </div>
  );
}

export function AppContent({ appId, windowId, metadata }: Props) {
  const builtinId = resolveBuiltinId(appId);
  if (builtinId) {
    const Component = getComponent(builtinId);
    return (
      <Suspense fallback={<AppLoading />}>
        <Component windowId={windowId} metadata={metadata} />
      </Suspense>
    );
  }
  if (isMiniApp(appId)) {
    return <MiniAppView appId={appId} />;
  }
  return (
    <div className="flex h-full items-center justify-center text-sm text-desktop-muted">
      未知应用: {appId}
    </div>
  );
}
