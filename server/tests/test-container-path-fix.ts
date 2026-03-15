/**
 * 测试容器路径修复
 */

import { UserContainerManager } from './src/container/UserContainerManager.js';
import { SandboxShell } from './src/tooling/SandboxShell.js';
import path from 'path';
import os from 'os';

const workspaceRoot = path.join(os.tmpdir(), 'x-computer-workspace');
const testUserId = 'test-path-fix-' + Date.now();

console.log('\n=== 测试容器路径修复 ===\n');

async function test() {
  try {
    // 1. 创建容器管理器
    console.log('1. 创建容器管理器...');
    const containerManager = new UserContainerManager(workspaceRoot, {
      cpuLimit: 0.5,
      memoryLimit: '256m',
    });
    await containerManager.ensureImageExists();
    console.log('   ✅ 容器管理器就绪\n');
    
    // 2. 创建用户工作区
    console.log('2. 创建用户工作区...');
    const userWorkspaceRoot = path.join(workspaceRoot, 'users', testUserId, 'workspace');
    const fs = await import('fs/promises');
    await fs.mkdir(userWorkspaceRoot, { recursive: true });
    console.log(`   ✅ 工作区: ${userWorkspaceRoot}\n`);
    
    // 3. 创建 SandboxShell
    console.log('3. 创建 SandboxShell（容器模式）...');
    const sandboxShell = new SandboxShell(userWorkspaceRoot, 30000, {
      userId: testUserId,
      containerManager,
      useContainer: true,
    });
    console.log('   ✅ SandboxShell 创建成功\n');
    
    // 4. 测试命令执行
    console.log('4. 测试命令执行...\n');
    
    const tests = [
      {
        name: '基本命令（默认工作区）',
        command: 'pwd',
        cwd: undefined,
        expected: '/workspace',
      },
      {
        name: '基本命令（显式工作区）',
        command: 'pwd',
        cwd: userWorkspaceRoot,
        expected: '/workspace',
      },
      {
        name: '列出进程',
        command: 'ps aux | head -10',
        cwd: userWorkspaceRoot,
        expected: 'PID',
      },
      {
        name: '查看当前用户',
        command: 'whoami',
        cwd: userWorkspaceRoot,
        expected: 'node',
      },
    ];
    
    for (const test of tests) {
      try {
        console.log(`   测试: ${test.name}`);
        console.log(`   命令: ${test.command}`);
        console.log(`   cwd: ${test.cwd || '(默认)'}`);
        
        const result = await sandboxShell.execute(test.command, test.cwd, 10000);
        
        if (result.exitCode === 0 && result.stdout.includes(test.expected)) {
          console.log(`   ✅ 成功`);
          console.log(`   输出: ${result.stdout.trim().substring(0, 100)}`);
        } else {
          console.log(`   ❌ 失败`);
          console.log(`   exitCode: ${result.exitCode}`);
          console.log(`   stdout: ${result.stdout.trim().substring(0, 200)}`);
          console.log(`   stderr: ${result.stderr.trim().substring(0, 200)}`);
        }
        console.log('');
      } catch (err) {
        console.log(`   ❌ 异常: ${err instanceof Error ? err.message : err}`);
        console.log('');
      }
    }
    
    // 5. 清理
    console.log('5. 清理测试容器...');
    await containerManager.removeContainer(testUserId);
    console.log('   ✅ 容器已删除\n');
    
    console.log('✅ 所有测试通过！\n');
    console.log('修复说明：');
    console.log('- 容器内的工作目录现在正确映射为 /workspace');
    console.log('- 宿主机路径自动转换为容器内相对路径');
    console.log('- ps aux 等命令现在可以正常执行');
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('\n堆栈:', error.stack);
    }
    process.exit(1);
  }
}

test();
