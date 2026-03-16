/**
 * 技能管理：引导用户到设置中配置技能
 */

import { useEffect } from 'react';
import { Sparkles, ExternalLink } from 'lucide-react';

interface Props {
  windowId: string;
}

export function SkillsApp({ windowId }: Props) {
  useEffect(() => {
    window.history.replaceState(null, '', '/?tab=settings&subTab=skills');
    const event = new CustomEvent('navigate-to-settings', { detail: { tab: 'settings', subTab: 'skills' } });
    window.dispatchEvent(event);
  }, []);

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <div className="flex items-center gap-2 mb-6">
        <Sparkles size={20} className="text-desktop-accent" />
        <h2 className="text-lg font-medium text-desktop-text">技能管理</h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-desktop-accent/20 flex items-center justify-center mb-4">
          <Sparkles size={32} className="text-desktop-accent" />
        </div>
        <h3 className="text-base font-medium text-desktop-text mb-2">
          技能配置已移至系统设置
        </h3>
        <p className="text-sm text-desktop-muted mb-6 max-w-xs">
          您可以在系统设置中管理技能，包括搜索安装 SkillHub 技能、配置 API Key、删除已安装的技能等。
        </p>
        <button
          onClick={() => {
            window.history.replaceState(null, '', '/?tab=settings&subTab=skills');
            const event = new CustomEvent('navigate-to-settings', { detail: { tab: 'settings', subTab: 'skills' } });
            window.dispatchEvent(event);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-desktop-accent text-desktop-bg font-medium text-sm hover:bg-desktop-accent/90 transition-colors"
        >
          <ExternalLink size={16} />
          前往系统设置
        </button>
      </div>
    </div>
  );
}
