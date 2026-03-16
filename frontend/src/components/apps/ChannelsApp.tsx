/**
 * 渠道管理：引导用户到设置中配置渠道
 */

import { useEffect } from 'react';
import { MessageSquare, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '@/store/adminStore';

interface Props {
  windowId: string;
}

export function ChannelsApp({ windowId }: Props) {
  const navigate = useNavigate();

  // 跳转到设置页面的渠道 tab
  useEffect(() => {
    // 使用 replaceState 来改变 URL，不添加历史记录
    window.history.replaceState(null, '', '/?tab=settings&subTab=channels');
    // 触发设置标签切换
    const event = new CustomEvent('navigate-to-settings', { detail: { tab: 'settings', subTab: 'channels' } });
    window.dispatchEvent(event);
  }, []);

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <div className="flex items-center gap-2 mb-6">
        <MessageSquare size={20} className="text-desktop-accent" />
        <h2 className="text-lg font-medium text-desktop-text">渠道管理</h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-desktop-accent/20 flex items-center justify-center mb-4">
          <MessageSquare size={32} className="text-desktop-accent" />
        </div>
        <h3 className="text-base font-medium text-desktop-text mb-2">
          渠道配置已移至系统设置
        </h3>
        <p className="text-sm text-desktop-muted mb-6 max-w-xs">
          您可以在系统设置中找到完整的渠道配置，包括 QQ、WhatsApp、Telegram、Discord、Slack 和邮件设置。
        </p>
        <button
          onClick={() => {
            window.history.replaceState(null, '', '/?tab=settings&subTab=channels');
            const event = new CustomEvent('navigate-to-settings', { detail: { tab: 'settings', subTab: 'channels' } });
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
