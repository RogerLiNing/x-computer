/**
 * Docker 任务执行器集成示例
 * 展示如何在 ToolExecutor 中集成 DockerTaskRunner
 */

import { DockerTaskRunner } from './DockerTaskRunner.js';

/**
 * 工具定义示例
 */
export const dockerTools = {
  /**
   * 执行 Node.js 代码
   */
  execute_nodejs: {
    name: 'execute_nodejs',
    description: '在隔离的 Docker 容器中执行 Node.js 代码',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要执行的 Node.js 代码',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 60000',
        },
        env: {
          type: 'object',
          description: '环境变量',
        },
      },
      required: ['code'],
    },
    handler: async (params: { code: string; timeout?: number; env?: Record<string, string> }) => {
      const runner = new DockerTaskRunner();
      const config = DockerTaskRunner.templates.nodejs(params.code, {
        timeout: params.timeout || 60000,
        env: params.env,
      });

      const result = await runner.runTask(config);

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        duration: result.duration,
      };
    },
  },

  /**
   * 执行 Python 代码
   */
  execute_python: {
    name: 'execute_python',
    description: '在隔离的 Docker 容器中执行 Python 代码',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要执行的 Python 代码',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 60000',
        },
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: '需要安装的 Python 包（如 ["requests", "pandas"]）',
        },
      },
      required: ['code'],
    },
    handler: async (params: { code: string; timeout?: number; packages?: string[] }) => {
      const runner = new DockerTaskRunner();

      // 如果需要安装包，先安装
      let script = params.code;
      if (params.packages && params.packages.length > 0) {
        const installCmd = `pip install ${params.packages.join(' ')} && `;
        script = installCmd + script;
      }

      const config = DockerTaskRunner.templates.python(script, {
        timeout: params.timeout || 60000,
      });

      const result = await runner.runTask(config);

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        duration: result.duration,
      };
    },
  },

  /**
   * 执行 Bash 脚本
   */
  execute_bash: {
    name: 'execute_bash',
    description: '在隔离的 Docker 容器中执行 Bash 脚本',
    parameters: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: '要执行的 Bash 脚本',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 60000',
        },
      },
      required: ['script'],
    },
    handler: async (params: { script: string; timeout?: number }) => {
      const runner = new DockerTaskRunner();
      const config = DockerTaskRunner.templates.bash(params.script, {
        timeout: params.timeout || 60000,
      });

      const result = await runner.runTask(config);

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        duration: result.duration,
      };
    },
  },

  /**
   * 执行自定义 Docker 任务
   */
  execute_docker_task: {
    name: 'execute_docker_task',
    description: '在指定的 Docker 镜像中执行任务',
    parameters: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description: 'Docker 镜像名称（如 "node:20-alpine", "python:3.11-slim"）',
        },
        command: {
          type: 'array',
          items: { type: 'string' },
          description: '要执行的命令数组',
        },
        script: {
          type: 'string',
          description: '要执行的脚本内容',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 60000',
        },
        memory: {
          type: 'number',
          description: '内存限制（字节），默认 512MB',
        },
        env: {
          type: 'object',
          description: '环境变量',
        },
      },
      required: ['image'],
    },
    handler: async (params: {
      image: string;
      command?: string[];
      script?: string;
      timeout?: number;
      memory?: number;
      env?: Record<string, string>;
    }) => {
      const runner = new DockerTaskRunner();
      const result = await runner.runTask({
        image: params.image,
        command: params.command,
        script: params.script,
        timeout: params.timeout || 60000,
        memory: params.memory,
        env: params.env,
      });

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        duration: result.duration,
        containerId: result.containerId,
      };
    },
  },
};

/**
 * 使用示例
 */
export async function examples() {
  // 示例 1: 执行 Node.js 代码
  console.log('=== 示例 1: Node.js ===');
  const nodejs_result = await dockerTools.execute_nodejs.handler({
    code: `
      console.log('Hello from Node.js!');
      console.log('2 + 2 =', 2 + 2);
      console.log('当前时间:', new Date().toISOString());
    `,
  });
  console.log('输出:', nodejs_result.output);

  // 示例 2: 执行 Python 代码（带包安装）
  console.log('\n=== 示例 2: Python with packages ===');
  const python_result = await dockerTools.execute_python.handler({
    code: `
import requests
import json

response = requests.get('https://api.github.com/repos/microsoft/vscode')
data = response.json()
print(f"Repository: {data['full_name']}")
print(f"Stars: {data['stargazers_count']}")
print(f"Language: {data['language']}")
    `,
    packages: ['requests'],
  });
  console.log('输出:', python_result.output);

  // 示例 3: 执行 Bash 脚本
  console.log('\n=== 示例 3: Bash ===');
  const bash_result = await dockerTools.execute_bash.handler({
    script: `
echo "系统信息:"
uname -a
echo ""
echo "磁盘使用:"
df -h | head -5
    `,
  });
  console.log('输出:', bash_result.output);

  // 示例 4: 自定义 Docker 任务（使用 TensorFlow）
  console.log('\n=== 示例 4: Custom Docker task ===');
  const custom_result = await dockerTools.execute_docker_task.handler({
    image: 'python:3.11-slim',
    script: `
import sys
import platform

print(f"Python version: {sys.version}")
print(f"Platform: {platform.platform()}")
print(f"Architecture: {platform.machine()}")
    `,
  });
  console.log('输出:', custom_result.output);
}

/**
 * AI 对话示例
 */
export const aiConversationExamples = [
  {
    user: '帮我用 Python 计算 1 到 100 的和',
    ai_action: {
      tool: 'execute_python',
      params: {
        code: `
total = sum(range(1, 101))
print(f"1 到 100 的和是: {total}")
        `,
      },
    },
    ai_response: '1 到 100 的和是: 5050',
  },
  {
    user: '检查一下系统的内存使用情况',
    ai_action: {
      tool: 'execute_bash',
      params: {
        script: `
free -h
echo ""
echo "内存使用率:"
free | grep Mem | awk '{printf "%.2f%%\\n", $3/$2 * 100}'
        `,
      },
    },
    ai_response: '当前内存使用情况：[显示内存统计]',
  },
  {
    user: '用 Node.js 生成一个随机密码',
    ai_action: {
      tool: 'execute_nodejs',
      params: {
        code: `
const crypto = require('crypto');
const length = 16;
const password = crypto.randomBytes(length).toString('base64').slice(0, length);
console.log('生成的密码:', password);
        `,
      },
    },
    ai_response: '已生成随机密码：[显示密码]',
  },
  {
    user: '帮我爬取 GitHub 上 TypeScript 仓库的信息',
    ai_action: {
      tool: 'execute_python',
      params: {
        code: `
import requests
import json

url = 'https://api.github.com/repos/microsoft/TypeScript'
response = requests.get(url)
data = response.json()

print(json.dumps({
    'name': data['full_name'],
    'description': data['description'],
    'stars': data['stargazers_count'],
    'forks': data['forks_count'],
    'language': data['language'],
    'updated_at': data['updated_at']
}, indent=2))
        `,
        packages: ['requests'],
      },
    },
    ai_response: 'TypeScript 仓库信息：[显示仓库详情]',
  },
];

// 如果直接运行此文件，执行示例
if (import.meta.url === `file://${process.argv[1]}`) {
  examples()
    .then(() => console.log('\n✅ 所有示例执行完成'))
    .catch((error) => console.error('❌ 错误:', error));
}
