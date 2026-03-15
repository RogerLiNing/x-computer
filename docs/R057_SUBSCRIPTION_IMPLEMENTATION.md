# R057 付费订阅系统实现文档

**需求编号**: R057  
**优先级**: P0  
**状态**: 已完成  
**完成日期**: 2026-02-28

## 概述

X-Computer 付费订阅系统已完成开发，支持多套餐订阅、配额管理、Stripe 支付集成、使用量追踪等核心功能。

## 架构设计

### 1. 数据库设计

#### 1.1 套餐表 (plans)
```sql
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name_en TEXT NOT NULL,
  display_name_zh TEXT NOT NULL,
  description_en TEXT,
  description_zh TEXT,
  price_monthly INTEGER,          -- 月付价格（美分）
  price_yearly INTEGER,            -- 年付价格（美分）
  ai_calls_limit INTEGER NOT NULL DEFAULT 100,
  storage_limit INTEGER NOT NULL DEFAULT 104857600,  -- 100MB
  concurrent_tasks_limit INTEGER NOT NULL DEFAULT 1,
  features TEXT,                   -- JSON array
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**默认套餐**:
- **trial**: 免费试用 (100 AI calls, 100MB storage, 1 concurrent task)
- **personal**: 个人版 ($9.99/月, $99.90/年)
- **pro**: 专业版 ($29.99/月, $299.90/年)
- **enterprise**: 企业版 (联系销售)

#### 1.2 订阅表 (subscriptions)
```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active, canceled, expired, past_due, trialing
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  trial_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  stripe_price_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);
```

#### 1.3 使用量记录表 (usage_records)
```sql
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,     -- ai_calls, storage, tasks, api_requests
  amount INTEGER NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  metadata TEXT,                   -- JSON
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### 1.4 支付历史表 (payment_history)
```sql
CREATE TABLE payment_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL,            -- succeeded, pending, failed, refunded
  stripe_payment_intent_id TEXT,
  stripe_invoice_id TEXT,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### 2. 后端实现

#### 2.1 订阅服务 (SubscriptionService)

**位置**: `server/src/subscription/SubscriptionService.ts`

**核心方法**:
- `getPlans()`: 获取所有可用套餐
- `getUserSubscription(userId)`: 获取用户当前订阅
- `getQuotaLimits(userId)`: 获取用户配额限制
- `getCurrentUsage(userId)`: 获取用户当前周期使用量
- `checkQuota(userId, resourceType)`: 检查用户是否有足够配额
- `recordUsage(userId, resourceType, amount, metadata)`: 记录使用量
- `createSubscription(...)`: 创建订阅
- `updateSubscriptionStatus(...)`: 更新订阅状态
- `cancelSubscription(...)`: 取消订阅
- `getUsageHistory(userId, limit)`: 获取使用历史

#### 2.2 Stripe 支付服务 (StripePaymentService)

**位置**: `server/src/subscription/stripeService.ts`

**核心方法**:
- `createCheckoutSession(...)`: 创建 Stripe Checkout Session
- `handleWebhook(payload, signature)`: 处理 Stripe Webhook 事件
- `cancelSubscription(stripeSubscriptionId)`: 取消订阅
- `reactivateSubscription(stripeSubscriptionId)`: 重新激活订阅

**支持的 Webhook 事件**:
- `checkout.session.completed`: Checkout 完成
- `customer.subscription.created/updated`: 订阅创建/更新
- `customer.subscription.deleted`: 订阅删除
- `invoice.payment_succeeded`: 支付成功
- `invoice.payment_failed`: 支付失败

#### 2.3 配额管理中间件

**位置**: `server/src/subscription/quotaMiddleware.ts`

**中间件函数**:
- `createQuotaMiddleware(subscriptionService, options)`: 通用配额中间件
- `aiCallsQuota(subscriptionService)`: AI 调用配额中间件
- `tasksQuota(subscriptionService)`: 任务配额中间件
- `apiRequestsQuota(subscriptionService)`: API 请求配额中间件（仅记录）

**使用示例**:
```typescript
app.post('/api/chat', aiCallsQuota(subscriptionService), (req, res) => {
  // 处理 AI 聊天请求
});
```

#### 2.4 API 路由

**位置**: `server/src/routes/subscriptionRoutes.ts`

**端点**:
- `GET /api/subscriptions/plans`: 获取所有套餐
- `GET /api/subscriptions/me`: 获取当前用户订阅信息
- `GET /api/subscriptions/me/usage`: 获取使用历史
- `POST /api/subscriptions/me/cancel`: 取消订阅
- `POST /api/subscriptions/me/reactivate`: 重新激活订阅
- `POST /api/subscriptions/checkout`: 创建 Stripe Checkout Session
- `POST /api/subscriptions/webhook`: Stripe Webhook 端点

#### 2.5 数据库迁移

**位置**: 
- `server/migrations/001_add_subscriptions.sql`: 迁移 SQL
- `server/src/db/migrate.ts`: 迁移运行器

**自动运行**: 服务器启动时自动运行待应用的迁移

### 3. 前端实现

#### 3.1 订阅管理应用

**位置**: `frontend/src/components/apps/SubscriptionApp.tsx`

**功能**:
- 显示当前订阅状态（套餐、状态、计费周期、下次续费日期）
- 实时显示使用量（AI 调用、存储、并发任务）
- 套餐列表展示（支持月付/年付切换）
- 升级/降级套餐
- 取消/重新激活订阅
- 跳转到 Stripe Checkout 进行支付

**国际化**: 完整支持中英文切换

#### 3.2 应用注册

**更新文件**:
- `shared/src/index.ts`: 添加 `subscription` 到 `BuiltinAppId`
- `frontend/src/appRegistry.ts`: 注册订阅应用
- `frontend/src/components/apps/AppContent.tsx`: 添加路由
- `frontend/src/locales/en.json`: 英文翻译
- `frontend/src/locales/zh-CN.json`: 中文翻译

## 环境变量配置

在 `.env` 文件中添加以下配置：

```bash
# Stripe 配置（可选）
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# Stripe Price IDs
STRIPE_PRICE_PERSONAL_MONTHLY=price_xxxxx
STRIPE_PRICE_PERSONAL_YEARLY=price_xxxxx
STRIPE_PRICE_PRO_MONTHLY=price_xxxxx
STRIPE_PRICE_PRO_YEARLY=price_xxxxx

# 前端 URL（用于 Stripe Checkout 回调）
FRONTEND_URL=http://localhost:3000
```

## 使用流程

### 1. 用户注册
- 新用户注册后自动创建 7 天免费试用订阅（trial 套餐）
- 试用期内享有 100 次 AI 调用、100MB 存储、1 个并发任务

### 2. 升级套餐
1. 用户打开订阅管理应用
2. 选择目标套餐和计费周期（月付/年付）
3. 点击"升级"按钮
4. 跳转到 Stripe Checkout 页面
5. 完成支付后，Stripe 通过 Webhook 通知服务器
6. 服务器更新用户订阅状态

### 3. 配额检查
- API 请求经过配额中间件时自动检查
- 超出配额返回 429 错误，提示用户升级
- 成功请求自动记录使用量

### 4. 取消订阅
- 用户可以选择在周期结束时取消（`cancel_at_period_end`）
- 或立即取消（管理员功能）
- 取消后仍可在当前周期内使用

## 测试

### 1. 本地测试（无 Stripe）
```bash
npm run dev
```
- 订阅管理界面可正常访问
- 套餐列表正常显示
- 配额检查正常工作
- Checkout 按钮返回 501（Stripe 未配置）

### 2. Stripe 测试
1. 注册 Stripe 测试账号
2. 创建产品和价格
3. 配置 Webhook 端点: `https://your-domain.com/api/subscriptions/webhook`
4. 设置环境变量
5. 使用 Stripe 测试卡号: `4242 4242 4242 4242`

## 后续优化

### 短期 (P1)
- [ ] 发票管理界面
- [ ] 支付方式管理
- [ ] 订阅变更历史
- [ ] 邮件通知（支付成功/失败、订阅到期提醒）

### 中期 (P2)
- [ ] 优惠码/促销码支持
- [ ] 团队订阅（多用户）
- [ ] 自定义配额（企业版）
- [ ] 使用量详细报表

### 长期 (P3)
- [ ] 多币种支持
- [ ] 其他支付网关（支付宝、微信支付）
- [ ] 按量计费模式
- [ ] API 密钥管理（企业版）

## 相关文档

- [商业化计划](./COMMERCIALIZATION_PLAN.md)
- [商业化快速开始](./COMMERCIALIZATION_QUICKSTART.md)
- [需求管理](./REQUIREMENTS.md)
- [Stripe 官方文档](https://stripe.com/docs)

## 注意事项

1. **安全性**:
   - Webhook 签名验证必须启用
   - Stripe Secret Key 不能泄露
   - 配额检查在服务端进行，前端仅展示

2. **数据一致性**:
   - Stripe 为真实数据源
   - 本地数据库定期与 Stripe 同步
   - Webhook 事件幂等处理

3. **错误处理**:
   - 支付失败自动重试（Stripe 自动处理）
   - Webhook 处理失败记录日志
   - 配额检查失败不阻止请求（降级策略）

4. **性能优化**:
   - 使用量记录异步处理
   - 配额检查结果缓存（可选）
   - 数据库索引优化

## 总结

R057 付费订阅系统已完整实现，包括：

✅ 数据库设计与迁移  
✅ 订阅服务核心逻辑  
✅ Stripe 支付集成  
✅ 配额管理中间件  
✅ RESTful API 端点  
✅ 前端订阅管理界面  
✅ 国际化支持（中英文）  
✅ 使用量追踪与展示  

系统已准备好上线，可根据实际需求配置 Stripe 并启用支付功能。
