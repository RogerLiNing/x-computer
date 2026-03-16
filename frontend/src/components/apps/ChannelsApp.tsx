/**
 * 渠道管理：管理各种通信渠道配置
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Mail, Send } from 'lucide-react';
import { api } from '@/utils/api';
import { getUserId } from '@/utils/userId';
import { getCloudConfigSnapshot } from '@/utils/applyUserConfig';

interface Props {
  windowId: string;
}

type ChannelTab = 'email' | 'whatsapp' | 'qq' | 'telegram' | 'discord' | 'slack';

const CHANNEL_TABS: { id: ChannelTab; label: string }[] = [
  { id: 'email', label: '邮件' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'qq', label: 'QQ' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'discord', label: 'Discord' },
  { id: 'slack', label: 'Slack' },
];

// 邮件 SMTP 配置
const EMAIL_SMTP_CONFIG_KEY = 'email_smtp_config';

interface EmailSmtpConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/5">
      <div>
        <div className="text-xs font-medium text-desktop-text">{label}</div>
        <div className="text-[11px] text-desktop-muted mt-0.5">{description}</div>
      </div>
      {children}
    </div>
  );
}

function EmailSettings() {
  const userId = getUserId();
  const [host, setHost] = useState('smtp.qq.com');
  const [port, setPort] = useState(465);
  const [secure, setSecure] = useState(true);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const load = useCallback(() => {
    const snapshot = getCloudConfigSnapshot();
    const v = snapshot?.[EMAIL_SMTP_CONFIG_KEY] as EmailSmtpConfig | undefined;
    if (v && typeof v === 'object') {
      setHost(v.host ?? 'smtp.qq.com');
      setPort(typeof v.port === 'number' ? v.port : 465);
      setSecure(v.secure !== false);
      setUser(v.user ?? '');
      setPass(v.pass ?? '');
      setFrom(v.from ?? '');
    }
    setLoading(true);
    setError(null);
    api
      .getUserConfigKey(EMAIL_SMTP_CONFIG_KEY)
      .then((res) => {
        const val = res?.value as EmailSmtpConfig | undefined;
        if (val && typeof val === 'object') {
          setHost(val.host ?? 'smtp.qq.com');
          setPort(typeof val.port === 'number' ? val.port : 465);
          setSecure(val.secure !== false);
          setUser(val.user ?? '');
          setPass(val.pass ?? '');
          setFrom(val.from ?? '');
        }
      })
      .catch(() => {
        setHost('smtp.qq.com');
        setPort(465);
        setSecure(true);
        setUser('');
        setPass('');
        setFrom('');
      })
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isFirstMount.current || loading) {
      if (!loading) isFirstMount.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true);
      setError(null);
      setSaveMessage(null);
      api.setUserConfigKey(EMAIL_SMTP_CONFIG_KEY, {
        host: host.trim() || undefined,
        port: port || 465,
        secure,
        user: user.trim() || undefined,
        pass: pass ? pass : undefined,
        from: from.trim() || undefined,
      })
        .then(() => {
          setSaveMessage('ok');
          setTimeout(() => setSaveMessage(null), 2500);
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '同步失败');
          setSaveMessage('fail');
        })
        .finally(() => setSaveLoading(false));
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [host, port, secure, user, pass, from, loading]);

  if (loading) {
    return <div className="text-xs text-desktop-muted py-4">加载中…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-xs font-medium text-desktop-text">SMTP 发信</h4>
        {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
        {saveMessage === 'fail' && <span className="text-xs text-amber-400/90">同步失败</span>}
      </div>
      <p className="text-xs text-desktop-muted">
        配置 SMTP 后，X 可通过邮件工具向您发送邮件。QQ 邮箱：host 填 smtp.qq.com，port 填 465（SSL），user 为完整邮箱，pass 为授权码。
      </p>
      {error && <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-2">
        <SettingRow label="SMTP Host" description="如 smtp.qq.com">
          <input
            type="text"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </SettingRow>
        <SettingRow label="端口" description="465（SSL）或 587（TLS）">
          <input
            type="number"
            className="w-24 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value, 10) || 465)}
          />
        </SettingRow>
        <SettingRow label="使用 SSL" description="465 端口一般为 true">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={secure}
              onChange={(e) => setSecure(e.target.checked)}
              className="rounded border-white/20 bg-white/5 text-desktop-accent"
            />
            <span className="text-xs text-desktop-text">启用</span>
          </label>
        </SettingRow>
        <SettingRow label="邮箱账号" description="如 xxx@qq.com">
          <input
            type="email"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </SettingRow>
        <SettingRow label="授权码" description="在邮箱设置中生成">
          <input
            type="password"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </SettingRow>
      </div>
    </div>
  );
}

// 渠道设置组件（简化版）
function ChannelSettings({ type }: { type: Exclude<ChannelTab, 'email'> }) {
  const configKey = `channel_${type}_config`;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.getUserConfigKey(configKey)
      .then((res) => {
        if (res?.value && typeof res.value === 'object') {
          setConfig(res.value as Record<string, string>);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [configKey]);

  useEffect(() => {
    if (loading) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSaving(true);
      api.setUserConfigKey(configKey, config)
        .then(() => {
          setSaveMessage('ok');
          setTimeout(() => setSaveMessage(null), 2500);
        })
        .catch(() => setSaveMessage('fail'))
        .finally(() => setSaving(false));
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [config, configKey, loading]);

  const updateConfig = (key: string, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const getFields = () => {
    switch (type) {
      case 'whatsapp':
        return [
          { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: 'WhatsApp Business Phone Number ID' },
          { key: 'accessToken', label: 'Access Token', placeholder: 'Facebook Developer Access Token' },
          { key: 'verifyToken', label: 'Verify Token', placeholder: 'Webhook 验证令牌' },
        ];
      case 'qq':
        return [
          { key: 'botId', label: 'Bot ID', placeholder: 'QQ Bot ID' },
          { key: 'token', label: 'Token', placeholder: 'QQ Bot Token' },
          { key: 'secret', label: 'Secret', placeholder: 'QQ Bot Secret' },
        ];
      case 'telegram':
        return [
          { key: 'botToken', label: 'Bot Token', placeholder: 'Telegram Bot Token' },
          { key: 'chatId', label: 'Chat ID', placeholder: '接收消息的 Chat ID' },
        ];
      case 'discord':
        return [
          { key: 'botToken', label: 'Bot Token', placeholder: 'Discord Bot Token' },
          { key: 'channelId', label: 'Channel ID', placeholder: 'Discord Channel ID' },
        ];
      case 'slack':
        return [
          { key: 'botToken', label: 'Bot Token', placeholder: 'xoxb-...' },
          { key: 'signingSecret', label: 'Signing Secret', placeholder: 'Slack Signing Secret' },
          { key: 'channelId', label: 'Channel ID', placeholder: 'Channel ID' },
        ];
      default:
        return [];
    }
  };

  if (loading) {
    return <div className="text-xs text-desktop-muted py-4">加载中…</div>;
  }

  const fields = getFields();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-xs font-medium text-desktop-text">{CHANNEL_TABS.find(t => t.id === type)?.label} 配置</h4>
        {saving && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
        {saveMessage === 'fail' && <span className="text-xs text-amber-400/90">同步失败</span>}
      </div>
      <p className="text-xs text-desktop-muted">配置 {CHANNEL_TABS.find(t => t.id === type)?.label} 后，X 可以通过该渠道与您通信。修改后自动保存。</p>
      <div className="space-y-3">
        {fields.map(field => (
          <div key={field.key}>
            <label className="block text-xs text-desktop-muted mb-1">{field.label}</label>
            <input
              type="password"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent"
              placeholder={field.placeholder}
              value={config[field.key] || ''}
              onChange={(e) => updateConfig(field.key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChannelsApp({ windowId }: Props) {
  const [channelTab, setChannelTab] = useState<ChannelTab>('email');

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <MessageSquare size={16} />
        <h2 className="text-sm font-medium text-desktop-text">渠道</h2>
      </div>

      <div className="flex gap-1 border-b border-white/10 pb-px overflow-x-auto mb-4 shrink-0">
        {CHANNEL_TABS.map((ct) => (
          <button
            key={ct.id}
            type="button"
            className={`px-3 py-1.5 text-xs rounded-t-lg transition-colors whitespace-nowrap ${
              channelTab === ct.id
                ? 'bg-white/10 text-desktop-text border-b-2 border-desktop-accent'
                : 'text-desktop-muted hover:text-desktop-text hover:bg-white/5'
            }`}
            onClick={() => setChannelTab(ct.id)}
          >
            {ct.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {channelTab === 'email' && <EmailSettings />}
        {channelTab === 'whatsapp' && <ChannelSettings type="whatsapp" />}
        {channelTab === 'qq' && <ChannelSettings type="qq" />}
        {channelTab === 'telegram' && <ChannelSettings type="telegram" />}
        {channelTab === 'discord' && <ChannelSettings type="discord" />}
        {channelTab === 'slack' && <ChannelSettings type="slack" />}
      </div>
    </div>
  );
}
