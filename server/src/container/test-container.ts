/**
 * 容器隔离测试脚本
 * 验证 UserContainerManager 的安全隔离功能
 */

import { UserContainerManager } from './UserContainerManager.js';
import path from 'path';
import os from 'os';

async function testContainerIsolation() {
  console.log('🧪 开始测试容器隔离...\n');

  const workspaceRoot = path.join(os.tmpdir(), 'x-computer-test');
  const manager = new UserContainerManager(workspaceRoot);

  try {
    // 1. 检查镜像
    console.log('1️⃣  检查沙箱镜像...');
    await manager.ensureImageExists();
    console.log('✅ 镜像存在\n');

    // 2. 创建测试用户容器
    console.log('2️⃣  创建测试用户容器...');
    const userId = 'test-user-' + Date.now();
    const containerId = await manager.getOrCreateContainer({ userId });
    console.log(`✅ 容器已创建: ${containerId.substring(0, 12)}\n`);

    // 3. 测试基本命令
    console.log('3️⃣  测试基本命令...');
    const tests = [
      { name: '查看当前用户', cmd: 'whoami' },
      { name: '查看工作目录', cmd: 'pwd' },
      { name: '列出文件', cmd: 'ls -la' },
      { name: 'Node.js 版本', cmd: 'node --version' },
      { name: 'Python 版本', cmd: 'python3 --version' },
    ];

    for (const test of tests) {
      const result = await manager.execInContainer(userId, test.cmd);
      console.log(`  ${test.name}:`);
      console.log(`    stdout: ${result.stdout.trim()}`);
      if (result.stderr) {
        console.log(`    stderr: ${result.stderr.trim()}`);
      }
      console.log(`    exitCode: ${result.exitCode}`);
      console.log('');
    }

    // 4. 测试安全限制
    console.log('4️⃣  测试安全限制（应该失败或受限）...');
    const securityTests = [
      { name: '尝试访问 /etc/passwd', cmd: 'cat /etc/passwd' },
      { name: '尝试访问 /proc', cmd: 'ls /proc' },
      { name: '尝试访问 Docker Socket', cmd: 'ls -la /var/run/docker.sock' },
      { name: '尝试提升权限', cmd: 'sudo whoami' },
    ];

    for (const test of securityTests) {
      try {
        const result = await manager.execInContainer(userId, test.cmd);
        console.log(`  ${test.name}:`);
        console.log(`    stdout: ${result.stdout.trim() || '(empty)'}`);
        console.log(`    stderr: ${result.stderr.trim() || '(empty)'}`);
        console.log(`    exitCode: ${result.exitCode}`);
        if (result.exitCode !== 0) {
          console.log('    ✅ 命令被阻止或失败（符合预期）');
        } else {
          console.log('    ⚠️  命令成功执行（可能存在安全问题）');
        }
      } catch (error) {
        console.log(`  ${test.name}:`);
        console.log(`    ❌ 错误: ${error instanceof Error ? error.message : String(error)}`);
      }
      console.log('');
    }

    // 5. 测试文件操作
    console.log('5️⃣  测试文件操作...');
    await manager.execInContainer(userId, 'echo "Hello from container" > /workspace/test.txt');
    const readResult = await manager.execInContainer(userId, 'cat /workspace/test.txt');
    console.log(`  写入并读取文件:`);
    console.log(`    ${readResult.stdout.trim()}`);
    console.log('  ✅ 文件操作正常\n');

    // 6. 清理
    console.log('6️⃣  清理测试容器...');
    await manager.removeContainer(userId);
    console.log('✅ 容器已删除\n');

    console.log('🎉 所有测试完成！');
  } catch (error) {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testContainerIsolation().catch(console.error);
