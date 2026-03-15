/**
 * Admin 状态：当前用户是否为管理员，用于控制 Admin 应用入口可见性。
 */

import { create } from 'zustand';

interface AdminState {
  isAdmin: boolean | null;
  setAdmin: (v: boolean) => void;
  fetchAdminStatus: () => Promise<void>;
}

export const useAdminStore = create<AdminState>((set) => ({
  isAdmin: null,
  setAdmin: (v) => set({ isAdmin: v }),
  fetchAdminStatus: async () => {
    try {
      const res = await fetch('/api/admin/check', {
        headers: { 'X-User-Id': (await import('@/utils/userId.js')).getUserId() },
      });
      set({ isAdmin: res.ok });
    } catch {
      set({ isAdmin: false });
    }
  },
}));
