/**
 * 新手向导：首次登录后展示 3 步引导，帮助用户快速上手
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, X, MessageSquare, Send, ListTodo } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';

const ONBOARDING_DONE_KEY = 'x-computer-onboarding-done';

export function OnboardingOverlay() {
  const { t } = useTranslation();
  const openApp = useDesktopStore((s) => s.openApp);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDING_DONE_KEY) === '1') {
        setVisible(false);
        return;
      }
      setVisible(true);
    } catch {
      setVisible(false);
    }
  }, []);

  const handleDone = () => {
    try {
      localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    } catch {}
    setVisible(false);
  };

  const handleSkip = () => {
    handleDone();
  };

  const handleNext = () => {
    if (step < 2) {
      setStep(step + 1);
    } else {
      handleDone();
    }
  };

  const handleStepAction = () => {
    if (step === 0) {
      openApp('chat');
      setStep(1);
    } else if (step === 1) {
      setStep(2);
    } else {
      openApp('task-timeline');
      handleDone();
    }
  };

  if (!visible) return null;

  const steps = [
    { icon: MessageSquare, titleKey: 'onboarding.step1Title', descKey: 'onboarding.step1Desc', actionKey: 'onboarding.next' },
    { icon: Send, titleKey: 'onboarding.step2Title', descKey: 'onboarding.step2Desc', actionKey: 'onboarding.next' },
    { icon: ListTodo, titleKey: 'onboarding.step3Title', descKey: 'onboarding.step3Desc', actionKey: 'onboarding.done' },
  ];
  const current = steps[step]!;
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-gradient-to-b from-white/10 to-white/5 border border-white/10 shadow-2xl overflow-hidden">
        <button
          type="button"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-desktop-muted hover:text-desktop-text hover:bg-white/10 transition-colors"
          onClick={handleSkip}
          aria-label={t('onboarding.skip')}
        >
          <X size={18} />
        </button>

        <div className="p-6 pt-8">
          <h2 className="text-lg font-semibold text-desktop-text mb-1">{t('onboarding.welcome')}</h2>
          <div className="flex items-center gap-3 mt-6 mb-4">
            <div className="w-12 h-12 rounded-xl bg-desktop-accent/30 flex items-center justify-center">
              <Icon size={24} className="text-desktop-accent" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-desktop-text">{t(current.titleKey)}</h3>
              <p className="text-xs text-desktop-muted mt-0.5">{t(current.descKey)}</p>
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <button
              type="button"
              className="flex-1 py-2.5 rounded-xl bg-desktop-accent/40 hover:bg-desktop-accent/60 text-desktop-text text-sm font-medium transition-colors flex items-center justify-center gap-2"
              onClick={handleStepAction}
            >
              {t(current.actionKey)}
              <ArrowRight size={16} />
            </button>
            {step < 2 && (
              <button
                type="button"
                className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-desktop-muted text-sm transition-colors"
                onClick={handleNext}
              >
                {t('onboarding.next')}
              </button>
            )}
          </div>

          <div className="flex gap-1.5 mt-4 justify-center">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === step ? 'bg-desktop-accent' : 'bg-white/20'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
