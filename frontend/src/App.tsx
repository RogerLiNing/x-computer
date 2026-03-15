import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Desktop } from './components/desktop/Desktop';
import { LoginScreen } from './components/auth/LoginScreen';
import { LandingPage } from './components/landing/LandingPage';
import { api } from '@/utils/api';

function AuthOrDesktop() {
  const [authStatus, setAuthStatus] = useState<'loading' | 'logged-in' | 'logged-out'>('loading');

  useEffect(() => {
    api
      .getMe()
      .then((user) => {
        setAuthStatus(user?.email ? 'logged-in' : 'logged-out');
      })
      .catch(() => {
        setAuthStatus('logged-out');
      });
  }, []);

  if (authStatus === 'loading') {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center bg-desktop-bg"
        style={{
          background:
            'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%)',
        }}
      >
        <div className="text-desktop-muted animate-pulse">加载中…</div>
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
