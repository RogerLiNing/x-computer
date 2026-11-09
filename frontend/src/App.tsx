import {verifySession} from '@/utils/verifySession';
import {setUserId} from '@/utils/userId';
import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Desktop } from './components/desktop/Desktop';
import { LoginScreen } from './components/auth/LoginScreen';
import { OAuthCallbackPage } from './components/auth/OAuthCallbackPage';
import { LandingPage } from './components/landing/LandingPage';
import { api } from '@/utils/api';

function AuthOrDesktop() {
  const [authStatus, setAuthStatus] = useState<'loading' | 'logged-in' | 'logged-out' | 'unavailable'>('loading');

  const [retryVersion,setRetryVersion]=useState(0);
  useEffect(()=>{
    let live=true;let retry:ReturnType<typeof setTimeout>|undefined;let timeout:ReturnType<typeof setTimeout>|undefined;let controller:AbortController|undefined;
    const check=async()=>{
      const requestController=new AbortController();controller=requestController;timeout=setTimeout(()=>requestController.abort(),5000);
      const result=await verifySession(()=>api.getMe({signal:requestController.signal}));clearTimeout(timeout);
      if(!live)return;
      let status=result.status;
      if(result.status==='logged-in'){try{setUserId(result.userId);}catch{status='unavailable';}}
      setAuthStatus(status);
      if(status==='unavailable')retry=setTimeout(()=>void check(),3000);
    };
    void check();
    return()=>{live=false;clearTimeout(retry);clearTimeout(timeout);controller?.abort();};
  },[retryVersion]);

  if (authStatus === 'loading' || authStatus === 'unavailable') {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center bg-desktop-bg"
        style={{
          background:
            'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%)',
        }}
      >
        <div className="text-center space-y-3" role="status" aria-live="polite">
          <p className="text-desktop-muted">{authStatus==='loading'?'正在连接助手…':'连接暂时中断，正在自动重试。已保存的草稿会保留。'}</p>
          {authStatus==='unavailable'&&<button type="button" className="rounded-xl px-5 py-3 bg-white/10 text-desktop-text" onClick={()=>{setAuthStatus('loading');setRetryVersion(version=>version+1);}}>立即重试</button>}
        </div>
      </div>
    );
  }

  if (authStatus === 'logged-out') {
    return <LoginScreen onLoggedIn={() => setAuthStatus('logged-in')} />;
  }

  return <Desktop />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<AuthOrDesktop />} />
      <Route path="/app/*" element={<AuthOrDesktop />} />
      <Route path="/oauth-callback" element={<OAuthCallbackPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
