import { useTranslation } from 'react-i18next';
import { TASK_TEMPLATES, type TaskTemplateCategory } from '@/config/taskTemplates';

interface QuickActionsProps {
  onSetInput: (input: string) => void;
  onFocusInput: () => void;
  onSendMessage: (text?: string) => void;
}

export function QuickActions({ onSetInput, onFocusInput, onSendMessage }: QuickActionsProps) {
  const { t } = useTranslation();

  const quickActions = [
    { labelKey: 'chat.exampleOrganizeEmail', textKey: 'chat.exampleOrganizeEmail' },
    { labelKey: 'chat.exampleWriteCode', textKey: 'chat.exampleWriteCode' },
    { labelKey: 'chat.exampleWeeklyReport', textKey: 'chat.exampleWeeklyReport' },
    { labelKey: 'chat.exampleSummarizeDoc', textKey: 'chat.exampleSummarizeDoc' },
    { labelKey: 'chat.exampleExplainCode', textKey: 'chat.exampleExplainCode' },
    { labelKey: 'chat.exampleSearchWeb', textKey: 'chat.exampleSearchWeb' },
  ];

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-2">
        <div className="text-[11px] text-desktop-muted font-medium">{t('chat.tryThese')}</div>
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <button
              key={action.labelKey}
              className="shrink-0 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-desktop-muted hover:text-desktop-text border border-white/5 transition-colors"
              onClick={() => {
                onSetInput(t(action.textKey));
                onFocusInput();
              }}
            >
              {t(action.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-[11px] text-desktop-muted font-medium">{t('templates.quickTasks')}</div>
        <div className="space-y-2">
          {(['student', 'office', 'research', 'dev'] as TaskTemplateCategory[]).map((cat) => {
            const items = TASK_TEMPLATES.filter((tm) => tm.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="flex flex-wrap gap-2 items-center">
                <span className="text-[10px] text-desktop-muted/80 w-12 shrink-0">{t(`templates.category${cat.charAt(0).toUpperCase() + cat.slice(1)}`)}</span>
                {items.map((tm) => (
                  <button
                    key={tm.id}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg bg-desktop-accent/20 hover:bg-desktop-accent/30 text-[11px] text-desktop-muted hover:text-desktop-text border border-desktop-accent/30 transition-colors"
                    onClick={() => onSendMessage(t(tm.textKey))}
                  >
                    {t(tm.labelKey)}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
