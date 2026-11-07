import { getAdminEmails } from '../config/adminConfig.js';
import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';

/**
 * 谁可以配置并使用自己的模型密钥：
 * - everyone（默认）：任何已登录用户
 * - paid：仅专业版 / 企业版 / 管理员
 * 无法识别的值按 paid 处理，避免拼写错误时误放开。
 */
export const USER_LLM_POLICY_ENV = 'X_COMPUTER_USER_LLM_POLICY';
export type UserLLMPolicy = 'everyone' | 'paid';

const PAID_PLANS: readonly string[] = ['pro', 'enterprise'];

export function getUserLLMPolicy(): UserLLMPolicy {
  const raw = process.env[USER_LLM_POLICY_ENV]?.trim().toLowerCase();
  if (!raw || raw === 'everyone') return 'everyone';
  return 'paid';
}

export async function canConfigureUserLLM(
  userId: string,
  db: Pick<AppDatabase, 'getEmailByUserId'> | undefined,
  subscriptionService?: Pick<SubscriptionService, 'getUserSubscription'>,
): Promise<boolean> {
  if (!userId || userId === 'anonymous') return false;
  if (getUserLLMPolicy() === 'everyone' || !subscriptionService) return true;
  try {
    const admins = getAdminEmails();
    const email = admins.length ? await db?.getEmailByUserId?.(userId) : undefined;
    if (email && admins.includes(email.toLowerCase())) return true;
    const subscription = await subscriptionService.getUserSubscription(userId);
    return PAID_PLANS.includes(subscription?.planId ?? '');
  } catch {
    return false;
  }
}
