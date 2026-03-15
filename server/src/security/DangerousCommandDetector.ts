/**
 * DangerousCommandDetector - 危险命令检测器
 * 
 * 检测可能破坏系统的危险命令，要求用户确认或直接拒绝。
 * 
 * 使用场景：
 * - shell.run 执行命令前
 * - X 生成命令时
 */

export interface DetectionResult {
  dangerous: boolean;
  severity: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  description?: string;
  suggestion?: string;
}

export class DangerousCommandDetector {
  // 危险命令模式
  private static PATTERNS = {
    critical: [
      {
        pattern: /rm\s+-rf\s+\//,
        description: '删除根目录（rm -rf /）',
        suggestion: '这会删除整个文件系统，绝对禁止',
      },
      {
        pattern: /dd\s+.*of=\/dev\/sd[a-z]/,
        description: '写入磁盘设备（dd of=/dev/sdX）',
        suggestion: '这会破坏磁盘数据，绝对禁止',
      },
      {
        pattern: /mkfs/,
        description: '格式化文件系统（mkfs）',
        suggestion: '这会清空磁盘，绝对禁止',
      },
      {
        pattern: /:\(\)\{.*:\|:&\};:/,
        description: 'Fork 炸弹',
        suggestion: '这会耗尽系统资源，绝对禁止',
      },
      {
        pattern: />\s*\/dev\/sd[a-z]/,
        description: '重定向到磁盘设备',
        suggestion: '这会破坏磁盘数据，绝对禁止',
      },
      {
        pattern: /chmod\s+-R\s+777\s+\//,
        description: '递归修改根目录权限为 777',
        suggestion: '这会破坏系统安全，绝对禁止',
      },
    ],
    high: [
      {
        pattern: /rm\s+-rf\s+~\//,
        description: '删除用户主目录（rm -rf ~/）',
        suggestion: '这会删除所有用户文件，建议使用更精确的路径',
      },
      {
        pattern: /rm\s+-rf\s+\*/,
        description: '递归删除所有文件（rm -rf *）',
        suggestion: '这会删除当前目录所有内容，建议指定具体文件',
      },
      {
        pattern: />\s*\/etc\//,
        description: '重定向到系统配置目录',
        suggestion: '这可能破坏系统配置，建议在工作区操作',
      },
      {
        pattern: /curl\s+.*\|\s*(bash|sh)/,
        description: '管道执行远程脚本（curl | bash）',
        suggestion: '这可能执行恶意代码，建议先下载并审查',
      },
      {
        pattern: /wget\s+.*\|\s*(bash|sh)/,
        description: '管道执行远程脚本（wget | sh）',
        suggestion: '这可能执行恶意代码，建议先下载并审查',
      },
    ],
    medium: [
      {
        pattern: /rm\s+-rf\s+[^\/\s]/,
        description: '递归删除目录（rm -rf）',
        suggestion: '请确认删除的目录路径正确',
      },
      {
        pattern: /chmod\s+777/,
        description: '设置文件权限为 777',
        suggestion: '这会降低安全性，建议使用更安全的权限',
      },
      {
        pattern: /chown\s+root/,
        description: '修改文件所有者为 root',
        suggestion: '这可能导致权限问题',
      },
    ],
  };

  /**
   * 分析命令危险性
   */
  static analyze(command: string): DetectionResult {
    // 检查 critical 级别
    for (const { pattern, description, suggestion } of this.PATTERNS.critical) {
      if (pattern.test(command)) {
        return {
          dangerous: true,
          severity: 'critical',
          description,
          suggestion,
        };
      }
    }

    // 检查 high 级别
    for (const { pattern, description, suggestion } of this.PATTERNS.high) {
      if (pattern.test(command)) {
        return {
          dangerous: true,
          severity: 'high',
          description,
          suggestion,
        };
      }
    }

    // 检查 medium 级别
    for (const { pattern, description, suggestion } of this.PATTERNS.medium) {
      if (pattern.test(command)) {
        return {
          dangerous: true,
          severity: 'medium',
          description,
          suggestion,
        };
      }
    }

    return {
      dangerous: false,
      severity: 'safe',
    };
  }

  /**
   * 判断命令是否应该被拒绝
   */
  static shouldBlock(command: string): boolean {
    const result = this.analyze(command);
    return result.severity === 'critical';
  }

  /**
   * 判断命令是否需要用户确认
   */
  static requiresConfirmation(command: string): boolean {
    const result = this.analyze(command);
    return result.severity === 'high' || result.severity === 'medium';
  }
}
