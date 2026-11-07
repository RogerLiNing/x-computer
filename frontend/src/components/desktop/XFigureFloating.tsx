import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';
import { useConnectionStore } from '@/store/connectionStore';
import { isAppEnabled } from '@/appRegistry';
import { useAppRegistryRevision } from '@/hooks/useAppRegistry';
import {
  useDigitalHumanStore,
  type DigitalHumanActivity,
  type DigitalHumanScale,
} from '@/store/digitalHumanStore';

const DigitalHumanLive2D = lazy(() => import('./digital-human/DigitalHumanLive2D'));

const SCALE_STYLES: Record<DigitalHumanScale, { width: number; height: number }> = {
  compact: { width: 112, height: 164 },
  standard: { width: 150, height: 220 },
  large: { width: 190, height: 280 },
};

const ACTIVITY_LABELS: Record<DigitalHumanActivity, string> = {
  idle: '我在这里',
  thinking: '正在思考…',
  speaking: '正在回应…',
  alert: '有新消息',
};

function FigureFallback() {
  return (
    <div className="absolute inset-[12%_18%] animate-pulse rounded-[48%_48%_35%_35%] bg-gradient-to-b from-violet-400/20 to-cyan-300/10 blur-xl">
    </div>
  );
}

export function XFigureFloating() {
  useAppRegistryRevision();
  const openApp = useDesktopStore((state) => state.openApp);
  const covered = useDesktopStore((state) => state.windows.some(window => window.isMaximized && !window.isMinimized));
  const xProactiveMessages = useConnectionStore((state) => state.xProactiveMessages);
  const activity = useDigitalHumanStore((state) => state.activity);
  const scale = useDigitalHumanStore((state) => state.scale);
  const showStatusBubble = useDigitalHumanStore((state) => state.showStatusBubble);
  const setActivity = useDigitalHumanStore((state) => state.setActivity);

  const unreadMessages = useMemo(
    () => xProactiveMessages.filter((message) => !message.read),
    [xProactiveMessages],
  );
  const unreadCount = unreadMessages.length;
  const latestUnread = unreadMessages[0]?.content?.trim();
  const enabled = isAppEnabled('digital-human');
  const dimensions = SCALE_STYLES[scale];

  useEffect(() => {
    if (unreadCount > 0) setActivity('alert', 5000);
  }, [setActivity, unreadCount]);

  if (!enabled || covered) return null;

  const bubbleText = activity === 'alert' && latestUnread
    ? latestUnread.slice(0, 42)
    : ACTIVITY_LABELS[activity];

  return (
    <div
      className="group absolute bottom-14 right-3 z-20 pointer-events-auto"
      style={{ width: dimensions.width, height: dimensions.height }}
      data-testid="digital-human-floating"
    >
      {showStatusBubble && (activity !== 'idle' || unreadCount > 0) && (
        <div className="absolute right-[72%] top-[17%] z-20 w-max max-w-48 rounded-2xl rounded-br-sm border border-cyan-200/15 bg-slate-950/80 px-3 py-2 text-[11px] leading-4 text-cyan-50 shadow-xl backdrop-blur-xl">
          {bubbleText}
          <span className="absolute -right-1 bottom-0 h-2 w-2 rotate-45 border-r border-b border-cyan-200/15 bg-slate-950/80" />
        </div>
      )}

      <button
        type="button"
        onClick={() => openApp('x')}
        className="group relative h-full w-full overflow-visible rounded-[42%_42%_28%_28%] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        title="X 数字人 — 点击与 X 对话"
        aria-label="打开 X 主脑"
      >
        <span className="absolute inset-x-[14%] bottom-[5%] h-[16%] rounded-full bg-cyan-400/15 blur-xl transition-opacity group-hover:opacity-100" />
        <Suspense fallback={<FigureFallback />}>
          <DigitalHumanLive2D className="absolute inset-0 h-full w-full transition-transform duration-300 group-hover:scale-[1.04]" />
        </Suspense>
        <span className="absolute inset-x-[20%] bottom-[3%] rounded-full border border-white/10 bg-slate-950/55 px-2 py-1 text-[9px] font-medium tracking-wide text-cyan-50/85 opacity-80 shadow-lg backdrop-blur transition-opacity group-hover:opacity-100">
          X · {ACTIVITY_LABELS[activity].replace('…', '')}
        </span>
        {unreadCount > 0 && (
          <span className="absolute right-[12%] top-[9%] flex h-[21px] min-w-[21px] items-center justify-center rounded-full border-2 border-slate-900 bg-rose-500 px-1 text-[10px] font-semibold text-white shadow-lg">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => openApp('digital-human')}
        className="absolute bottom-[8%] right-[5%] z-20 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-slate-950/70 text-white/55 opacity-0 shadow-lg backdrop-blur transition-all hover:text-cyan-200 group-hover:opacity-100 focus:opacity-100"
        title="数字人设置"
        aria-label="打开数字人设置"
      >
        <Settings2 size={13} />
      </button>
    </div>
  );
}
