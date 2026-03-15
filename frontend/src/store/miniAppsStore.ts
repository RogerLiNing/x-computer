import { create } from 'zustand';

interface MiniApp {
  id: string;
  name: string;
  path: string;
}

interface MiniAppsStore {
  list: MiniApp[];
  set: (list: MiniApp[]) => void;
}

export const useMiniAppsStore = create<MiniAppsStore>((set) => ({
  list: [],
  set: (list) => set({ list: Array.isArray(list) ? list : [] }),
}));
