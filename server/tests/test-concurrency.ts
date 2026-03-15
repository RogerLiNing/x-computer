/**
 * 并发性能测试
 * 模拟多用户同时发送请求
 */

import http from 'http';

const BASE_URL = 'http://localhost:4000';
const TEST_USER_ID = 'a99b05d7-6a0f-48ae-8eac-4a9e28b9b4ec';

interface TestResult {
  success: number;
  failed: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  errors: string[];
}

/**
 * 发送单个请求
 */
async function sendRequest(endpoint: string, method: string = 'GET', body?: any): Promise<{ time: number; success: boolean; error?: string }> {
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const url = new URL(endpoint, BASE_URL);
    const options: http.RequestOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': TEST_USER_ID,
      },
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const time = Date.now() - startTime;
        const success = res.statusCode! >= 200 && res.statusCode! < 300;
        resolve({ 
          time, 
          success, 
          error: success ? undefined : `${res.statusCode}: ${data.substring(0, 100)}` 
        });
      });
    });

    req.on('error', (err) => {
      resolve({ 
        time: Date.now() - startTime, 
        success: false, 
        error: err.message 
      });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * 并发测试
 */
async function runConcurrencyTest(
  name: string,
  endpoint: string,
  concurrency: number,
  method: string = 'GET',
  body?: any
): Promise<TestResult> {
  console.log(`\n📊 测试: ${name}`);
  console.log(`   并发数: ${concurrency}`);
  console.log(`   端点: ${endpoint}`);
  
  const startTime = Date.now();
  const promises: Promise<{ time: number; success: boolean; error?: string }>[] = [];
  
  // 发送并发请求
  for (let i = 0; i < concurrency; i++) {
    promises.push(sendRequest(endpoint, method, body));
  }
  
  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;
  
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const times = results.map(r => r.time);
  const errors = results.filter(r => r.error).map(r => r.error!);
  
  const result: TestResult = {
    success,
    failed,
    totalTime,
    avgTime: times.reduce((a, b) => a + b, 0) / times.length,
    minTime: Math.min(...times),
    maxTime: Math.max(...times),
    errors: errors.slice(0, 5),  // 只显示前 5 个错误
  };
  
  console.log(`   ✅ 成功: ${success}/${concurrency}`);
  console.log(`   ❌ 失败: ${failed}/${concurrency}`);
  console.log(`   ⏱️  总耗时: ${totalTime}ms`);
  console.log(`   ⏱️  平均响应: ${result.avgTime.toFixed(0)}ms`);
  console.log(`   ⏱️  最快: ${result.minTime}ms`);
  console.log(`   ⏱️  最慢: ${result.maxTime}ms`);
  
  if (errors.length > 0) {
    console.log(`   ⚠️  错误示例:`);
    errors.forEach(err => console.log(`      - ${err}`));
  }
  
  return result;
}

/**
 * 主测试流程
 */
async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║        X-Computer 并发性能测试                    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  
  // 等待服务器启动
  console.log('\n⏳ 等待服务器启动...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // 测试 1：轻量级端点（订阅信息查询）
  await runConcurrencyTest(
    '订阅信息查询',
    '/api/subscriptions/me',
    10,
    'GET'
  );
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 测试 2：中等负载（AI 调用）
  await runConcurrencyTest(
    'AI 聊天请求',
    '/api/chat',
    5,
    'POST',
    {
      messages: [{ role: 'user', content: '你好' }],
      providerId: 'openrouter',
      modelId: 'anthropic/claude-3.5-sonnet',
    }
  );
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 测试 3：重量级端点（任务创建）
  await runConcurrencyTest(
    '任务创建',
    '/api/tasks',
    3,
    'POST',
    {
      domain: 'code',
      title: '性能测试任务',
      description: '这是一个性能测试任务',
    }
  );
  
  console.log('\n✅ 所有测试完成\n');
}

main().catch(console.error);
