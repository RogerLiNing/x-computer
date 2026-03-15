/**
 * Baileys 7.0.0-rc.9 平台修复脚本
 * 修复 WhatsApp 要求 MACOS 平台的问题
 * 
 * 运行: node patch-baileys.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetFile = path.join(__dirname, '../node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js');

console.log('🔧 Baileys 平台修复脚本');
console.log('目标文件:', targetFile);

try {
  if (!fs.existsSync(targetFile)) {
    console.error('❌ 文件不存在:', targetFile);
    process.exit(1);
  }

  // 备份
  const backupFile = targetFile + '.backup';
  if (!fs.existsSync(backupFile)) {
    fs.copyFileSync(targetFile, backupFile);
    console.log('✅ 已备份原文件');
  }

  // 读取内容
  let content = fs.readFileSync(targetFile, 'utf8');

  // 检查是否已经修复
  if (content.includes('Platform.MACOS')) {
    console.log('✅ 已经修复过了，无需重复操作');
    process.exit(0);
  }

  // 修复：WEB -> MACOS
  const before = content;
  content = content.replace(
    /platform: proto\.ClientPayload\.UserAgent\.Platform\.WEB,/g,
    'platform: proto.ClientPayload.UserAgent.Platform.MACOS,'
  );

  if (content === before) {
    console.error('❌ 未找到需要修复的代码');
    process.exit(1);
  }

  // 写入
  fs.writeFileSync(targetFile, content, 'utf8');
  console.log('✅ 修复完成！');
  console.log('   WEB -> MACOS');
  console.log('\n现在可以重启服务器测试 WhatsApp 连接了');

} catch (error) {
  console.error('❌ 修复失败:', error.message);
  process.exit(1);
}
