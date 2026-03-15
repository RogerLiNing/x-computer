/**
 * 配额管理中间件
 * 检查用户配额并记录使用量
 */

import type { Request, Response, NextFunction } from 'express';
import type { SubscriptionService } from './SubscriptionService.js';
import { serverLogger } from '../observability/ServerLogger.js';

export interface QuotaMiddlewareOptions {
  resourceType: 'ai_calls' | 'storage' | 'tasks';
  amount?: number;  // 默认为 1
  skipQuotaCheck?: boolean;  // 是否跳过配额检查（仅记录）
}

/**
 * 创建配额检查中间件
 */
export function createQuotaMiddleware(
  subscriptionService: SubscriptionService,
  options: QuotaMiddlewareOptions
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId;
    
    if (!userId || userId === 'anonymous') {
      // 匿名用户或未登录用户，跳过配额检查
      return next();
    }

    const { resourceType, amount = 1, skipQuotaCheck = false } = options;

    try {
      if (!skipQuotaCheck) {
        const hasQuota = await subscriptionService.checkQuota(userId, resourceType);
        
        if (!hasQuota) {
          const limits = await subscriptionService.getQuotaLimits(userId);
          const usage = await subscriptionService.getCurrentUsage(userId);
          
          serverLogger.warn('quota/exceeded', `配额已用尽`, `userId=${userId} type=${resourceType} usage=${JSON.stringify(usage)} limits=${JSON.stringify(limits)}`);
          
          return res.status(429).json({
            error: 'quota_exceeded',
            message: 'You have exceeded your quota limit. Please upgrade your plan.',
            resourceType,
            limits,
            usage,
          });
        }
      }

      if (amount > 0) {
        try {
          await subscriptionService.recordUsage(userId, resourceType, amount, {
            endpoint: req.path,
            method: req.method,
            timestamp: Date.now(),
          });
          serverLogger.info('quota/record', `记录使用量`, `userId=${userId} type=${resourceType} amount=${amount}`);
        } catch (err) {
          serverLogger.error('quota/record', `记录使用量失败`, `error=${err instanceof Error ? err.message : String(err)}`);
        }
      }

      next();
    } catch (err) {
      serverLogger.error('quota/middleware', `配额中间件错误`, `error=${err instanceof Error ? err.message : String(err)}`);
      // 配额检查失败时，不阻止请求，但记录错误
      next();
    }
  };
}

/**
 * AI 调用配额中间件
 * 每次 HTTP 请求计 1 次（不论请求内有多少轮 LLM 调用），任务创建也计 1 次。
 */
export function aiCallsQuota(subscriptionService: SubscriptionService) {
  return createQuotaMiddleware(subscriptionService, {
    resourceType: 'ai_calls',
    amount: 1,
  });
}

/**
 * 任务配额中间件
 * 注意：并发任务数不记录到 usage_records，而是通过检查 tasks 表中的运行状态
 */
export function tasksQuota(subscriptionService: SubscriptionService) {
  return createQuotaMiddleware(subscriptionService, {
    resourceType: 'tasks',
    amount: 0,  // 不记录使用量，只检查配额
    skipQuotaCheck: false,  // 需要检查配额
  });
}

/**
 * API 请求配额中间件（仅记录，不限制）
 * 注：暂时使用 ai_calls 类型，未来可扩展
 */
export function apiRequestsQuota(subscriptionService: SubscriptionService) {
  return createQuotaMiddleware(subscriptionService, {
    resourceType: 'ai_calls',  // 暂时使用 ai_calls，未来可扩展
    amount: 0,  // 不记录使用量
    skipQuotaCheck: true,  // 不限制 API 请求
  });
}
