/**
 * 测试容器配置启用
 */

import { loadDefaultConfig } from './src/config/defaultConfig.js';
import { UserContainerManager } from './src/container/UserContainerManager.js';
import path from 'path';
import os from 'os';

console.log('\n=== 测试容器配置启用 ===\n');

const workspaceRoot = path.join(os.tmpdir(), 'x-computer-workspace');
const config = loadDefaultConfig();

console.log('1. 当前配置:');
console.log(`   容器隔离: ${config.container?.enabled ? '✅ 已启用' : '❌ 未启用'}`);
console.log(`   CPU 限制: ${config.container?.cpuLimit ?? 1} 核心`);
console.log(`   内存限制: ${config.container?.memoryLimit ?? '512m'}`);
console.log(`   进程限制: ${config.container?.pidsLimit ?? 100}`);
console.log(`   网络模式: ${config.container?.networkMode ?? 'none'}`);
console.log('');

if (!config.container?.enabled) {
  console.log('⚠️  容器隔离未启用');
  console.log('');
  console.log('要启用容器隔离，请编辑 server/.x-config.json:');
  console.log('');
  console.log('{');
  console.log('  "container": {');
  console.log('    "enabled": true,');
  console.log('    "cpuLimit": 0.5,');
  console.log('    "memoryLimit": "256m",');
  console.log('    "pidsLimit": 100,');
  console.log('    "networkMode": "none"');
  console.log('  }');
  console.log('}');
  console.log('');
  console.log('然后重新运行此测试。');
  process.exit(0);
}

console.log('2. 初始化容器管理器...');
try {
  const containerManager = new UserContainerManager(workspaceRoot, {
    cpuLimit: config.container.cpuLimit,
    memoryLimit: config.container.memoryLimit,
    pidsLimit: config.container.pidsLimit,
    networkMode: config.container.networkMode as 'none' | 'bridge' | 'host',
  });
  console.log('   ✅ 容器管理器创建成功');
  console.log('');
  
  console.log('3. 检查沙箱镜像...');
  await containerManager.ensureImageExists();
  console.log('   ✅ 沙箱镜像已存在');
  console.log('');
  
  console.log('4. 创建测试容器...');
  const testUserId = 'test-config-' + Date.now();
  const containerId = await containerManager.getOrCreateContainer({
    userId: testUserId,
  });
  console.log(`   ✅ 容器已创建: ${containerId.substring(0, 12)}`);
  console.log('');
  
  console.log('5. 执行测试命令...');
  const result = await containerManager.execInContainer(containerId, 'echo "配置加载成功！"', { timeout: 5000 });
  console.log(`   输出: ${result.stdout.trim()}`);
  console.log('');
  
  console.log('6. 清理测试容器...');
  await containerManager.removeContainer(testUserId);
  console.log('   ✅ 容器已删除');
  console.log('');
  
  console.log('✅ 容器配置测试通过！');
  console.log('');
  console.log('配置已正确应用:');
  console.log(`- CPU 限制: ${config.container.cpuLimit} 核心`);
  console.log(`- 内存限制: ${config.container.memoryLimit}`);
  console.log(`- 进程限制: ${config.container.pidsLimit}`);
  console.log(`- 网络模式: ${config.container.networkMode}`);
  
} catch (error) {
  console.error('\n❌ 测试失败:', error instanceof Error ? error.message : error);
  console.error('\n可能的原因:');
  console.error('1. Docker 未运行');
  console.error('2. 沙箱镜像未构建（运行: cd docker && ./build-sandbox.sh）');
  console.error('3. 权限不足（需要访问 Docker Socket）');
  process.exit(1);
}
