import { useEffect, useRef, useState } from 'react';
import {
  useDigitalHumanStore,
  type DigitalHumanActivity,
} from '@/store/digitalHumanStore';

interface DigitalHumanLive2DProps {
  className?: string;
  studio?: boolean;
}

const ASSET_ROOT = '/digital-human/secretary-v1';
const NEUTRAL_IMAGE = `${ASSET_ROOT}/neutral.webp`;
const LEFT_EYE_CLOSED_IMAGE = `${ASSET_ROOT}/parts/eye-left-closed.webp`;
const RIGHT_EYE_CLOSED_IMAGE = `${ASSET_ROOT}/parts/eye-right-closed.webp`;
const MOUTH_OPEN_IMAGE = `${ASSET_ROOT}/parts/mouth-open.webp`;

const ACTIVITY_ACCENTS: Record<DigitalHumanActivity, string> = {
  idle: 'rgba(103, 232, 249, 0.42)',
  thinking: 'rgba(167, 139, 250, 0.58)',
  speaking: 'rgba(244, 114, 182, 0.58)',
  alert: 'rgba(251, 191, 36, 0.64)',
};

export default function DigitalHumanLive2D({
  className = '',
  studio = false,
}: DigitalHumanLive2DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activity = useDigitalHumanStore((state) => state.activity);
  const quality = useDigitalHumanStore((state) => state.quality);
  const followPointer = useDigitalHumanStore((state) => state.followPointer);
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (quality === 'eco' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setBlinking(false);
      return;
    }

    let blinkTimer = 0;
    let reopenTimer = 0;
    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        setBlinking(true);
        reopenTimer = window.setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 150);
      }, 2600 + Math.random() * 2400);
    };
    scheduleBlink();
    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(reopenTimer);
    };
  }, [quality]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!followPointer) {
      host.style.setProperty('--look-x', '0');
      host.style.setProperty('--look-y', '0');
      return;
    }

    let animationFrame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const updatePointer = (event: PointerEvent) => {
      pointerX = (event.clientX / window.innerWidth - 0.5) * 2;
      pointerY = (event.clientY / window.innerHeight - 0.5) * 2;
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        host.style.setProperty('--look-x', pointerX.toFixed(3));
        host.style.setProperty('--look-y', pointerY.toFixed(3));
        animationFrame = 0;
      });
    };

    window.addEventListener('pointermove', updatePointer, { passive: true });
    return () => {
      window.removeEventListener('pointermove', updatePointer);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [followPointer]);

  const isSpeaking = activity === 'speaking';
  const isThinking = activity === 'thinking';
  const isAlert = activity === 'alert';
  const motionEnabled = quality !== 'eco';
  const fullEffects = quality === 'high';

  return (
    <div
      ref={hostRef}
      className={`relative isolate overflow-visible ${className}`}
      data-digital-human-activity={activity}
      data-digital-human-renderer="live2d-layered"
      data-digital-human-face-rig="left-eye,right-eye,mouth"
      style={{
        '--look-x': '0',
        '--look-y': '0',
        '--activity-accent': ACTIVITY_ACCENTS[activity],
      } as React.CSSProperties}
    >
      <div
        className={`absolute left-1/2 top-1/2 aspect-[2/3] -translate-x-1/2 -translate-y-1/2 ${
          studio ? 'h-[94%]' : 'h-full'
        }`}
      >
        <span className="absolute inset-[8%_5%_3%] rounded-[48%_48%_35%_35%] bg-[radial-gradient(circle_at_50%_25%,var(--activity-accent),transparent_58%)] opacity-35 blur-2xl transition-colors duration-500" />
        <span
          className={`absolute inset-[8%_7%_4%] rounded-[50%] border border-white/10 shadow-[0_0_42px_var(--activity-accent)] ${
            isAlert ? 'animate-pulse' : ''
          }`}
          style={{
            transform: followPointer
              ? 'translate(calc(var(--look-x) * 4px), calc(var(--look-y) * 3px))'
              : undefined,
          }}
        />

        <div className={`absolute inset-0 origin-[50%_78%] ${motionEnabled ? 'animate-[x-live2d-body_5.4s_ease-in-out_infinite]' : ''}`}>
          <img
            src={NEUTRAL_IMAGE}
            alt={studio ? 'X 的成年女性秘书数字人形象' : ''}
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain drop-shadow-[0_18px_28px_rgba(2,6,23,0.48)]"
            style={{ clipPath: 'inset(26% 0 0 0)' }}
          />
        </div>

        <div
          className={`absolute inset-0 origin-[50%_34%] will-change-transform ${
            motionEnabled ? 'animate-[x-live2d-head_4.8s_ease-in-out_infinite]' : ''
          } ${isThinking ? 'rotate-[-1.2deg]' : ''}`}
        >
          <img
            src={NEUTRAL_IMAGE}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
            style={{ clipPath: 'inset(0 0 48% 0)' }}
          />
          {blinking && !isSpeaking && (
            <>
              <img
                src={LEFT_EYE_CLOSED_IMAGE}
                alt=""
                draggable={false}
                className="pointer-events-none absolute select-none"
                style={{ left: '29.2969%', top: '6.8359%', width: '23.9258%', height: '13.6719%' }}
              />
              <img
                src={RIGHT_EYE_CLOSED_IMAGE}
                alt=""
                draggable={false}
                className="pointer-events-none absolute select-none"
                style={{ left: '46.875%', top: '6.8359%', width: '23.9258%', height: '13.6719%' }}
              />
            </>
          )}
          {isSpeaking && (
            <img
              src={MOUTH_OPEN_IMAGE}
              alt=""
              draggable={false}
              className="pointer-events-none absolute select-none animate-[x-live2d-mouth-shape_0.34s_ease-in-out_infinite]"
              style={{
                left: '36.6211%',
                top: '13.3464%',
                width: '26.8555%',
                height: '13.0208%',
              }}
            />
          )}
        </div>

        {followPointer && (
          <div
            className="pointer-events-none absolute inset-0 opacity-35"
            style={{
              transform: 'translate(calc(var(--look-x) * 1.2px), calc(var(--look-y) * 0.8px))',
            }}
          >
            <span className="absolute left-[45.2%] top-[16.1%] h-[0.9%] w-[1.1%] rounded-full bg-white/80 blur-[0.3px]" />
            <span className="absolute right-[45.2%] top-[16.1%] h-[0.9%] w-[1.1%] rounded-full bg-white/80 blur-[0.3px]" />
          </div>
        )}

        {isThinking && (
          <div className="absolute right-[16%] top-[12%] flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-200/70" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-violet-200/80 [animation-delay:180ms]" />
            <span className="h-3 w-3 animate-pulse rounded-full bg-violet-100/90 [animation-delay:360ms]" />
          </div>
        )}

        {fullEffects && (
          <>
            <span className="absolute left-[13%] top-[28%] h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-200/75 shadow-[0_0_10px_#67e8f9]" />
            <span className="absolute right-[13%] top-[42%] h-1 w-1 animate-pulse rounded-full bg-pink-200/75 shadow-[0_0_10px_#f9a8d4] [animation-delay:700ms]" />
            <span className="absolute left-[19%] top-[55%] h-1 w-1 animate-pulse rounded-full bg-violet-200/75 shadow-[0_0_10px_#c4b5fd] [animation-delay:1200ms]" />
          </>
        )}
      </div>

      <style>{`
        @keyframes x-live2d-body {
          0%, 100% { transform: translateY(0) scaleY(1); }
          50% { transform: translateY(-0.45%) scaleY(1.006); }
        }
        @keyframes x-live2d-head {
          0%, 100% { transform: translateY(0) rotate(-0.35deg); }
          50% { transform: translateY(-0.35%) rotate(0.45deg); }
        }
        @keyframes x-live2d-mouth-shape {
          0%, 100% { transform: scaleY(0.94); }
          50% { transform: scaleY(1.04); }
        }
      `}</style>
    </div>
  );
}
