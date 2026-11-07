import { useCallback, useRef, useState, type SetStateAction } from 'react';
import { getUserIdOrNull } from '@/utils/userId';

function read(key: string | null): string {
  if (!key) return '';
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

/** Keep unsent text separate from execution and from other users' conversations. */
export function useChatDraft(sessionId: string | null, scene: 'chat' | 'x') {
  let userId: string | null = null;
  try { userId = getUserIdOrNull(); } catch { /* Storage can be disabled after the app is opened. */ }
  const key = userId ? `x-computer-draft:${JSON.stringify([userId, scene, sessionId])}` : null;
  const [draft, setDraft] = useState(() => ({ key, text: read(key) }));
  const [saveFailed, setSaveFailed] = useState(!userId);
  const text = draft.key === key ? draft.text : read(key);
  const latest = useRef(draft);
  const setText = useCallback((update: SetStateAction<string>) => {
    const current = latest.current.key === key ? latest.current.text : read(key);
    const next = typeof update === 'function' ? update(current) : update;
    latest.current = { key, text: next };
    if (key) {
      try { if (next) localStorage.setItem(key, next); else localStorage.removeItem(key); setSaveFailed(false); }
      catch { setSaveFailed(true); }
    }
    setDraft(latest.current);
  }, [key]);
  return [text, setText, saveFailed] as const;
}
