/**
 * 提示词加载器
 * 根据用户语言偏好动态加载对应的系统提示词
 */

import { CORE_SYSTEM_PROMPT, WELCOME_MESSAGE } from './corePrompt.js';
import { CORE_SYSTEM_PROMPT_EN, WELCOME_MESSAGE_EN } from './corePrompt.en.js';
import type { AppDatabase } from '../../db/database.js';

export type SupportedLanguage = 'en' | 'zh-CN';

/**
 * 获取用户偏好的语言
 * @param db 数据库实例
 * @param userId 用户 ID
 * @returns 语言代码
 */
export async function getUserLanguage(db: AppDatabase, userId: string): Promise<SupportedLanguage> {
  try {
    const value = await db.getConfig(userId, 'preferredLanguage');
    if (value === 'en' || value === 'zh-CN') {
      return value as SupportedLanguage;
    }
  } catch (error) {
    console.error('Failed to get user language:', error);
  }
  
  // 默认返回中文
  return 'zh-CN';
}

/**
 * 根据语言获取核心系统提示词
 * @param language 语言代码
 * @returns 系统提示词
 */
export function getCorePrompt(language: SupportedLanguage = 'zh-CN'): string {
  if (language === 'en') {
    return CORE_SYSTEM_PROMPT_EN;
  }
  return CORE_SYSTEM_PROMPT;
}

/** 根据语言获取欢迎语 */
export function getWelcomeMessage(language: SupportedLanguage = 'zh-CN'): string {
  return language === 'en' ? WELCOME_MESSAGE_EN : WELCOME_MESSAGE;
}

/**
 * 根据用户 ID 获取适合的系统提示词
 * @param db 数据库实例
 * @param userId 用户 ID
 * @returns 系统提示词
 */
export async function getCorePromptForUser(db: AppDatabase, userId: string): Promise<string> {
  const language = await getUserLanguage(db, userId);
  return getCorePrompt(language);
}
