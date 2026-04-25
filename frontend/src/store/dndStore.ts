/**
 * Do Not Disturb store.
 * Manages DND state and determines whether notifications should be shown.
 */
let _dndEnabled = false;
let _quietHoursStart: string | null = null;
let _quietHoursEnd: string | null = null;
const listeners = new Set<(enabled: boolean) => void>();

function isQuietHours(): boolean {
  if (!_quietHoursStart || !_quietHoursEnd) return false;
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  // Handle overnight ranges (e.g., 22:00 - 08:00)
  if (_quietHoursStart > _quietHoursEnd) {
    return currentTime >= _quietHoursStart || currentTime <= _quietHoursEnd;
  }
  return currentTime >= _quietHoursStart && currentTime <= _quietHoursEnd;
}

export function isDndActive(): boolean {
  if (_dndEnabled) return true;
  return isQuietHours();
}

export function setDndEnabled(enabled: boolean): void {
  _dndEnabled = enabled;
  listeners.forEach((l) => l(enabled));
  // Persist to localStorage for immediate use
  try {
    localStorage.setItem('x-dnd-enabled', JSON.stringify(enabled));
  } catch { /* ignore */ }
}

export function setDndPreferences(prefs: { enabled?: boolean; quietHoursStart?: string | null; quietHoursEnd?: string | null }): void {
  if (prefs.enabled !== undefined) _dndEnabled = prefs.enabled;
  if (prefs.quietHoursStart !== undefined) _quietHoursStart = prefs.quietHoursStart;
  if (prefs.quietHoursEnd !== undefined) _quietHoursEnd = prefs.quietHoursEnd;
}

export function subscribeDndState(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initDndFromStorage(): void {
  try {
    const stored = localStorage.getItem('x-dnd-enabled');
    if (stored !== null) _dndEnabled = JSON.parse(stored);
  } catch { /* ignore */ }
}

// Initialize on module load
initDndFromStorage();
