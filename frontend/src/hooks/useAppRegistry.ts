import { useSyncExternalStore } from 'react';
import { getAppRegistryRevision, subscribeAppRegistry } from '@/appRegistry';

export function useAppRegistryRevision(): number {
  return useSyncExternalStore(
    subscribeAppRegistry,
    getAppRegistryRevision,
    getAppRegistryRevision,
  );
}
