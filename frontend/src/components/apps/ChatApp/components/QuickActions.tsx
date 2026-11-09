import { useTranslation } from 'react-i18next';
import { Bell, FileText, PenLine, Search, Sparkles } from 'lucide-react';

interface QuickActionsProps {
  onSetInput: (input: string) => void;
  onFocusInput: () => void;
}

export function QuickActions({ onSetInput, onFocusInput }: QuickActionsProps) {
  const { t } = useTranslation();

  const quickActions = [
    { icon: PenLine, titleKey: 'chat.capabilityWrite', textKey: 'chat.exampleWriteText',previewKey:'chat.exampleWritePreview' },
    { icon: Search, titleKey: 'chat.capabilitySearch', textKey: 'chat.exampleSearchWeb' },
    { icon: FileText, titleKey: 'chat.capabilityFile', textKey: 'chat.exampleSummarizeDoc' },
    { icon: Bell, titleKey: 'chat.capabilityReminder', textKey: 'chat.exampleReminder' },
  ];

  return (
    <div className="rounded-2xl border border-amber-500/15 bg-gradient-to-br from-amber-500/[0.08] via-white/[0.03] to-transparent p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0">
          <Sparkles size={17} className="text-[#C8A96E]" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-gray-100">{t('chat.beginnerTitle')}</h3>
          <p className="text-base leading-6 text-gray-400 mt-1">{t('chat.beginnerSubtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.titleKey}
              type="button"
              className="group min-h-11 min-w-0 flex items-start gap-3 rounded-xl border border-white/[0.07] bg-[#151515]/80 px-3.5 py-3 text-left hover:border-amber-500/25 hover:bg-amber-500/[0.08] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
              onClick={() => {
                onSetInput(t(action.textKey));
                requestAnimationFrame(onFocusInput);
              }}
            >
              <span className="w-8 h-8 rounded-lg bg-white/5 group-hover:bg-amber-500/15 flex items-center justify-center shrink-0 transition-colors">
                <Icon size={15} className="text-gray-400 group-hover:text-[#C8A96E] transition-colors" />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-medium text-gray-200">{t(action.titleKey)}</span>
                <span className="block text-sm leading-6 text-gray-400 mt-1">“{t(action.previewKey??action.textKey)}”</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-sm leading-6 text-gray-400 border-t border-white/5 pt-3">
        {t('chat.beginnerTip')}
      </p>
    </div>
  );
}
