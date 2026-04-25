import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body?: string;
  duration?: number; // ms, default 4000, 0 = persistent
}

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

const ICONS = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
};

const COLORS = {
  info: 'border-blue-500/30 bg-blue-950/80',
  success: 'border-green-500/30 bg-green-950/80',
  warning: 'border-yellow-500/30 bg-yellow-950/80',
  error: 'border-red-500/30 bg-red-950/80',
};

const ICON_COLORS = {
  info: 'text-blue-400',
  success: 'text-green-400',
  warning: 'text-yellow-400',
  error: 'text-red-400',
};

function Toast({ toast, onDismiss }: ToastProps) {
  const Icon = ICONS[toast.type];
  const duration = toast.duration ?? 4000;

  useEffect(() => {
    if (duration === 0) return;
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, onDismiss]);

  return (
    <div
      className={`flex items-start gap-3 w-72 p-3 rounded-xl border backdrop-blur-sm shadow-xl animate-toast-in ${COLORS[toast.type]}`}
      role="alert"
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${ICON_COLORS[toast.type]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white leading-snug">{toast.title}</p>
        {toast.body && (
          <p className="text-xs text-white/60 mt-0.5 leading-snug">{toast.body}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 p-0.5 text-white/40 hover:text-white/80 transition-colors"
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ── Toast Manager ──────────────────────────────────────────────

type ToastListener = (toasts: ToastItem[]) => void;
const listeners = new Set<ToastListener>();
let currentToasts: ToastItem[] = [];

export function showToast(toast: Omit<ToastItem, 'id'>): void {
  const id = Math.random().toString(36).slice(2);
  currentToasts = [...currentToasts.slice(-4), { ...toast, id }];
  listeners.forEach((l) => l(currentToasts));
}

export function dismissToast(id: string): void {
  currentToasts = currentToasts.filter((t) => t.id !== id);
  listeners.forEach((l) => l(currentToasts));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>(currentToasts);
  const handleDismiss = useCallback(dismissToast, []);

  useEffect(() => {
    listeners.add(setToasts);
    return () => { listeners.delete(setToasts); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={handleDismiss} />
        </div>
      ))}
    </div>
  );
}
