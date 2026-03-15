/**
 * SensitiveFilter - 敏感信息过滤器
 * 
 * 防止 X 泄露 API Key、密码、Token 等敏感信息。
 * 
 * 使用场景：
 * - file.read 读取配置文件时
 * - X 返回内容给用户时
 * - 日志输出时
 */

export interface FilterResult {
  filtered: string;
  redactedCount: number;
  patterns: string[];
}

export class SensitiveFilter {
  // 敏感信息模式
  private static PATTERNS = [
    {
      name: 'API Key',
      pattern: /(['"]?)(api[_-]?key|apikey)(['"]?\s*[=:]\s*['"]?)([a-zA-Z0-9_-]{20,})(['"]?)/gi,
      replacement: '$1$2$3[REDACTED]$5',
    },
    {
      name: 'Password',
      pattern: /(['"]?)(password|passwd|pwd)(['"]?\s*[=:]\s*['"]?)([^'"\s]{6,})(['"]?)/gi,
      replacement: '$1$2$3[REDACTED]$5',
    },
    {
      name: 'Secret',
      pattern: /(['"]?)(secret|secret_key)(['"]?\s*[=:]\s*['"]?)([a-zA-Z0-9_-]{20,})(['"]?)/gi,
      replacement: '$1$2$3[REDACTED]$5',
    },
    {
      name: 'Token',
      pattern: /(['"]?)(token|access_token|auth_token)(['"]?\s*[=:]\s*['"]?)([a-zA-Z0-9_.-]{20,})(['"]?)/gi,
      replacement: '$1$2$3[REDACTED]$5',
    },
    {
      name: 'Bearer Token',
      pattern: /(Bearer\s+)([a-zA-Z0-9_.-]{20,})/gi,
      replacement: '$1[REDACTED]',
    },
    {
      name: 'OpenAI Key',
      pattern: /sk-[a-zA-Z0-9]{20,}/g,
      replacement: 'sk-[REDACTED]',
    },
    {
      name: 'AWS Key',
      pattern: /AKIA[0-9A-Z]{16}/g,
      replacement: 'AKIA[REDACTED]',
    },
    {
      name: 'Private Key',
      pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC )?PRIVATE KEY-----/g,
      replacement: '-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----',
    },
    {
      name: 'JWT',
      pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
      replacement: 'eyJ[REDACTED].eyJ[REDACTED].[REDACTED]',
    },
    {
      name: 'Database URL',
      pattern: /(mongodb|mysql|postgresql|redis):\/\/([^:]+):([^@]+)@/gi,
      replacement: '$1://[USER]:[REDACTED]@',
    },
  ];

  /**
   * 过滤文本中的敏感信息
   */
  static filter(text: string): FilterResult {
    let filtered = text;
    let redactedCount = 0;
    const patterns: string[] = [];

    for (const { name, pattern, replacement } of this.PATTERNS) {
      const before = filtered;
      filtered = filtered.replace(pattern, replacement);
      
      if (filtered !== before) {
        redactedCount++;
        patterns.push(name);
      }
    }

    return {
      filtered,
      redactedCount,
      patterns,
    };
  }

  /**
   * 检查文本是否包含敏感信息
   */
  static containsSensitive(text: string): boolean {
    for (const { pattern } of this.PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 过滤对象中的敏感信息（递归）
   */
  static filterObject(obj: any): any {
    if (typeof obj === 'string') {
      return this.filter(obj).filtered;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.filterObject(item));
    }
    
    if (obj && typeof obj === 'object') {
      const filtered: any = {};
      for (const [key, value] of Object.entries(obj)) {
        // 敏感字段名直接替换值
        if (/api[_-]?key|password|secret|token|credential/i.test(key)) {
          filtered[key] = '[REDACTED]';
        } else {
          filtered[key] = this.filterObject(value);
        }
      }
      return filtered;
    }
    
    return obj;
  }
}
