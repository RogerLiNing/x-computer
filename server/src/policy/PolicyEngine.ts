import type {
  TaskStep,
  RiskLevel,
  PolicyRule,
  DataClassification,
  ToolDefinition,
} from '../../../shared/src/index.js';

/**
 * PolicyEngine — evaluates risk for every step and enforces governance rules.
 *
 * Key capabilities:
 * - Risk scoring based on tool type, data sensitivity, and network scope
 * - Approval gating for medium+ risk in approval mode
 * - Automatic VM upgrade recommendation for high/critical risk
 * - Data classification mapping to execution sandbox
 */

export interface RiskAssessment {
  riskLevel: RiskLevel;
  score: number; // 0-100
  requiresApproval: boolean;
  requiresVM: boolean;
  reason: string;
  matchedRules: string[];
}

const RISK_WEIGHTS: Record<RiskLevel, number> = {
  low: 10,
  medium: 40,
  high: 70,
  critical: 95,
};

// ── Default policy rules ───────────────────────────────────

const DEFAULT_RULES: PolicyRule[] = [
  {
    id: 'rule-network-outbound',
    name: '外部网络请求',
    description: 'HTTP 请求到外部服务需审批',
    toolPattern: 'http.*',
    minRiskLevel: 'high',
    requiresApproval: true,
    allowedRuntimes: ['container', 'vm'],
    dataClassification: 'internal',
  },
  {
    id: 'rule-code-modify',
    name: '代码修改',
    description: '修改代码文件需要中等风险审批',
    toolPattern: 'code.edit',
    minRiskLevel: 'medium',
    requiresApproval: true,
    allowedRuntimes: ['container'],
    dataClassification: 'internal',
  },
  {
    id: 'rule-code-commit',
    name: '代码提交',
    description: '提交代码变更',
    toolPattern: 'code.commit',
    minRiskLevel: 'medium',
    requiresApproval: true,
    allowedRuntimes: ['container'],
    dataClassification: 'internal',
  },
  {
    id: 'rule-file-write',
    name: '文件写入',
    description: '写入文件到工作区',
    toolPattern: 'file.write',
    minRiskLevel: 'low',
    requiresApproval: false,
    allowedRuntimes: ['container'],
    dataClassification: 'internal',
  },
  {
    id: 'rule-process-exec',
    name: '进程执行',
    description: '执行系统命令',
    toolPattern: 'process.*',
    minRiskLevel: 'high',
    requiresApproval: true,
    allowedRuntimes: ['container', 'vm'],
    dataClassification: 'sensitive',
  },
  {
    id: 'rule-shell-run',
    name: 'Shell/脚本执行',
    description: '在沙箱内执行命令与脚本（容器模式下在容器内执行）',
    toolPattern: 'shell.run',
    minRiskLevel: 'high',
    requiresApproval: true,
    allowedRuntimes: ['container', 'vm'],
    dataClassification: 'internal',
  },
  {
    id: 'rule-sensitive-data',
    name: '敏感数据操作',
    description: '涉及敏感数据时升级到 VM',
    toolPattern: '*',
    minRiskLevel: 'critical',
    requiresApproval: true,
    allowedRuntimes: ['container', 'vm'],
    dataClassification: 'regulated',
  },
];

export class PolicyEngine {
  private rules: PolicyRule[] = [...DEFAULT_RULES];

  /**
   * Assess the risk of a task step.
   */
  assessRisk(step: TaskStep): RiskAssessment {
    const matchedRules: PolicyRule[] = [];
    let maxRiskScore = RISK_WEIGHTS[step.riskLevel];
    let requiresApproval = false;
    let requiresVM = false;
    const reasons: string[] = [];

    for (const rule of this.rules) {
      if (this.matchToolPattern(step.toolName, rule.toolPattern)) {
        matchedRules.push(rule);

        const ruleScore = RISK_WEIGHTS[rule.minRiskLevel];
        if (ruleScore > maxRiskScore) {
          maxRiskScore = ruleScore;
        }

        if (rule.requiresApproval) {
          requiresApproval = true;
          reasons.push(rule.description);
        }

        if (!rule.allowedRuntimes.includes('container')) {
          requiresVM = true;
        }
      }
    }

    // Determine overall risk level from score
    let riskLevel: RiskLevel = 'low';
    if (maxRiskScore >= 80) riskLevel = 'critical';
    else if (maxRiskScore >= 60) riskLevel = 'high';
    else if (maxRiskScore >= 30) riskLevel = 'medium';

    // High/critical risk → recommend VM
    if (riskLevel === 'high' || riskLevel === 'critical') {
      requiresVM = true;
    }

    return {
      riskLevel,
      score: maxRiskScore,
      requiresApproval,
      requiresVM,
      reason: reasons.length > 0 ? reasons.join('; ') : '标准操作',
      matchedRules: matchedRules.map((r) => r.id),
    };
  }

  /**
   * Get all policy rules.
   */
  getRules(): PolicyRule[] {
    return this.rules;
  }

  /**
   * Add a custom policy rule.
   */
  addRule(rule: PolicyRule) {
    this.rules.push(rule);
  }

  /**
   * Classify data sensitivity for a given context.
   */
  classifyData(context: Record<string, unknown>): DataClassification {
    // In production this would use content inspection / ML classification.
    const contentStr = JSON.stringify(context).toLowerCase();

    if (contentStr.includes('password') || contentStr.includes('secret') || contentStr.includes('credential')) {
      return 'regulated';
    }
    if (contentStr.includes('private') || contentStr.includes('confidential')) {
      return 'sensitive';
    }
    if (contentStr.includes('internal')) {
      return 'internal';
    }
    return 'public';
  }

  // ── Private helpers ──────────────────────────────────────

  private matchToolPattern(toolName: string, pattern: string): boolean {
    if (pattern === '*') return true;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(toolName);
  }
}
