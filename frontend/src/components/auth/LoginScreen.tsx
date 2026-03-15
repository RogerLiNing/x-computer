/**
 * Mac 风格登录页：进入系统前必须登录，含注册、验证码、错误提示。
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Lock, Mail, RefreshCw, ArrowRight, UserPlus, KeyRound, ArrowLeft } from 'lucide-react';
import { api } from '@/utils/api';
import { setUserId } from '@/utils/userId';

type Tab = 'login' | 'register' | 'forgot';
type ResetStep = 'email' | 'code';

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
        </form>
        )}

        <div className="text-[11px] text-white/30 mt-8">
          {t('auth.systemTagline')}
        </div>
      </div>
    </div>
  );
}
