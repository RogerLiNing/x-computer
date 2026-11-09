import {
  BellRing,
  BrainCircuit,
  Gauge,
  MessageCircle,
  MousePointer2,
  Sparkles,
  Volume2,
} from 'lucide-react';
import DigitalHumanLive2D from '@/components/desktop/digital-human/DigitalHumanLive2D';
import {
  useDigitalHumanStore,
  type DigitalHumanActivity,
  type DigitalHumanQuality,
  type DigitalHumanScale,
} from '@/store/digitalHumanStore';

const ACTIVITY_OPTIONS: Array<{
  id: DigitalHumanActivity;
  label: string;
  icon: typeof Sparkles;
}> = [
  { id: 'idle', label: '待机', icon: Sparkles },
  { id: 'thinking', label: '思考', icon: BrainCircuit },
  { id: 'speaking', label: '说话', icon: Volume2 },
  { id: 'alert', label: '提醒', icon: BellRing },
];

const QUALITY_OPTIONS: Array<{ id: DigitalHumanQuality; label: string; description: string }> = [
  { id: 'eco', label: '节能', description: '静态分层，最低资源占用' },
  { id: 'balanced', label: '均衡', description: '呼吸、眨眼与视线跟随' },
  { id: 'high', label: '精细', description: '完整光效与环境粒子' },
];

const SCALE_OPTIONS: Array<{ id: DigitalHumanScale; label: string }> = [
  { id: 'compact', label: '小巧' },
  { id: 'standard', label: '标准' },
  { id: 'large', label: '醒目' },
];

export function DigitalHumanApp() {
  const activity = useDigitalHumanStore((state) => state.activity);
  const quality = useDigitalHumanStore((state) => state.quality);
  const scale = useDigitalHumanStore((state) => state.scale);
  const followPointer = useDigitalHumanStore((state) => state.followPointer);
  const showStatusBubble = useDigitalHumanStore((state) => state.showStatusBubble);
  const previewActivity = useDigitalHumanStore((state) => state.previewActivity);
  const updatePreferences = useDigitalHumanStore((state) => state.updatePreferences);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(280px,0.9fr)_minmax(300px,1.1fr)] overflow-hidden bg-desktop-window text-desktop-text">
      <section className="relative min-h-0 overflow-hidden border-r border-white/10 bg-gradient-to-b from-violet-950/45 via-slate-950/20 to-cyan-950/30">
        <div className="absolute inset-x-8 top-8 h-36 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="absolute inset-x-12 bottom-8 h-28 rounded-full bg-cyan-400/10 blur-3xl" />
        <DigitalHumanLive2D className="relative h-full w-full" studio />
        <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center">
          <span className="rounded-full border border-cyan-300/15 bg-slate-950/55 px-3 py-1 text-[10px] text-cyan-100/80 backdrop-blur">
            X · GenImage Live2D 数字身体
          </span>
        </div>
      </section>

      <section className="min-h-0 overflow-y-auto p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-violet-400/15 p-2.5 text-violet-200">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold">X 数字人</h2>
            <p className="mt-1 text-xs leading-5 text-desktop-muted">
              GenImage 生成的成年女性秘书形象，通过身体、头部、眨眼和口型分层响应 X 的思考、回答、自主运行和提醒。
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium">
              <MessageCircle size={14} className="text-cyan-300" />
              动作预览
            </div>
            <div className="grid grid-cols-4 gap-2">
              {ACTIVITY_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = activity === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => previewActivity(option.id)}
                    className={`rounded-xl border px-2 py-2.5 text-[11px] transition-colors ${
                      selected
                        ? 'border-cyan-300/35 bg-cyan-300/10 text-cyan-100'
                        : 'border-white/8 bg-white/[0.025] text-desktop-muted hover:text-desktop-text'
                    }`}
                  >
                    <Icon size={15} className="mx-auto mb-1.5" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium">
              <Gauge size={14} className="text-emerald-300" />
              渲染质量
            </div>
            <div className="space-y-2">
              {QUALITY_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => updatePreferences({ quality: option.id })}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    quality === option.id
                      ? 'border-emerald-300/30 bg-emerald-300/[0.07]'
                      : 'border-white/8 bg-white/[0.025]'
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${quality === option.id ? 'bg-emerald-300' : 'bg-white/10'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">{option.label}</span>
                    <span className="block text-[10px] text-desktop-muted">{option.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 text-xs font-medium">桌面尺寸</div>
            <div className="grid grid-cols-3 gap-2">
              {SCALE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => updatePreferences({ scale: option.id })}
                  className={`rounded-lg border py-2 text-[11px] ${
                    scale === option.id
                      ? 'border-violet-300/35 bg-violet-300/10 text-violet-100'
                      : 'border-white/8 text-desktop-muted'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <button
              type="button"
              role="switch"
              aria-checked={followPointer}
              onClick={() => updatePreferences({ followPointer: !followPointer })}
              className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-3 text-left"
            >
              <MousePointer2 size={16} className="text-violet-300" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">视线跟随指针</span>
                <span className="block text-[10px] text-desktop-muted">仅眼神高光和背景光环跟随指针，身体保持稳定</span>
              </span>
              <span className={`relative h-6 w-11 rounded-full ${followPointer ? 'bg-violet-500' : 'bg-white/10'}`}>
                <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${followPointer ? 'translate-x-5' : ''}`} />
              </span>
            </button>

            <button
              type="button"
              role="switch"
              aria-checked={showStatusBubble}
              onClick={() => updatePreferences({ showStatusBubble: !showStatusBubble })}
              className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-3 text-left"
            >
              <BrainCircuit size={16} className="text-cyan-300" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">显示状态气泡</span>
                <span className="block text-[10px] text-desktop-muted">在桌面形象旁显示思考、说话和提醒状态</span>
              </span>
              <span className={`relative h-6 w-11 rounded-full ${showStatusBubble ? 'bg-cyan-500' : 'bg-white/10'}`}>
                <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${showStatusBubble ? 'translate-x-5' : ''}`} />
              </span>
            </button>
          </section>

          <p className="rounded-xl border border-white/6 bg-black/10 px-3 py-2.5 text-[10px] leading-4 text-desktop-muted">
            数字人是独立可拔插模块。停用插件后角色图片和动画层会完全卸载，X 主脑的对话和自主循环仍正常运行。
          </p>
        </div>
      </section>
    </div>
  );
}
