import { getAdminEmails } from '../config/adminConfig.js';
import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';

export async function canConfigureUserLLM(
  userId: string,
  db: Pick<AppDatabase, 'getEmailByUserId'> | undefined,
  subscriptionService?: Pick<SubscriptionService, 'getUserSubscription'>,
): Promise<boolean> {
  if (!subscriptionService) return true;
  try {
    const admins = getAdminEmails();
    const email = admins.length ? await db?.getEmailByUserId?.(userId) : undefined;
    if (email && admins.includes(email.toLowerCase())) return true;
    const subscription = await subscriptionService.getUserSubscription(userId);
    return subscription?.planId === 'pro' || subscription?.planId === 'enterprise';
  } catch {
    return false;
  }
}
