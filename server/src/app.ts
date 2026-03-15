import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { getRecentAssistantChat as getRecentAssistantChatImpl } from './chat/recentChatForX.js';
import { AgentOrchestrator } from './orchestrator/AgentOrchestrator.js';
import { PolicyEngine } from './policy/PolicyEngine.js';
import { AuditLogger } from './observability/AuditLogger.js';
import { SandboxFS } from './tooling/SandboxFS.js';
import { SandboxShell } from './tooling/SandboxShell.js';
import { UserSandboxManager } from './tooling/UserSandboxManager.js';
import { UserContainerManager } from './container/UserContainerManager.js';
import { MemoryService } from './memory/MemoryService.js';
import { createDatabase, type AsyncDatabase } from './db/database.js';
import { MiniAppLogStore } from './miniAppLogStore.js';
import { setSkillsRoot, setProjectSkillsRoot, setGetSkillsRootForUser } from './skills/discovery.js';
import { createApiRouter } from './routes/api.js';
import { createAuthRouter } from './routes/auth.js';
import { createFSRouter } from './routes/fs.js';
import { createShellRouter } from './routes/shell.js';
import { createUserRouter } from './routes/user.js';
import { createAdminRouter } from './routes/admin.js';
import { createServerRouter } from './routes/servers.js';
import { createSubscriptionRoutes } from './routes/subscriptionRoutes.js';
import { createAuthEnhancedRoutes } from './routes/authEnhanced.js';
import { userContextMiddleware } from './middleware/userContext.js';
import { SubscriptionService } from './subscription/SubscriptionService.js';
import { StripePaymentService } from './subscription/stripeService.js';
import { serverLogger } from './observability/ServerLogger.js';
import { loadDefaultConfig } from './config/defaultConfig.js';

export interface CreateAppOptions {
  /** Override workspace root for SandboxFS (e.g. for tests) */
  workspaceRoot?: string;
  /**
   * 项目内置 skills 路径（仓库 skills/ 目录）。dev 时 workspaceRoot 为临时目录，主工作区 skills 为空，
   * 需从此处发现 Skill。默认 process.cwd()/skills。
   */
  projectSkillsPath?: string;
  /**
   * 是否允许匿名访问（无 X-User-Id 时用 'anonymous'）。
   * 默认 true（开发模式）。生产环境建议设为 false。
   */
  allowAnonymous?: boolean;
  /**
   * 是否启用容器隔离（R060 安全加固）。
   * 默认 false（开发模式）。生产环境强烈建议设为 true。
   * 需要 Docker 环境和沙箱镜像。
   */
  useContainerIsolation?: boolean;
  /**
   * 数据库类型（测试可传 'sqlite' 避免连接 MySQL/Docker）。
   * 默认从 config.database.type 或 DATABASE_TYPE 读取。
   */
  databaseType?: 'sqlite' | 'mysql';
}

export interface AppResult {
  app: express.Express;
  orchestrator: AgentOrchestrator;
  policy: PolicyEngine;
  audit: AuditLogger;
  sandboxFS: SandboxFS;
  sandboxShell: SandboxShell;
  userSandboxManager: UserSandboxManager;
  db: AsyncDatabase;
}

/**
 * Create Express app and services. Used by index.ts to start the server
 * and by tests to run requests without listening.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<AppResult> {
  const workspaceRoot = options.workspaceRoot ?? path.join(os.tmpdir(), 'x-computer-workspace');
  
  // 加载配置文件
  const config = loadDefaultConfig();
  
  // 认证配置：优先级 options > config > env > 默认值
  const allowAnonymous = options.allowAnonymous ?? 
    config.auth?.allowAnonymous ?? 
    true;
  
  // 容器隔离配置：优先级 options > config > env > 默认值
  const useContainerIsolation = options.useContainerIsolation ?? 
    config.container?.enabled ?? 
    (process.env.USE_CONTAINER_ISOLATION === 'true');
  
  const containerCpuLimit = config.container?.cpuLimit ?? 
    (process.env.CONTAINER_CPU_LIMIT ? parseFloat(process.env.CONTAINER_CPU_LIMIT) : 1);
  
  const containerMemoryLimit = config.container?.memoryLimit ?? 
    process.env.CONTAINER_MEMORY_LIMIT ?? 
    '512m';
  
  const containerPidsLimit = config.container?.pidsLimit ?? 
    (process.env.CONTAINER_PIDS_LIMIT ? parseInt(process.env.CONTAINER_PIDS_LIMIT) : 100);
  
  const containerNetworkMode = (config.container?.networkMode ?? 
    process.env.CONTAINER_NETWORK_MODE ?? 
    'none') as 'none' | 'bridge' | 'host';

  const policy = new PolicyEngine();
  const audit = new AuditLogger();

  // ── 容器管理器（R060 安全加固） ──
  let containerManager: UserContainerManager | undefined;
  if (useContainerIsolation) {
    try {
      containerManager = new UserContainerManager(workspaceRoot, {
        cpuLimit: containerCpuLimit,
        memoryLimit: containerMemoryLimit,
        pidsLimit: containerPidsLimit,
        networkMode: containerNetworkMode,
      });
      await containerManager.ensureImageExists();
      serverLogger.info('app', `✅ 容器隔离已启用（安全模式）CPU=${containerCpuLimit} MEM=${containerMemoryLimit} PIDS=${containerPidsLimit} NET=${containerNetworkMode}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('app', '❌ 容器隔离启动失败，回退到直接模式（不安全）', msg);
      containerManager = undefined;
    }
  } else {
    serverLogger.warn('app', '⚠️  容器隔离未启用（开发模式），生产环境请在 .x-config.json 中设置 container.enabled=true');
  }

  // ── 默认沙箱（用于 anonymous 或单用户后向兼容） ──
  const sandboxFS = new SandboxFS(workspaceRoot);
  const sandboxShell = new SandboxShell(sandboxFS.getRoot());

  // ── Skills 目录使用工作区，确保安装后持久化 ──
  setSkillsRoot(path.join(workspaceRoot, 'skills'));
  // 项目内置 skills（仓库 skills/），dev 时 workspaceRoot 为临时目录，X 需从此发现内置 Skill
  setProjectSkillsRoot(options.projectSkillsPath ?? path.join(process.cwd(), 'skills'));

  // ── 数据库（优先级 options > config > env：sqlite 默认，mysql 可选） ──
  const rawDbType = (options.databaseType ?? config.database?.type ?? process.env.DATABASE_TYPE ?? 'sqlite').toString().toLowerCase().trim();
  const databaseType = rawDbType === 'mysql' ? 'mysql' : 'sqlite';
  if (databaseType === 'mysql') {
    const { ensureMysqlReady } = await import('./db/ensureMysqlContainer.js');
    await ensureMysqlReady(); // 可能阻塞数十秒（连接/拉取镜像/等待 MySQL 启动）
  }
  const db = await createDatabase(workspaceRoot, { type: databaseType });
  
  // ── 运行数据库迁移 ──
  // 迁移路径：npm run dev 时 cwd=server/，故用 migrations；部署时可能 cwd=根目录，用 server/migrations
  try {
    const { runMigrations } = await import('./db/migrate.js');
    const candidates = [
      path.join(process.cwd(), 'migrations'),
      path.join(process.cwd(), 'server', 'migrations'),
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
    ];
    const migrationsDir = candidates.find((d) => fs.existsSync(d)) ?? candidates[0];
    await runMigrations(db, migrationsDir);
  } catch (err) {
    console.error('[DB] Migration failed:', err);
    // 不阻止启动，迁移失败时继续运行
  }

  // ── 订阅服务 ──
  const subscriptionService = new SubscriptionService(db, workspaceRoot);

  // ── 多用户沙箱管理器 ──
  const userSandboxManager = new UserSandboxManager(workspaceRoot, {
    containerManager,
    useContainer: useContainerIsolation && !!containerManager,
    subscriptionService,
  });
  // 登录用户：支持从用户沙箱 users/{id}/workspace/skills 发现 Skill（含手动复制的）
  setGetSkillsRootForUser((uid) => path.join(userSandboxManager.getUserWorkspaceRoot(uid), 'skills'));

  // ── Stripe 支付服务（可选，需要配置 STRIPE_SECRET_KEY） ──
  let stripeService: StripePaymentService | undefined;
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) {
    try {
      stripeService = new StripePaymentService(
        {
          secretKey: process.env.STRIPE_SECRET_KEY,
          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
          priceIds: {
            personalMonthly: process.env.STRIPE_PRICE_PERSONAL_MONTHLY ?? '',
            personalYearly: process.env.STRIPE_PRICE_PERSONAL_YEARLY ?? '',
            proMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? '',
            proYearly: process.env.STRIPE_PRICE_PRO_YEARLY ?? '',
            testMonthly: process.env.STRIPE_PRICE_TEST_MONTHLY ?? '',
            testYearly: process.env.STRIPE_PRICE_TEST_MONTHLY ?? '',  // 测试套餐月付/年付共用
          },
        },
        subscriptionService
      );
      console.log('[Stripe] Payment service initialized');
    } catch (err) {
      console.error('[Stripe] Failed to initialize:', err);
    }
  } else {
    console.log('[Stripe] Skipping initialization (missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET)');
  }

  // ── 主脑自我进化提示词服务（按用户沙箱读写 memory/EVOLVED_CORE_PROMPT.md） ──
  const evolvedPromptService = {
    async read(userId?: string): Promise<string> {
      const fs =
        userId && userId !== 'anonymous' && userSandboxManager
          ? (await userSandboxManager.getForUser(userId)).sandboxFS
          : sandboxFS;
      const ms = new MemoryService(fs, undefined as any);
      return ms.readEvolvedCorePrompt();
    },
    async append(userId: string | undefined, content: string): Promise<void> {
      const fs =
        userId && userId !== 'anonymous' && userSandboxManager
          ? (await userSandboxManager.getForUser(userId)).sandboxFS
          : sandboxFS;
      const ms = new MemoryService(fs, undefined as any);
      return ms.appendEvolvedCorePrompt(content);
    },
  };

  const getRecentAssistantChat = (userId: string, limit?: number) =>
    getRecentAssistantChatImpl(db, userId, limit ?? 80);

  const miniAppLogStore = new MiniAppLogStore();

  const orchestrator = new AgentOrchestrator(
    policy,
    audit,
    sandboxFS,
    userSandboxManager,
    db,
    evolvedPromptService,
    getRecentAssistantChat,
    miniAppLogStore,
    subscriptionService,
  );
  await orchestrator.init();

  // ── 审计持久化（C.4）：根据 taskId 解析 userId 写入 audit_log ──
  audit.setPersist((entry) => {
    const task = orchestrator.getTask(entry.taskId);
    const userId = (task?.metadata as { userId?: string } | undefined)?.userId ?? null;
    void db.insertAudit({
      id: entry.id,
      user_id: userId,
      task_id: entry.taskId,
      step_id: entry.stepId ?? null,
      type: entry.type,
      intent: entry.intent ?? null,
      action: entry.action ?? null,
      result: entry.result ?? null,
      risk_level: entry.riskLevel ?? null,
      metadata_json: entry.metadata ? JSON.stringify(entry.metadata) : null,
      created_at: entry.timestamp,
    }).catch(() => {});
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  // ── 用户上下文中间件（所有 /api 路由前注入 userId） ──
  app.use('/api', userContextMiddleware(allowAnonymous));

  // ── 路由 ──
  app.use('/api', createApiRouter(orchestrator, policy, audit, sandboxFS, userSandboxManager, db, miniAppLogStore, subscriptionService));
  app.use('/api/auth', createAuthRouter(db, userSandboxManager));
  app.use('/api/auth', createAuthEnhancedRoutes(db));
  app.use('/api/users', createUserRouter(db, subscriptionService));
  app.use('/api/fs', createFSRouter(sandboxFS, userSandboxManager));
  app.use('/api/shell', createShellRouter(sandboxShell, userSandboxManager));
  app.use('/api/servers', createServerRouter());
  app.use('/api/subscriptions', createSubscriptionRoutes(subscriptionService, stripeService));
  app.use('/api/admin', createAdminRouter(db, subscriptionService));

  return {
    app,
    orchestrator,
    policy,
    audit,
    sandboxFS,
    sandboxShell,
    userSandboxManager,
    db,
  };
}
