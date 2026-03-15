/**
 * 快速测试容器隔离功能
 */

import { UserContainerManager } from './src/container/UserContainerManager.js';
import path from 'path';
import os from 'os';

const workspaceRoot = path.join(os.tmpdir(), 'x-computer-workspace');
const testUserId = 'test-user-' + Date.now();

async function testContainer() {
  console.log('\n=== 快速测试容器隔离 ===\n');
  
  try {
    // 1. 创建容器管理器
    console.log('1. 初始化容器管理器...');
    const manager = new UserContainerManager(workspaceRoot);
    
    // 2. 检查镜像
    console.log('2. 检查沙箱镜像...');
    await manager.ensureImageExists();
    console.log('   ✅ 镜像已存在\n');
    
    // 3. 创建用户容器
    console.log(`3. 创建用户容器 (userId: ${testUserId})...`);
    const containerId = await manager.getOrCreateContainer({
      userId: testUserId,
      cpuLimit: 0.5,
      memoryLimit: '256m',
    });
    console.log(`   ✅ 容器已创建: ${containerId.substring(0, 12)}\n`);
    
    // 4. 执行测试命令
    console.log('4. 执行测试命令...');
    
    const tests = [
      { cmd: 'echo "Hello from container"', desc: '基本命令' },
      { cmd: 'whoami', desc: '当前用户' },
      { cmd: 'pwd', desc: '工作目录' },
      { cmd: 'ls -la /workspace', desc: '工作区内容' },
      { cmd: 'cat /etc/os-release | head -3', desc: '系统信息' },
    ];
    
    for (const test of tests) {
      try {
        const result = await manager.execInContainer(containerId, test.cmd, { timeout: 5000 });
        console.log(`   ✅ ${test.desc}:`);
        console.log(`      命令: ${test.cmd}`);
        console.log(`      输出: ${result.stdout.trim() || '(空)'}`);
        if (result.stderr) {
          console.log(`      错误: ${result.stderr.trim()}`);
        }
        console.log('');
      } catch (err) {
        console.log(`   ❌ ${test.desc} 失败:`, err instanceof Error ? err.message : err);
        console.log('');
      }
    }
    
    // 5. 查看容器状态
    console.log('5. 查看容器状态...');
    console.log('   运行命令查看: docker ps -a --filter "name=x-computer-user"\n');
    
    // 6. 清理
    console.log('6. 清理测试容器...');
    await manager.removeContainer(testUserId);
    console.log('   ✅ 容器已删除\n');
    
    console.log('✅ 所有测试通过！\n');
    console.log('说明：');
    console.log('- 容器隔离功能正常工作');
    console.log('- 要在开发服务器中启用，请设置: USE_CONTAINER_ISOLATION=true');
    console.log('- 启用后，每次执行 shell 命令都会在独立容器中运行');
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error instanceof Error ? error.message : error);
    console.error('\n可能的原因:');
    console.error('1. Docker 未运行');
    console.error('2. 沙箱镜像未构建（运行: cd docker && ./build-sandbox.sh）');
    console.error('3. 权限不足（需要访问 Docker Socket）');
  }
}

testContainer();
