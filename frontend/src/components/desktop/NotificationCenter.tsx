import { useDesktopStore } from '@/store/desktopStore';
import { X, AlertTriangle, Info, AlertCircle, ShieldCheck } from 'lucide-react';

export function NotificationCenter() {
  const { notifications, markNotificationRead } = useDesktopStore();
  const list = Array.isArray(notifications) ? notifications : [];
  const recent = list.filter((n) => !n.read).slice(0, 5);

  if (recent.length === 0) return null;

  const icons = {
    info: <Info size={14} className="text-blue-400" />,
    warning: <AlertTriangle size={14} className="text-yellow-400" />,
    error: <AlertCircle size={14} className="text-red-400" />,
    approval: <ShieldCheck size={14} className="text-purple-400" />,
  };

  return (
    <div className="absolute top-4 right-4 w-72 flex flex-col gap-2 z-[9999]">
      {recent.map((n) => (
        <div
          key={n.id}
          className="bg-desktop-surface/95 backdrop-blur-lg border border-white/10 rounded-xl p-3 animate-slide-up shadow-lg"
        >
          <div className="flex items-start gap-2">
            <div className="mt-0.5">{icons[n.type]}</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-desktop-text">{n.title}</div>
              <div className="text-[11px] text-desktop-muted mt-0.5 line-clamp-2">{n.message}</div>
            </div>
            <button
              className="shrink-0 w-5 h-5 rounded flex items-center justify-center hover:bg-white/10"
              onClick={() => markNotificationRead(n.id)}
            >
              <X size={12} className="text-desktop-muted" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
