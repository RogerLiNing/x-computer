/**
 * 测试配置加载功能
 */

import { loadDefaultConfig } from './src/config/defaultConfig.js';

console.log('\n=== 测试配置加载 ===\n');

try {
  const config = loadDefaultConfig();
  
  console.log('✅ 配置加载成功\n');
  
  // 1. LLM 配置
  console.log('1. LLM 配置:');
  if (config.llm_config?.providers) {
    console.log(`   提供商数量: ${config.llm_config.providers.length}`);
    config.llm_config.providers.forEach((p, i) => {
      console.log(`   [${i + 1}] ${p.name} (${p.id})`);
      console.log(`       baseUrl: ${p.baseUrl || '(未设置)'}`);
      console.log(`       apiKey: ${p.apiKey ? (p.apiKey.includes('{env:') ? p.apiKey : '***已设置***') : '(未设置)'}`);
    });
  } else {
    console.log('   ⚠️  未配置 LLM 提供商');
  }
  console.log('');
  
  // 2. 认证配置
  console.log('2. 认证配置:');
  console.log(`   allowRegister: ${config.auth?.allowRegister ?? '(默认: true)'}`);
  console.log(`   allowAnonymous: ${config.auth?.allowAnonymous ?? '(默认: true)'}`);
  console.log('');
  
  // 3. 容器配置
  console.log('3. 容器配置:');
  console.log(`   enabled: ${config.container?.enabled ?? '(默认: false)'}`);
  console.log(`   cpuLimit: ${config.container?.cpuLimit ?? '(默认: 1)'}`);
  console.log(`   memoryLimit: ${config.container?.memoryLimit ?? '(默认: 512m)'}`);
  console.log(`   pidsLimit: ${config.container?.pidsLimit ?? '(默认: 100)'}`);
  console.log(`   networkMode: ${config.container?.networkMode ?? '(默认: none)'}`);
  console.log(`   idleTimeout: ${config.container?.idleTimeout ?? '(默认: 300000)'} ms`);
  console.log(`   maxIdleTime: ${config.container?.maxIdleTime ?? '(默认: 86400000)'} ms`);
  console.log('');
  
  // 4. 工具加载模式
  console.log('4. 工具加载模式:');
  console.log(`   tool_loading_mode: ${config.tool_loading_mode ?? '(默认: all)'}`);
  console.log('');
  
  // 5. 完整配置（JSON）
  console.log('5. 完整配置（JSON）:');
  console.log(JSON.stringify(config, null, 2));
  console.log('');
  
  console.log('✅ 所有配置项加载正常\n');
  
  // 6. 验证容器配置
  if (config.container?.enabled) {
    console.log('⚠️  注意：容器隔离已启用');
    console.log('   确保 Docker 已运行且沙箱镜像已构建');
    console.log('   运行: docker images | grep x-computer-sandbox\n');
  } else {
    console.log('💡 提示：容器隔离未启用（开发模式）');
    console.log('   要启用容器隔离，请在配置中设置:');
    console.log('   { "container": { "enabled": true } }\n');
  }
  
} catch (error) {
  console.error('\n❌ 配置加载失败:', error instanceof Error ? error.message : error);
  console.error('\n可能的原因:');
  console.error('1. 配置文件不存在');
  console.error('2. JSON 格式错误');
  console.error('3. 环境变量占位符未解析');
  console.error('\n配置文件查找顺序:');
  console.error('1. X_COMPUTER_CONFIG_PATH 环境变量');
  console.error('2. $X_COMPUTER_WORKSPACE/.x-config.json');
  console.error('3. ~/.x-computer/.x-config.json');
  console.error('4. process.cwd()/.x-config.json');
  console.error('5. process.cwd()/server/.x-config.json');
  process.exit(1);
}
