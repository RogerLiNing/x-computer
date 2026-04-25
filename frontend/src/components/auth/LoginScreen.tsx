/**
 * Mac 风格登录页：进入系统前必须登录，含注册、验证码、错误提示、OAuth 登录。
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Lock, Mail, RefreshCw, ArrowRight, UserPlus, KeyRound, ArrowLeft } from 'lucide-react';
import { api } from '@/utils/api';
import { setUserId } from '@/utils/userId';

// ── OAuth 图标组件 ──────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

type Tab = 'login' | 'register' | 'forgot';
type ResetStep = 'email' | 'code';

interface OAuthStatus {
  google: boolean;
  github: boolean;
}

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t, i18n } = useTranslation();
  const [allowRegister, setAllowRegister] = useState(true);
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaQuestion, setCaptchaQuestion] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rateLimitedSeconds, setRateLimitedSeconds] = useState(0);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({ google: false, github: false });

  const [resetStep, setResetStep] = useState<ResetStep>('email');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetDevCode, setResetDevCode] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);

  const fetchCaptcha = useCallback(async () => {
    try {
      setError('');
      const res = await api.authGetCaptcha();
      setCaptchaId(res.id);
      setCaptchaQuestion(res.question);
      setCaptchaAnswer('');
    } catch (e) {
      setError(t('auth.captchaFetchFailed'));
    }
  }, [t]);

  useEffect(() => {
    api.authGetSettings().then((s) => setAllowRegister(s.allowRegister)).catch(() => setAllowRegister(true));
  }, []);

  useEffect(() => {
    api.oauthGetStatus().then(setOauthStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!allowRegister && tab === 'register') setTab('login');
  }, [allowRegister, tab]);

  useEffect(() => {
    fetchCaptcha();
  }, [fetchCaptcha, tab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'register') {
        const { userId } = await api.authRegister(email, password, captchaId, captchaAnswer);
        setUserId(userId);
        onLoggedIn();
      } else {
        const { userId } = await api.authLogin(email, password, captchaId, captchaAnswer);
        setUserId(userId);
        onLoggedIn();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('验证码')) {
        fetchCaptcha();
      }
      if (msg.includes('RATE_LIMITED') || msg.includes('分钟')) {
        setRateLimitedSeconds(15 * 60); // 锁定 15 分钟
        const t = setInterval(() => {
          setRateLimitedSeconds((s) => {
            if (s <= 1) {
              clearInterval(t);
              return 0;
            }
            return s - 1;
          });
        }, 1000);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestResetCode = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.authRequestPasswordReset(resetEmail);
      if (res.success) {
        setResetStep('code');
        if (res.code) setResetDevCode(res.code);
      } else {
        setResetStep('code');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    if (newPassword.length < 6) {
      setError(t('auth.passwordPlaceholderRegister'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.authResetPassword(resetEmail, resetCode, newPassword);
      if (res.success) {
        setResetSuccess(true);
        setTimeout(() => {
          setTab('login');
          setEmail(resetEmail);
          setResetStep('email');
          setResetCode('');
          setNewPassword('');
          setConfirmPassword('');
          setResetDevCode('');
          setResetSuccess(false);
        }, 2000);
      } else {
        setError(t('auth.resetFailed'));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = async (provider: 'google' | 'github') => {
    setError('');
    setLoading(true);
    try {
      const { authUrl } = provider === 'google'
        ? await api.oauthGetGoogleUrl()
        : await api.oauthGetGithubUrl();
      // 重定向到 OAuth 授权页，授权完成后会重定向到 /oauth-callback
      window.location.href = authUrl;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setLoading(false);
    }
  };

  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center"
      style={{
        background:
          'radial-gradient(ellipse at 50% 30%, rgba(15, 52, 96, 0.85) 0%, transparent 50%), ' +
          'radial-gradient(ellipse at 70% 70%, rgba(233, 69, 96, 0.08) 0%, transparent 40%), ' +
          'linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 50%, #0a0a1a 100%)',
      }}
    >
      <div className="flex flex-col items-center w-full max-w-md px-6">
        {/* 时间 */}
        <div className="text-center mb-10">
          <div className="text-6xl font-light text-white/95 tabular-nums tracking-wider">
            {time.toLocaleTimeString(i18n.language, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
          <div className="text-sm text-white/50 mt-2">
            {time.toLocaleDateString(i18n.language, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
        </div>

        {/* 头像占位 */}
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-desktop-highlight/80 to-purple-500/80 flex items-center justify-center shadow-2xl mb-6">
          <User size={36} className="text-white/90" />
        </div>

        {/* 标题 */}
        <h1 className="text-xl font-medium text-white/95 mb-6">
          {tab === 'forgot' ? t('auth.resetPassword') : tab === 'login' ? t('auth.loginTitle') : t('auth.createAccount')}
        </h1>

        {/* Tab 切换 */}
        {tab !== 'forgot' && allowRegister && (
        <div className="flex gap-4 mb-6">
          <button
            type="button"
            onClick={() => { setTab('login'); setError(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              tab === 'login' ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white/80'
            }`}
          >
            <ArrowRight size={16} /> {t('auth.login')}
          </button>
          <button
            type="button"
            onClick={() => { setTab('register'); setError(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              tab === 'register' ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white/80'
            }`}
          >
            <UserPlus size={16} /> {t('auth.register')}
          </button>
        </div>
        )}

        {tab === 'forgot' && (
          <button
            type="button"
            onClick={() => { setTab('login'); setError(''); setResetStep('email'); setResetSuccess(false); }}
            className="flex items-center gap-2 text-white/60 hover:text-white/80 transition-colors mb-6"
          >
            <ArrowLeft size={16} /> {t('auth.backToLogin')}
          </button>
        )}

        {/* 忘记密码表单 */}
        {tab === 'forgot' ? (
          <div className="w-full space-y-4">
            {resetSuccess ? (
              <div className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-center">
                {t('auth.resetSuccess')}
              </div>
            ) : resetStep === 'email' ? (
              <>
                <p className="text-white/50 text-sm text-center mb-2">{t('auth.resetPasswordDesc')}</p>
                <div className="flex items-center bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus-within:border-desktop-highlight/50 transition-colors">
                  <Mail size={16} className="text-white/50 mr-3 shrink-0" />
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder={t('auth.emailPlaceholder')}
                    className="flex-1 bg-transparent outline-none text-white placeholder:text-white/30"
                    autoComplete="email"
                  />
                </div>
                {error && (
                  <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2">{error}</div>
                )}
                <button
                  type="button"
                  onClick={handleRequestResetCode}
                  disabled={loading || !resetEmail}
                  className="w-full py-3 rounded-xl bg-desktop-highlight/30 hover:bg-desktop-highlight/50 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? <span className="animate-pulse">{t('auth.processing')}</span> : <>{t('auth.sendResetCode')} <ArrowRight size={18} /></>}
                </button>
              </>
            ) : (
              <>
                {resetDevCode && (
                  <div className="text-sm text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-2 text-center">
                    {t('auth.resetCodeSent')}：<span className="font-mono font-bold">{resetDevCode}</span>
                  </div>
                )}
                <div className="flex items-center bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus-within:border-desktop-highlight/50 transition-colors">
                  <KeyRound size={16} className="text-white/50 mr-3 shrink-0" />
                  <input
                    type="text"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ''))}
                    placeholder={t('auth.enterResetCode')}
                    className="flex-1 bg-transparent outline-none text-white placeholder:text-white/30"
                    maxLength={6}
                  />
                </div>
                <div className="flex items-center bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus-within:border-desktop-highlight/50 transition-colors">
                  <Lock size={16} className="text-white/50 mr-3 shrink-0" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t('auth.newPassword')}
                    className="flex-1 bg-transparent outline-none text-white placeholder:text-white/30"
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex items-center bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus-within:border-desktop-highlight/50 transition-colors">
                  <Lock size={16} className="text-white/50 mr-3 shrink-0" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t('auth.confirmNewPassword')}
                    className="flex-1 bg-transparent outline-none text-white placeholder:text-white/30"
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
                {error && (
                  <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2">{error}</div>
                )}
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={loading || !resetCode || !newPassword || !confirmPassword}
                  className="w-full py-3 rounded-xl bg-desktop-highlight/30 hover:bg-desktop-highlight/50 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? <span className="animate-pulse">{t('auth.processing')}</span> : <>{t('auth.resetPassword')} <ArrowRight size={18} /></>}
                </button>
              </>
            )}
          </div>
        ) : (
        /* 登录/注册表单 */
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="flex items-center bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus-within:border-desktop-highlight/50 transition-colors">
            <Mail size={16} className="text-white/50 mr-3 shrink-0" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              className="flex-1 bg-transparent outline-none text-white placeholder:text-white/30"
              required
              autoComplete="email"
            />
          </div>

          <div className="flex items-center bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus-within:border-desktop-highlight/50 transition-colors">
            <Lock size={16} className="text-white/50 mr-3 shrink-0" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tab === 'register' ? t('auth.passwordPlaceholderRegister') : t('auth.passwordPlaceholder')}
              className="flex-1 bg-transparent outline-none text-white placeholder:text-white/30"
              required
              minLength={tab === 'register' ? 6 : 1}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {/* 验证码 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus-within:border-desktop-highlight/50 transition-colors">
              <span className="text-white/60 text-sm mr-3 shrink-0">{captchaQuestion}</span>
              <input
                type="text"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value.replace(/\D/g, ''))}
                placeholder="?"
                className="flex-1 bg-transparent outline-none text-white placeholder:text-white/30 w-16"
                required
              />
            </div>
            <button
              type="button"
              onClick={fetchCaptcha}
              className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              title={t('auth.refreshCaptcha')}
            >
              <RefreshCw size={18} className="text-white/70" />
            </button>
          </div>

          {tab === 'login' && (
            <div className="text-right">
              <button
                type="button"
                onClick={() => { setTab('forgot'); setError(''); setResetEmail(email); }}
                className="text-sm text-white/40 hover:text-white/70 transition-colors"
              >
                {t('auth.forgotPassword')}
              </button>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2">
              {error}
            </div>
          )}

          {rateLimitedSeconds > 0 && (
            <div className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2">
              {t('auth.rateLimitedMsg', { minutes: Math.ceil(rateLimitedSeconds / 60) })}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || rateLimitedSeconds > 0}
            className="w-full py-3 rounded-xl bg-desktop-highlight/30 hover:bg-desktop-highlight/50 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="animate-pulse">{t('auth.processing')}</span>
            ) : (
              <>
                {tab === 'login' ? t('auth.login') : t('auth.register')}
                <ArrowRight size={18} />
              </>
            )}
          </button>

          {/* OAuth 分隔符 */}
          {(oauthStatus.google || oauthStatus.github) && (
            <>
              <div className="relative flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-[11px] text-white/30 uppercase tracking-wider">或</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <div className="flex gap-3">
                {oauthStatus.google && (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin('google')}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white/80 text-sm font-medium transition-colors"
                  >
                    <GoogleIcon />
                    Google
                  </button>
                )}
                {oauthStatus.github && (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin('github')}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white/80 text-sm font-medium transition-colors"
                  >
                    <GithubIcon />
                    GitHub
                  </button>
                )}
              </div>
            </>
          )}
        </form>
        )}

        <div className="text-[11px] text-white/30 mt-8">
          {t('auth.systemTagline')}
        </div>
      </div>
    </div>
  );
}
