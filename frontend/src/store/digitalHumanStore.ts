import { create } from 'zustand';

export type DigitalHumanActivity = 'idle' | 'thinking' | 'speaking' | 'alert';
export type DigitalHumanQuality = 'eco' | 'balanced' | 'high';
export type DigitalHumanScale = 'compact' | 'standard' | 'large';

interface DigitalHumanPreferences {
  quality: DigitalHumanQuality;
  scale: DigitalHumanScale;
  followPointer: boolean;
  showStatusBubble: boolean;
}

interface DigitalHumanStore extends DigitalHumanPreferences {
  activity: DigitalHumanActivity;
  setActivity: (activity: DigitalHumanActivity, resetAfterMs?: number) => void;
  previewActivity: (activity: DigitalHumanActivity, durationMs?: number) => void;
  updatePreferences: (patch: Partial<DigitalHumanPreferences>) => void;
}

const STORAGE_KEY = 'x-computer-digital-human-v1';
let activityResetTimer: number | null = null;
let previewLockedUntil = 0;

function loadPreferences(): DigitalHumanPreferences {
  const defaults: DigitalHumanPreferences = {
    quality: 'eco',
    scale: 'standard',
    followPointer: true,
    showStatusBubble: true,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<DigitalHumanPreferences>;
    return {
      quality: parsed.quality === 'balanced' || parsed.quality === 'high' ? parsed.quality : 'eco',
      scale: parsed.scale === 'compact' || parsed.scale === 'large' ? parsed.scale : 'standard',
      followPointer: parsed.followPointer !== false,
      showStatusBubble: parsed.showStatusBubble !== false,
    };
  } catch {
    return defaults;
  }
}

function persistPreferences(preferences: DigitalHumanPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // ignore
  }
}

const initialPreferences = loadPreferences();

export const useDigitalHumanStore = create<DigitalHumanStore>((set, get) => ({
  ...initialPreferences,
  activity: 'idle',
  setActivity: (activity, resetAfterMs) => {
    if (Date.now() < previewLockedUntil) return;
    if (activityResetTimer != null) {
      window.clearTimeout(activityResetTimer);
      activityResetTimer = null;
    }
    set({ activity });
    if (resetAfterMs && resetAfterMs > 0 && activity !== 'idle') {
      activityResetTimer = window.setTimeout(() => {
        set({ activity: 'idle' });
        activityResetTimer = null;
      }, resetAfterMs);
    }
  },
  previewActivity: (activity, durationMs = 5000) => {
    if (activityResetTimer != null) {
      window.clearTimeout(activityResetTimer);
      activityResetTimer = null;
    }
    const safeDuration = Math.max(1000, durationMs);
    previewLockedUntil = Date.now() + safeDuration;
    set({ activity });
    activityResetTimer = window.setTimeout(() => {
      previewLockedUntil = 0;
      set({ activity: 'idle' });
      activityResetTimer = null;
    }, safeDuration);
  },
  updatePreferences: (patch) => {
    const current = get();
    const next: DigitalHumanPreferences = {
      quality: patch.quality ?? current.quality,
      scale: patch.scale ?? current.scale,
      followPointer: patch.followPointer ?? current.followPointer,
      showStatusBubble: patch.showStatusBubble ?? current.showStatusBubble,
    };
    persistPreferences(next);
    set(next);
  },
}));
