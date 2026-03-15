/**
 * ScriptAnalyzer - 脚本安全分析器
 * 
 * 在执行用户脚本前，分析脚本内容，检测潜在的危险操作。
 * 
 * 使用场景：
 * - X 编写 Python/Node.js/Shell 脚本时
 * - 用户上传脚本文件时
 * - 执行脚本命令前
 */

export interface AnalysisResult {
  safe: boolean;
  riskLevel: 'safe' | 'low' | 'medium' | 'high';
  reasons: string[];
  suggestions?: string[];
}

export class ScriptAnalyzer {
  // Python 危险模式
  private static PYTHON_PATTERNS = {
    high: [
      { pattern: /import\s+subprocess/, reason: '导入 subprocess 模块（可执行系统命令）' },
      { pattern: /from\s+subprocess\s+import/, reason: '从 subprocess 导入（可执行系统命令）' },
      { pattern: /import\s+socket/, reason: '导入 socket 模块（网络操作）' },
      { pattern: /import\s+urllib/, reason: '导入 urllib 模块（网络请求）' },
      { pattern: /import\s+requests/, reason: '导入 requests 模块（网络请求）' },
      { pattern: /eval\s*\(/, reason: '使用 eval()（代码注入风险）' },
      { pattern: /exec\s*\(/, reason: '使用 exec()（代码执行风险）' },
      { pattern: /__import__\s*\(/, reason: '使用 __import__（动态导入）' },
    ],
    medium: [
      { pattern: /import\s+os/, reason: '导入 os 模块（文件系统操作）' },
      { pattern: /from\s+os\s+import/, reason: '从 os 导入（文件系统操作）' },
      { pattern: /open\s*\([^)]*['"]\/etc\//, reason: '尝试访问系统文件 /etc/' },
      { pattern: /open\s*\([^)]*['"]\/proc\//, reason: '尝试访问进程信息 /proc/' },
      { pattern: /open\s*\([^)]*['"]\/sys\//, reason: '尝试访问系统信息 /sys/' },
      { pattern: /compile\s*\(/, reason: '使用 compile()（代码编译）' },
    ],
    low: [
      { pattern: /import\s+sys/, reason: '导入 sys 模块' },
      { pattern: /\.system\s*\(/, reason: '使用 os.system()' },
      { pattern: /\.popen\s*\(/, reason: '使用 popen()' },
    ],
  };

  // Node.js 危险模式
  private static NODE_PATTERNS = {
    high: [
      { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, reason: '导入 child_process 模块（可执行系统命令）' },
      { pattern: /require\s*\(\s*['"]net['"]\s*\)/, reason: '导入 net 模块（网络操作）' },
      { pattern: /require\s*\(\s*['"]http['"]\s*\)/, reason: '导入 http 模块（网络请求）' },
      { pattern: /require\s*\(\s*['"]https['"]\s*\)/, reason: '导入 https 模块（网络请求）' },
      { pattern: /\.exec\s*\(/, reason: '使用 exec()（执行系统命令）' },
      { pattern: /\.spawn\s*\(/, reason: '使用 spawn()（创建子进程）' },
      { pattern: /\.fork\s*\(/, reason: '使用 fork()（创建子进程）' },
      { pattern: /eval\s*\(/, reason: '使用 eval()（代码注入风险）' },
      { pattern: /Function\s*\(/, reason: '使用 Function 构造器（代码执行风险）' },
    ],
    medium: [
      { pattern: /require\s*\(\s*['"]fs['"]\s*\)/, reason: '导入 fs 模块（文件系统操作）' },
      { pattern: /require\s*\(\s*['"]path['"]\s*\)/, reason: '导入 path 模块' },
      { pattern: /\.execSync\s*\(/, reason: '使用 execSync()（同步执行命令）' },
      { pattern: /\.spawnSync\s*\(/, reason: '使用 spawnSync()（同步创建进程）' },
    ],
    low: [
      { pattern: /require\s*\(\s*['"]os['"]\s*\)/, reason: '导入 os 模块' },
      { pattern: /process\.env/, reason: '访问环境变量' },
    ],
  };

  // Shell 危险模式
  private static SHELL_PATTERNS = {
    high: [
      { pattern: /docker/i, reason: '使用 docker 命令' },
      { pattern: /kubectl/i, reason: '使用 kubectl 命令' },
      { pattern: /sudo/i, reason: '使用 sudo 提权' },
      { pattern: /su\s/i, reason: '使用 su 切换用户' },
      { pattern: /curl\s+.*\|\s*bash/, reason: '危险的管道执行（curl | bash）' },
      { pattern: /wget\s+.*\|\s*sh/, reason: '危险的管道执行（wget | sh）' },
      { pattern: /rm\s+-rf\s+\//, reason: '危险的删除命令（rm -rf /）' },
      { pattern: />\s*\/dev\/sd[a-z]/, reason: '尝试写入磁盘设备' },
    ],
    medium: [
      { pattern: /curl\s/i, reason: '使用 curl（网络请求）' },
      { pattern: /wget\s/i, reason: '使用 wget（网络下载）' },
      { pattern: /nc\s/i, reason: '使用 netcat（网络工具）' },
      { pattern: /netcat/i, reason: '使用 netcat（网络工具）' },
      { pattern: /\/dev\/tcp/, reason: '使用 /dev/tcp（网络连接）' },
      { pattern: /chmod\s+777/, reason: '设置危险的文件权限（777）' },
    ],
    low: [
      { pattern: /rm\s+-rf/, reason: '使用 rm -rf（递归删除）' },
      { pattern: />\s*\/etc\//, reason: '尝试写入系统目录' },
    ],
  };

  /**
   * 分析 Python 脚本
   */
  static analyzePython(code: string): AnalysisResult {
    const reasons: string[] = [];
    let riskLevel: 'safe' | 'low' | 'medium' | 'high' = 'safe';

    // 检查高风险模式
    for (const { pattern, reason } of this.PYTHON_PATTERNS.high) {
      if (pattern.test(code)) {
        reasons.push(`🔴 高风险：${reason}`);
        riskLevel = 'high';
      }
    }

    // 检查中风险模式
    for (const { pattern, reason } of this.PYTHON_PATTERNS.medium) {
      if (pattern.test(code)) {
        reasons.push(`🟡 中风险：${reason}`);
        if (riskLevel === 'safe') riskLevel = 'medium';
      }
    }

    // 检查低风险模式
    for (const { pattern, reason } of this.PYTHON_PATTERNS.low) {
      if (pattern.test(code)) {
        reasons.push(`🟢 低风险：${reason}`);
        if (riskLevel === 'safe') riskLevel = 'low';
      }
    }

    return {
      safe: riskLevel === 'safe' || riskLevel === 'low',
      riskLevel,
      reasons,
      suggestions: this.getSuggestions('python', riskLevel),
    };
  }

  /**
   * 分析 Node.js 脚本
   */
  static analyzeNodeJS(code: string): AnalysisResult {
    const reasons: string[] = [];
    let riskLevel: 'safe' | 'low' | 'medium' | 'high' = 'safe';

    // 检查高风险模式
    for (const { pattern, reason } of this.NODE_PATTERNS.high) {
      if (pattern.test(code)) {
        reasons.push(`🔴 高风险：${reason}`);
        riskLevel = 'high';
      }
    }

    // 检查中风险模式
    for (const { pattern, reason } of this.NODE_PATTERNS.medium) {
      if (pattern.test(code)) {
        reasons.push(`🟡 中风险：${reason}`);
        if (riskLevel === 'safe') riskLevel = 'medium';
      }
    }

    // 检查低风险模式
    for (const { pattern, reason } of this.NODE_PATTERNS.low) {
      if (pattern.test(code)) {
        reasons.push(`🟢 低风险：${reason}`);
        if (riskLevel === 'safe') riskLevel = 'low';
      }
    }

    return {
      safe: riskLevel === 'safe' || riskLevel === 'low',
      riskLevel,
      reasons,
      suggestions: this.getSuggestions('nodejs', riskLevel),
    };
  }

  /**
   * 分析 Shell 脚本
   */
  static analyzeShell(code: string): AnalysisResult {
    const reasons: string[] = [];
    let riskLevel: 'safe' | 'low' | 'medium' | 'high' = 'safe';

    // 检查高风险模式
    for (const { pattern, reason } of this.SHELL_PATTERNS.high) {
      if (pattern.test(code)) {
        reasons.push(`🔴 高风险：${reason}`);
        riskLevel = 'high';
      }
    }

    // 检查中风险模式
    for (const { pattern, reason } of this.SHELL_PATTERNS.medium) {
      if (pattern.test(code)) {
        reasons.push(`🟡 中风险：${reason}`);
        if (riskLevel === 'safe') riskLevel = 'medium';
      }
    }

    // 检查低风险模式
    for (const { pattern, reason } of this.SHELL_PATTERNS.low) {
      if (pattern.test(code)) {
        reasons.push(`🟢 低风险：${reason}`);
        if (riskLevel === 'safe') riskLevel = 'low';
      }
    }

    return {
      safe: riskLevel === 'safe' || riskLevel === 'low',
      riskLevel,
      reasons,
      suggestions: this.getSuggestions('shell', riskLevel),
    };
  }

  /**
   * 根据文件名和内容分析脚本
   */
  static analyze(filename: string, code: string): AnalysisResult {
    const ext = filename.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'py':
        return this.analyzePython(code);
      case 'js':
      case 'ts':
      case 'mjs':
        return this.analyzeNodeJS(code);
      case 'sh':
      case 'bash':
        return this.analyzeShell(code);
      default:
        return {
          safe: true,
          riskLevel: 'safe',
          reasons: [],
        };
    }
  }

  /**
   * 获取安全建议
   */
  private static getSuggestions(language: string, riskLevel: string): string[] {
    if (riskLevel === 'safe') return [];

    const suggestions: string[] = [];

    if (riskLevel === 'high') {
      suggestions.push('⚠️ 建议：在容器模式下执行（启用 container.enabled）');
      suggestions.push('⚠️ 建议：禁用网络访问（networkMode: none）');
      suggestions.push('⚠️ 建议：仔细审查脚本内容');
    }

    if (language === 'python') {
      suggestions.push('💡 提示：使用 numpy、pandas 等数据处理库是安全的');
      suggestions.push('💡 提示：避免使用 subprocess、socket 等系统模块');
    }

    if (language === 'nodejs') {
      suggestions.push('💡 提示：使用 lodash、moment 等工具库是安全的');
      suggestions.push('💡 提示：避免使用 child_process、net 等系统模块');
    }

    if (language === 'shell') {
      suggestions.push('💡 提示：使用 ls、cat、grep 等基本命令是安全的');
      suggestions.push('💡 提示：避免使用 curl、wget、docker 等网络/系统命令');
    }

    return suggestions;
  }
}
