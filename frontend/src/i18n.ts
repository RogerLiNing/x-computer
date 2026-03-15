/**
 * i18n 国际化配置
 * 支持中英文切换
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

i18n
  .use(LanguageDetector) // 自动检测浏览器语言
  .use(initReactI18next) // 集成 React
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
    },
    fallbackLng: 'en', // 默认语言
    interpolation: {
      escapeValue: false, // React 已经处理 XSS
    },
    detection: {
      // 语言检测顺序
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

export default i18n;
