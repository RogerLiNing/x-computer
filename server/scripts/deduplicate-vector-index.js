#!/usr/bin/env node
/**
 * 向量索引去重脚本
 * 用途：清理 .vector_index*.json 中的重复条目
 * 
 * 使用方法：
 *   node scripts/deduplicate-vector-index.js <索引文件路径>
 * 
 * 例如：
 *   node scripts/deduplicate-vector-index.js /tmp/x-computer-workspace/memory/.vector_index_a99b05d7-6a0f-48ae-8eac-4a9e28b9b4ec.json
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

async function deduplicateVectorIndex(filePath) {
  console.log(`正在处理文件: ${filePath}`);
  
  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    console.error(`错误: 文件不存在 ${filePath}`);
    process.exit(1);
  }

  // 读取文件内容（按行读取，因为文件是 NDJSON 格式）
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const entries = [];
  const seen = new Map(); // 用于检测重复：key = text, value = 首次出现的索引
  let lineNumber = 0;
  let duplicateCount = 0;

  for await (const line of rl) {
    lineNumber++;
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);
      const text = entry.text || '';
      
      if (seen.has(text)) {
        // 发现重复
        duplicateCount++;
        const firstIndex = seen.get(text);
        console.log(`[重复] 第 ${lineNumber} 行与第 ${firstIndex + 1} 行重复`);
        console.log(`  文本前100字符: ${text.substring(0, 100)}...`);
        // 跳过重复条目
        continue;
      }
      
      // 记录并保留
      seen.set(text, entries.length);
      entries.push(entry);
    } catch (err) {
      console.error(`警告: 第 ${lineNumber} 行解析失败: ${err.message}`);
    }
  }

  console.log(`\n统计信息:`);
  console.log(`  原始条目数: ${lineNumber}`);
  console.log(`  去重后条目数: ${entries.length}`);
  console.log(`  删除重复数: ${duplicateCount}`);

  if (duplicateCount === 0) {
    console.log('\n✅ 没有发现重复条目，无需处理');
    return;
  }

  // 备份原文件
  const backupPath = `${filePath}.backup.${Date.now()}`;
  console.log(`\n备份原文件到: ${backupPath}`);
  fs.copyFileSync(filePath, backupPath);

  // 写入去重后的数据（NDJSON 格式：每行一个 JSON 对象）
  console.log(`写入去重后的数据...`);
  const output = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(filePath, output, 'utf8');

  console.log(`\n✅ 去重完成！`);
  console.log(`   已保存到: ${filePath}`);
  console.log(`   备份文件: ${backupPath}`);
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('用法: node deduplicate-vector-index.js <索引文件路径>');
    console.log('');
    console.log('示例:');
    console.log('  node scripts/deduplicate-vector-index.js /tmp/x-computer-workspace/memory/.vector_index_xxx.json');
    process.exit(1);
  }

  const filePath = args[0];
  await deduplicateVectorIndex(filePath);
}

main().catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
