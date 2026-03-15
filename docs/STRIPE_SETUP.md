# Stripe 升级配置指南

## 1. 并发任务数如何限制

### 实现方式

并发任务数**不写入 usage_records**，而是实时统计 `tasks` 表中当前用户处于 `pending` 或 `running` 状态的任务数量：

```sql
SELECT COUNT(*) FROM tasks
WHERE user_id = ? AND status IN ('pending', 'running')
```

### 检查时机

- 用户通过 `POST /api/tasks` 创建新任务时，会先经过 `tasksQuota` 中间件
- 若当前并发任务数已达到套餐上限，返回 `429 quota_exceeded`，无法创建新任务
- 套餐中 `concurrent_tasks_limit` 为 `-1` 表示无限制（企业版）

### 相关代码

- `server/src/subscription/SubscriptionService.ts`: `getCurrentUsage()`、`checkQuota()`
- `server/src/subscription/quotaMiddleware.ts`: `tasksQuota()`

---

## 2. 如何配置 Stripe 升级

### 2.1 环境变量

在 `.env` 或生产环境配置中设置：

```bash
# 必需：Stripe 密钥与 Webhook
STRIPE_SECRET_KEY=sk_test_xxxxx      # 测试用 sk_test_xxx，正式用 sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx    # Stripe Dashboard Webhook 中获取

# 必需：各套餐的 Stripe Price ID（Stripe 中创建价格后复制）
STRIPE_PRICE_PERSONAL_MONTHLY=price_xxxxx
STRIPE_PRICE_PERSONAL_YEARLY=price_xxxxx
STRIPE_PRICE_PRO_MONTHLY=price_xxxxx
STRIPE_PRICE_PRO_YEARLY=price_xxxxx

# 可选：测试套餐 $0.10/月（用于支付流程测试）
STRIPE_PRICE_TEST_MONTHLY=price_xxxxx

# 可选：Stripe Checkout 回调 URL
FRONTEND_URL=http://localhost:3000   # 或你的前端域名
```

### 2.2 在 Stripe 中创建产品和价格

1. 登录 [Stripe Dashboard](https://dashboard.stripe.com)
2. **产品 (Products)** → 创建产品，如「个人版」「专业版」
3. 为每个产品创建**价格 (Prices)**：
   - 个人版月付：如 $10/月
   - 个人版年付：如 $100/年
   - 专业版月付：如 $30/月
   - 专业版年付：如 $300/年
4. 复制各价格的 **Price ID**（形如 `price_xxxxx`）填入环境变量

**若已先创建了 Payment Link（支付链接）**：  
Payment Link 背后绑定的也是某个产品的价格。请到 **产品 (Products)** → 点进对应产品（如 Personal）→ 在价格列表里找到该月付/年付价格 → 复制其 **Price ID**（不是 Payment Link 的 `plink_xxx`）。把该 Price ID 填入 `STRIPE_PRICE_PERSONAL_MONTHLY` 等环境变量即可；应用内「升级」会通过 Checkout Session 使用同一价格，Webhook 能正确关联用户。Payment Link 的 URL 仍可单独用于「复制分享」场景（如邮件、落地页）。

### 2.3 配置 Webhook

1. Stripe Dashboard → **开发者** → **Webhook**
2. 添加端点：`https://你的域名/api/subscriptions/webhook`
3. 选择事件：
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. 复制 **Webhook 签名密钥**，填入 `STRIPE_WEBHOOK_SECRET`

### 2.4 本地测试

```bash
# 安装 Stripe CLI
# https://stripe.com/docs/stripe-cli

# 转发 Webhook 到本地
stripe listen --forward-to localhost:4000/api/subscriptions/webhook

# 会输出 whsec_xxx，用于 STRIPE_WEBHOOK_SECRET
```

### 2.5 套餐与 Price ID 映射

当前 `stripeService.ts` 支持的套餐对应关系：

| 套餐 planId | 月付 env              | 年付 env              |
|-------------|-----------------------|------------------------|
| personal    | STRIPE_PRICE_PERSONAL_MONTHLY | STRIPE_PRICE_PERSONAL_YEARLY |
| pro         | STRIPE_PRICE_PRO_MONTHLY      | STRIPE_PRICE_PRO_YEARLY      |
| test        | STRIPE_PRICE_TEST_MONTHLY     | （同 testMonthly，$0.10 支付测试用）|

**企业版 (enterprise)** 在数据库 `plans` 表中无价格，前端显示「联系销售」，不走 Stripe Checkout，需自行对接销售流程。

### 2.6 验证

- 配置完成后重启服务，日志中应出现：`[Stripe] Payment service initialized`
- 若缺少 `STRIPE_SECRET_KEY` 或 `STRIPE_WEBHOOK_SECRET`，则显示：`[Stripe] Skipping initialization`
- 用户点击「升级」后会跳转到 Stripe Checkout；支付成功后由 Webhook 更新本地订阅

### 2.7 正式收款前：激活支付

Stripe 提示「Activate payments」时，表示账号尚未完成**身份与收款**设置：

1. 在 [Stripe Dashboard](https://dashboard.stripe.com) 完成**身份/企业验证**（按 Stripe 指引提交资料）。
2. **连接银行账户**：Settings → Business settings → Payouts，添加用于收款的银行账号。
3. 测试环境（`sk_test_xxx`、`buy.stripe.com/test_xxx`）可先用于联调与测试；上线后改用 **Live 密钥** 和 **Live Payment Link / Price**，并再次完成上述验证。
