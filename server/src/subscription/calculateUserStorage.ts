/**
 * 计算用户存储使用量的工具函数
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * 递归计算目录总大小
 */
export async function calculateDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      try {
        if (entry.isDirectory()) {
          totalSize += await calculateDirectorySize(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          totalSize += stat.size;
        }
      } catch (err) {
        // 忽略单个文件/目录的错误
        console.error(`[Storage] Failed to stat ${fullPath}:`, err);
      }
    }
  } catch (err) {
    // 目录不存在或无法访问
    console.error(`[Storage] Failed to read directory ${dirPath}:`, err);
  }
  
  return totalSize;
}

/**
 * 计算用户工作区的总存储使用量
 */
export async function calculateUserStorage(userWorkspaceRoot: string): Promise<number> {
  try {
    await fs.access(userWorkspaceRoot);
    return await calculateDirectorySize(userWorkspaceRoot);
  } catch {
    // 用户工作区不存在
    return 0;
  }
}
