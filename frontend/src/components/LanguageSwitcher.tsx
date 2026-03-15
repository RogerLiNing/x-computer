/**
 * 语言切换器组件
 * 支持中英文切换
 */

import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

interface LanguageSwitcherProps {
  className?: string;
  showLabel?: boolean;
}

export function LanguageSwitcher({ className = '', showLabel = true }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();

  const languages = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'zh-CN', name: 'Chinese', nativeName: '简体中文' },
  ];

  const currentLanguage = languages.find(lang => lang.code === i18n.language) || languages[0];

  const handleLanguageChange = async (langCode: string) => {
    i18n.changeLanguage(langCode);
    // 保存到 localStorage（i18next-browser-languagedetector 会自动处理）
    localStorage.setItem('preferredLanguage', langCode);
    
    // 同时保存到用户配置（云端同步）
    try {
      await fetch('/api/users/me/config/preferredLanguage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: langCode }),
      });
    } catch (error) {
      console.error('Failed to save language preference:', error);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {showLabel && (
        <label className="text-sm text-gray-400 flex items-center gap-1">
          <Globe className="w-4 h-4" />
          {t('common.language')}
        </label>
      )}
      <select
        value={i18n.language}
        onChange={(e) => handleLanguageChange(e.target.value)}
        className="bg-gray-800 text-white px-3 py-1.5 rounded border border-gray-700 hover:border-gray-600 focus:border-blue-500 focus:outline-none text-sm"
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
