/**
 * 新手向导：首次登录后展示 3 步引导，帮助用户快速上手
 */

import { useRef, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, X } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';
import { getUserIdOrNull } from '@/utils/userId';
import { useMobileViewport } from '@/hooks/useMobileViewport';

const ONBOARDING_DONE_KEY = 'x-computer-onboarding-v2';

export function OnboardingOverlay() {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const keyRef = useRef<string | null>(null);
  const titleId = useId(), descriptionId = useId();
  const mobile = useMobileViewport();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    try {
      const user = getUserIdOrNull();
      if (!user) return;
      keyRef.current = `${ONBOARDING_DONE_KEY}:${JSON.stringify(user)}`;
      if (localStorage.getItem(keyRef.current) === 'dismissed') return;
    } catch { /* The guide remains usable when storage is unavailable. */ }
    dialog.showModal();
    headingRef.current?.focus({preventScroll:true});
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  const dismiss = () => {
    try { if (keyRef.current) localStorage.setItem(keyRef.current, 'dismissed'); } catch {}
    dialogRef.current?.close();
  };
  const start = () => {
    dismiss();
    if (mobile) return; // The mobile desktop already contains the conversation.
    const desktop = useDesktopStore.getState();
    const existing = desktop.windows.find(window => window.appId === 'chat');
    if (existing) desktop.focusWindow(existing.id);
    else desktop.openApp('chat');
  };

  return <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onKeyDown={event=>{
      if(event.key!=='Tab')return;
      const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),first=buttons[0],last=buttons[buttons.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===headingRef.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }}
    className="m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[calc(100dvh_-_2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-desktop-window p-5 sm:p-6 text-desktop-text shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm">
    <div className="flex items-start justify-between gap-3">
      <div><h2 ref={headingRef} tabIndex={-1} id={titleId} className="text-xl font-semibold">{t('onboarding.welcome')}</h2>
        <p id={descriptionId} className="mt-2 text-base leading-7 text-desktop-muted">{t('onboarding.intro')}</p></div>
      <button type="button" onClick={dismiss} aria-label={t('onboarding.skip')} className="min-h-11 min-w-11 shrink-0 rounded-lg hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"><X size={20} className="mx-auto"/></button>
    </div>
    <ol className="my-6 space-y-5">
      {[1,2,3].map(step=><li key={step} className="flex gap-3">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/10 font-medium text-amber-200">{step}</span>
        <div><h3 className="font-medium">{t(`onboarding.step${step}Title`)}</h3><p className="mt-1 text-sm leading-6 text-desktop-muted">{t(`onboarding.step${step}Desc`)}</p></div>
      </li>)}
    </ol>
    <button type="button" onClick={start} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-ct-accent px-4 py-3 text-base font-semibold text-[#151515] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">{t('onboarding.done')}<ArrowRight size={18} aria-hidden="true"/></button>
    <button type="button" onClick={dismiss} className="mt-2 min-h-11 w-full rounded-lg text-sm text-desktop-muted hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">{t('onboarding.skip')}</button>
  </dialog>;
}
