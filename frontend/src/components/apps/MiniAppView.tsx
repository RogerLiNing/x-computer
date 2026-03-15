/**
 * X 制作的小程序展示：iframe 加载沙箱内 apps/<id>/index.html
 * 需要 allow-same-origin：小程序会用到 localStorage（如存最高分），无此标志会抛 SecurityError。
 * 同时带 allow-scripts 时浏览器会提示「可逃出沙箱」——此处加载的是本系统沙箱内应用，非任意第三方，可接受。
 * 打开时向 WS 订阅 app_channel，后端或 X 通过 backend.broadcast_to_app 推送的消息会 postMessage 到 iframe，
 * 小程序内可监听：window.addEventListener('message', e => { if (e.data?.type === 'x_app_channel') { ... e.data.data } })。
 */
import { useEffect, useRef } from 'react';
import { getUserId } from '@/utils/userId';
import { useDesktopStore } from '@/store/desktopStore';

interface Props {
  appId: string;
}

const BASE = '/api';

export function MiniAppView({ appId }: Props) {
  const userId = getUserId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = `${BASE}/apps/sandbox/${encodeURIComponent(userId)}/apps/${appId}/index.html`;

  useEffect(() => {
    const store = useDesktopStore.getState();
    store.sendWs?.({ type: 'subscribe_app', data: { appId } });
    const unsub = store.subscribeAppChannel(appId, (message) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'x_app_channel', data: message }, '*');
      }
    });
    return () => {
      unsub();
      useDesktopStore.getState().sendWs?.({ type: 'unsubscribe_app', data: { appId } });
    };
  }, [appId]);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={appId}
      className="w-full h-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin"
      allow="autoplay; fullscreen"
    />
  );
}
