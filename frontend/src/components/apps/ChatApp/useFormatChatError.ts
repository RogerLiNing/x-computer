import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/utils/api';

interface FormatChatErrorResult {
  content: string;
  quotaError: boolean;
}

/** 格式化 API 错误为展示内容；配额超限时返回 quotaError 以显示升级入口 */
export function useFormatChatError() {
  const { t } = useTranslation();
  return useCallback((err: unknown): FormatChatErrorResult => {
    if (err instanceof ApiError && (err.code === 'quota_exceeded' || err.status === 429)) {
      return { content: t('errors.quotaExceededFriendly'), quotaError: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('quota_exceeded') || msg.includes('quota')) {
      return { content: t('errors.quotaExceededFriendly'), quotaError: true };
    }
    return { content: msg, quotaError: false };
  }, [t]);
}
