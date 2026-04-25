/**
 * OAuth 回调页面：处理 Google/GitHub OAuth 授权后的回调
 *
 * 流程：OAuth Provider 授权后重定向到 /oauth-callback?userId=xxx 或 ?error=xxx
 * 1. 解析 URL 参数
 * 2. 成功时：将 userId 存入 localStorage 并重定向到 /app
 * 3. 失败时：显示错误并重定向到 /app
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setUserId } from '@/utils/userId';

export function OAuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const error = params.get('error');

    if (userId) {
      setUserId(userId);
      // 清空 URL 参数
      window.history.replaceState({}, '', '/app');
      navigate('/app', { replace: true });
    } else {
      console.error('OAuth failed:', error);
      window.history.replaceState({}, '', '/app');
      navigate('/app', { replace: true });
    }
  }, [navigate]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-desktop-bg">
      <div className="text-desktop-muted animate-pulse">处理登录中…</div>
    </div>
  );
}
