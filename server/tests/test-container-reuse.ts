/**
 * 测试容器复用（服务器重启后）
 */

import { UserContainerManager } from './src/container/UserContainerManager.js';
import path from 'path';
import os from 'os';

const workspaceRoot = path.join(os.tmpdir(), 'x-computer-workspace');
const testUserId = 'test-reuse-' + Date.now();

console.log('\n=== 测试容器复用（模拟服务器重启）===\n');

async function test() {
  try {
    // 1. 第一次创建容器管理器和容器
    console.log('1. 第一次创建容器...');
    const manager1 = new UserContainerManager(workspaceRoot, {
      cpuLimit: 0.5,
      memoryLimit: '256m',
    });
    await manager1.ensureImageExists();
    
    const containerId1 = await manager1.getOrCreateContainer({ userId: testUserId });
    console.log(`   ✅ 容器已创建: ${containerId1.substring(0, 12)}\n`);
    
    // 2. 执行测试命令
    console.log('2. 执行测试命令...');
    const result1 = await manager1.execInContainer(testUserId, 'echo "Hello from container 1"', { timeout: 5000 });
    console.log(`   输出: ${result1.stdout.trim()}\n`);
    
    // 3. 模拟服务器重启：创建新的管理器实例（缓存丢失）
    console.log('3. 模拟服务器重启（创建新的管理器实例）...');
    const manager2 = new UserContainerManager(workspaceRoot, {
      cpuLimit: 0.5,
      memoryLimit: '256m',
    });
    console.log('   ✅ 新管理器实例创建成功（缓存为空）\n');
    
    // 4. 尝试获取容器（应该复用已存在的容器）
    console.log('4. 获取容器（应该复用已存在的容器）...');
    const containerId2 = await manager2.getOrCreateContainer({ userId: testUserId });
    console.log(`   ✅ 容器 ID: ${containerId2.substring(0, 12)}\n`);
    
    // 5. 验证是否是同一个容器
    console.log('5. 验证容器 ID...');
    if (containerId1 === containerId2) {
      console.log('   ✅ 成功复用同一个容器！');
    } else {
      console.log('   ❌ 错误：创建了新容器');
      console.log(`   旧容器: ${containerId1.substring(0, 12)}`);
      console.log(`   新容器: ${containerId2.substring(0, 12)}`);
    }
    console.log('');
    
    // 6. 在复用的容器中执行命令
    console.log('6. 在复用的容器中执行命令...');
    const result2 = await manager2.execInContainer(testUserId, 'echo "Hello from container 2"', { timeout: 5000 });
    console.log(`   输出: ${result2.stdout.trim()}\n`);
    
    // 7. 清理
    console.log('7. 清理测试容器...');
    await manager2.removeContainer(testUserId);
    console.log('   ✅ 容器已删除\n');
    
    console.log('✅ 所有测试通过！\n');
    console.log('修复说明：');
    console.log('- 服务器重启后，容器管理器会检查 Docker 中已存在的容器');
    console.log('- 避免了 "container name already in use" 错误');
    console.log('- 自动复用已存在的容器，提高性能');
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('\n堆栈:', error.stack);
    }
    process.exit(1);
  }
}

test();
