# X-Computer 商业化快速开始指南

**目标受众**：开发者  
**预计时间**：第一阶段 2-3 周

---

## 📋 前置准备

### 1. 账号注册

- [ ] **Stripe 账号**：https://stripe.com （支付处理）
- [ ] **Vercel/Netlify 账号**：首页部署
- [ ] **域名**：购买域名（如 x-computer.ai）
- [ ] **邮件服务**：SendGrid 或使用现有 SMTP

### 2. 开发环境

- [ ] Node.js 22+
- [ ] 数据库工具（SQLite Browser 或 MySQL Workbench）
- [ ] Git

---

## 🚀 第一阶段：核心功能（P0 优先级）

### Week 1: 国际化 + 数据库设计

#### Day 1-2: 前端国际化（R054）

```bash
# 1. 安装依赖
cd frontend
npm install react-i18next i18next i18next-browser-languagedetector

# 2. 创建语言包目录
mkdir -p src/locales
```

**创建文件**：
- `frontend/src/locales/en.json` - 英文翻译
- `frontend/src/locales/zh-CN.json` - 中文翻译
- `frontend/src/i18n.ts` - i18n 配置

**关键代码**：

```typescript
// frontend/src/i18n.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
```

**使用示例**：

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t, i18n } = useTranslation();
  
  return (
    <div>
      <h1>{t('welcome')}</h1>
      <button onClick={() => i18n.changeLanguage('zh-CN')}>
        中文
      </button>
    </div>
  );
}
```

#### Day 3-4: 后端提示词国际化

```bash
cd server/src/prompts/systemCore
```

**创建文件**：
- `corePrompt.en.ts` - 英文提示词
- `corePrompt.zh-CN.ts` - 中文提示词
- `promptLoader.ts` - 动态加载器

**关键代码**：

```typescript
// server/src/prompts/systemCore/promptLoader.ts
export function getCorePrompt(language: 'en' | 'zh-CN' = 'en'): string {
  if (language === 'zh-CN') {
    return import('./corePrompt.zh-CN.js').then(m => m.CORE_SYSTEM_PROMPT);
  }
  return import('./corePrompt.en.js').then(m => m.CORE_SYSTEM_PROMPT);
}
```

#### Day 5: 数据库设计（R057）

**创建迁移文件**：

```bash
cd server
mkdir -p migrations
```

**文件**：`server/migrations/001_add_subscriptions.sql`

```sql
-- 订阅表
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- 配额使用表
CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_usage_records_user_period ON usage_records(user_id, period_start, period_end);

-- 套餐定义表
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name_en TEXT NOT NULL,
  display_name_zh TEXT NOT NULL,
  price_monthly INTEGER,
  price_yearly INTEGER,
  ai_calls_limit INTEGER,
  storage_limit INTEGER,
  concurrent_tasks_limit INTEGER,
  features TEXT,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- 插入默认套餐
INSERT INTO plans (id, name, display_name_en, display_name_zh, price_monthly, price_yearly, ai_calls_limit, storage_limit, concurrent_tasks_limit, features, created_at) VALUES
('trial', 'trial', 'Free Trial', '免费试用', 0, 0, 100, 104857600, 1, '["basic_features"]', strftime('%s', 'now') * 1000),
('personal', 'personal', 'Personal', '个人版', 999, 9990, 1000, 1073741824, 3, '["all_features"]', strftime('%s', 'now') * 1000),
('pro', 'pro', 'Professional', '专业版', 2999, 29990, 5000, 10737418240, 10, '["all_features","priority_support"]', strftime('%s', 'now') * 1000);
```

**运行迁移**：

```typescript
// server/src/db/migrate.ts
import fs from 'fs/promises';
import path from 'path';
import { db } from './database.js';

export async function runMigrations() {
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const files = await fs.readdir(migrationsDir);
  
  for (const file of files.sort()) {
    if (file.endsWith('.sql')) {
      console.log(`Running migration: ${file}`);
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf-8');
      db.exec(sql);
    }
  }
}
```

### Week 2: Stripe 集成 + 配额管理

#### Day 1-3: Stripe 支付集成（R057）

```bash
cd server
npm install stripe
```

**创建文件**：`server/src/payment/stripeService.ts`

```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
});

export class StripeService {
  // 创建客户
  async createCustomer(userId: string, email: string) {
    return stripe.customers.create({
      email,
      metadata: { userId },
    });
  }

  // 创建订阅
  async createSubscription(customerId: string, priceId: string) {
    return stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });
  }

  // 取消订阅
  async cancelSubscription(subscriptionId: string) {
    return stripe.subscriptions.cancel(subscriptionId);
  }

  // Webhook 处理
  async handleWebhook(payload: Buffer, signature: string) {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        // 更新数据库订阅状态
        break;
      case 'customer.subscription.deleted':
        // 标记订阅为已取消
        break;
      case 'invoice.payment_succeeded':
        // 记录支付成功
        break;
      case 'invoice.payment_failed':
        // 处理支付失败
        break;
    }
  }
}
```

**API 路由**：`server/src/routes/subscription.ts`

```typescript
import express from 'express';
import { StripeService } from '../payment/stripeService.js';

const router = express.Router();
const stripeService = new StripeService();

// 创建订阅
router.post('/subscriptions', async (req, res) => {
  const { userId } = req;
  const { planId } = req.body;
  
  // 1. 获取或创建 Stripe 客户
  // 2. 创建订阅
  // 3. 保存到数据库
  // 4. 返回 clientSecret 给前端
});

// Stripe Webhook
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'] as string;
  await stripeService.handleWebhook(req.body, signature);
  res.json({ received: true });
});

export default router;
```

#### Day 4-5: 配额管理中间件

**创建文件**：`server/src/middleware/quotaCheck.ts`

```typescript
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/database.js';

export interface QuotaLimits {
  aiCallsLimit: number;
  storageLimit: number;
  concurrentTasksLimit: number;
}

export async function getQuotaLimits(userId: string): Promise<QuotaLimits> {
  const subscription = db.prepare(`
    SELECT p.* FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.user_id = ? AND s.status = 'active'
    ORDER BY s.created_at DESC LIMIT 1
  `).get(userId);

  if (!subscription) {
    // 返回试用套餐限制
    return { aiCallsLimit: 100, storageLimit: 100 * 1024 * 1024, concurrentTasksLimit: 1 };
  }

  return {
    aiCallsLimit: subscription.ai_calls_limit,
    storageLimit: subscription.storage_limit,
    concurrentTasksLimit: subscription.concurrent_tasks_limit,
  };
}

export async function checkQuota(userId: string, resourceType: 'ai_calls' | 'storage' | 'tasks'): Promise<boolean> {
  const limits = await getQuotaLimits(userId);
  const now = Date.now();
  const periodStart = new Date(now).setDate(1); // 本月1号

  const usage = db.prepare(`
    SELECT SUM(amount) as total FROM usage_records
    WHERE user_id = ? AND resource_type = ? AND period_start >= ?
  `).get(userId, resourceType, periodStart);

  const currentUsage = usage?.total || 0;

  switch (resourceType) {
    case 'ai_calls':
      return currentUsage < limits.aiCallsLimit;
    case 'storage':
      return currentUsage < limits.storageLimit;
    case 'tasks':
      return currentUsage < limits.concurrentTasksLimit;
  }
}

export function quotaMiddleware(resourceType: 'ai_calls' | 'storage' | 'tasks') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = req;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const hasQuota = await checkQuota(userId, resourceType);
    if (!hasQuota) {
      return res.status(402).json({
        error: 'Quota exceeded',
        message: 'Please upgrade your plan to continue',
        upgradeUrl: '/settings/subscription',
      });
    }

    next();
  };
}

// 记录使用量
export async function recordUsage(userId: string, resourceType: string, amount: number) {
  const now = Date.now();
  const periodStart = new Date(now).setDate(1);
  const periodEnd = new Date(periodStart).setMonth(new Date(periodStart).getMonth() + 1);

  db.prepare(`
    INSERT INTO usage_records (id, user_id, resource_type, amount, period_start, period_end, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `usage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId,
    resourceType,
    amount,
    periodStart,
    periodEnd,
    now
  );
}
```

**使用示例**：

```typescript
// 在 AI 调用的路由中
router.post('/chat/send', quotaMiddleware('ai_calls'), async (req, res) => {
  // 处理聊天请求
  await recordUsage(req.userId, 'ai_calls', 1);
  // ...
});
```

### Week 3: 营销首页

#### Day 1-5: 首页开发（R055）

**方案**：使用 Next.js 独立项目

```bash
# 创建新项目
npx create-next-app@latest landing --typescript --tailwind --app
cd landing
```

**目录结构**：

```
landing/
├── app/
│   ├── layout.tsx
│   ├── page.tsx          # 首页
│   └── pricing/
│       └── page.tsx      # 定价页
├── components/
│   ├── Hero.tsx
│   ├── Features.tsx
│   ├── Pricing.tsx
│   └── Footer.tsx
├── public/
│   └── images/
└── messages/
    ├── en.json
    └── zh-CN.json
```

**Hero Section 示例**：

```typescript
// components/Hero.tsx
export function Hero() {
  return (
    <section className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-900 to-black text-white">
      <div className="max-w-6xl mx-auto px-4 text-center">
        <h1 className="text-6xl font-bold mb-6">
          AI-Powered Autonomous Computer System
        </h1>
        <p className="text-2xl text-gray-300 mb-12">
          让 AI 主脑自主运行、学习进化，为你完成任何任务
        </p>
        <div className="flex gap-4 justify-center">
          <a href="/signup" className="bg-blue-600 hover:bg-blue-700 px-8 py-4 rounded-lg text-xl font-semibold">
            Start Free Trial
          </a>
          <a href="#demo" className="border border-white hover:bg-white hover:text-black px-8 py-4 rounded-lg text-xl font-semibold">
            Watch Demo
          </a>
        </div>
      </div>
    </section>
  );
}
```

**部署到 Vercel**：

```bash
# 1. 推送到 GitHub
git init
git add .
git commit -m "Initial landing page"
git remote add origin <your-repo-url>
git push -u origin main

# 2. 在 Vercel 导入项目
# 3. 配置自定义域名
```

---

## 🎯 第二阶段：用户体验（P1 优先级）

### Week 4: 用户仪表板（R058）

#### 订阅管理界面

**创建应用**：`frontend/src/apps/AccountApp.tsx`

```typescript
import { useTranslation } from 'react-i18next';

export function AccountApp() {
  const { t } = useTranslation();
  const [subscription, setSubscription] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    fetch('/api/users/me/subscription')
      .then(res => res.json())
      .then(setSubscription);
    
    fetch('/api/users/me/usage')
      .then(res => res.json())
      .then(setUsage);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">{t('account.title')}</h1>
      
      {/* 当前套餐 */}
      <section className="mb-8">
        <h2 className="text-xl mb-4">{t('account.subscription')}</h2>
        <div className="bg-gray-800 p-4 rounded-lg">
          <p>Plan: {subscription?.plan_id}</p>
          <p>Status: {subscription?.status}</p>
          <p>Renews: {new Date(subscription?.current_period_end).toLocaleDateString()}</p>
          <button className="mt-4 bg-blue-600 px-4 py-2 rounded">
            {t('account.upgrade')}
          </button>
        </div>
      </section>

      {/* 使用统计 */}
      <section>
        <h2 className="text-xl mb-4">{t('account.usage')}</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-800 p-4 rounded-lg">
            <p className="text-gray-400">AI Calls</p>
            <p className="text-3xl font-bold">{usage?.aiCalls} / {usage?.aiCallsLimit}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg">
            <p className="text-gray-400">Storage</p>
            <p className="text-3xl font-bold">{formatBytes(usage?.storage)} / {formatBytes(usage?.storageLimit)}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg">
            <p className="text-gray-400">Tasks</p>
            <p className="text-3xl font-bold">{usage?.tasks} / {usage?.tasksLimit}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
```

---

## ✅ 检查清单

### 开发完成检查

- [ ] 前端所有文本已翻译（中英文）
- [ ] 后端提示词支持多语言
- [ ] 数据库迁移已运行
- [ ] Stripe 测试模式可正常支付
- [ ] 配额限制正常工作
- [ ] 首页在手机/平板/桌面正常显示
- [ ] 用户仪表板显示订阅和使用情况
- [ ] 所有 API 有错误处理

### 上线前检查

- [ ] 域名已购买并配置 DNS
- [ ] SSL 证书已配置
- [ ] Stripe 切换到生产模式
- [ ] 环境变量已配置（生产环境）
- [ ] 数据库已备份
- [ ] 监控告警已配置
- [ ] 隐私政策和服务条款已上线
- [ ] 邮件模板已测试
- [ ] 支付流程端到端测试通过

---

## 📚 参考资源

### 文档

- [Stripe 文档](https://stripe.com/docs)
- [react-i18next 文档](https://react.i18next.com/)
- [Next.js 文档](https://nextjs.org/docs)

### 代码示例

- Stripe 订阅示例：https://github.com/stripe-samples/subscription-use-cases
- i18n 最佳实践：https://locize.com/blog/react-i18next/

### 设计灵感

- [Cursor 首页](https://cursor.sh)
- [Replit 首页](https://replit.com)
- [Vercel 首页](https://vercel.com)

---

## 🆘 常见问题

### Q: Stripe webhook 本地测试怎么做？

A: 使用 Stripe CLI：

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

### Q: 如何测试不同套餐的配额限制？

A: 在数据库中手动修改用户的订阅：

```sql
UPDATE subscriptions SET plan_id = 'pro' WHERE user_id = 'xxx';
```

### Q: 首页如何支持多语言？

A: 使用 Next.js 的 i18n 路由：

```typescript
// next.config.js
module.exports = {
  i18n: {
    locales: ['en', 'zh-CN'],
    defaultLocale: 'en',
  },
};
```

---

**下一步**：开始第一阶段开发！建议按照本指南的顺序逐步实施。
