# 向量索引重复问题修复

**问题发现日期**：2026-02-28  
**修复状态**：✅ 已修复  
**影响范围**：记忆向量索引（`.vector_index*.json`）

## 问题描述

用户报告 Memory 文件中有大量重复内容。经排查发现，向量索引文件（`memory/.vector_index_<workspaceId>.json`）中存在重复条目。

### 具体表现

- 向量索引文件中同一条记忆被重复存储多次
- 例如：某用户的索引文件有 6 条记录，其中 5 条是重复的
- 重复内容包括系统提示词、用户记忆等

### 重复统计示例

```
"# AI 助手专用说明..." - 出现 3 次
"# 身份\n你是 X-Computer 的主脑..." - 出现 2 次
```

## 根本原因

问题出在 `server/src/memory/vectorStore.ts` 的 `save()` 方法：

```typescript
// 错误代码（修复前）
private async save(workspaceId?: string): Promise<void> {
  const key = this.getWorkspaceKey(workspaceId);
  const entries = this.entriesByWorkspace.get(key) ?? [];
  const path = getIndexPath(workspaceId);
  await this.fs.write(path, JSON.stringify({ entries }));  // ❌ 问题在这里
}
```

**原因分析**：

1. `SandboxFS.write()` 方法在文件已存在时会使用 `appendFile` **追加**内容
2. 每次保存向量索引时，新内容被追加到文件末尾，而不是覆盖原有内容
3. 随着时间推移，同一条记忆被反复追加，造成大量重复

## 解决方案

### 1. 修复代码

将 `write()` 改为 `writeOverwrite()`：

```typescript
// 修复后的代码
private async save(workspaceId?: string): Promise<void> {
  const key = this.getWorkspaceKey(workspaceId);
  const entries = this.entriesByWorkspace.get(key) ?? [];
  const path = getIndexPath(workspaceId);
  await this.fs.writeOverwrite(path, JSON.stringify({ entries }));  // ✅ 使用 writeOverwrite
}
```

**修改文件**：`server/src/memory/vectorStore.ts` 第 116 行

### 2. 清理现有重复数据

提供了去重脚本 `server/scripts/deduplicate-vector-index.js`：

```bash
node scripts/deduplicate-vector-index.js <索引文件路径>
```

**功能**：
- 自动检测并删除重复条目（基于 `text` 字段）
- 自动备份原文件（`.backup.<timestamp>`）
- 输出详细的去重统计信息

**使用示例**：

```bash
cd server
node scripts/deduplicate-vector-index.js \
  /var/folders/.../x-computer-workspace/memory/.vector_index_xxx.json
```

**输出示例**：

```
正在处理文件: .../memory/.vector_index_xxx.json
[重复] 第 2 行与第 1 行重复
[重复] 第 3 行与第 1 行重复
...

统计信息:
  原始条目数: 6
  去重后条目数: 1
  删除重复数: 5

✅ 去重完成！
   已保存到: .../memory/.vector_index_xxx.json
   备份文件: .../memory/.vector_index_xxx.json.backup.1772269169800
```

### 3. 测试验证

新增测试文件 `server/src/memory/vectorStore.test.ts`：

- 测试多次保存不会产生重复
- 验证使用 `writeOverwrite` 而非追加
- 确保 JSON 格式正确（单个对象，非 NDJSON）

运行测试：

```bash
cd server
npm run test -- vectorStore.test.ts
```

## 影响评估

### 受影响的功能

- ✅ 记忆向量搜索（`memory_search` 工具）
- ✅ 记忆嵌入（`memory_embed_add` 工具）
- ✅ 混合检索（向量 + 关键词）

### 用户影响

- **性能影响**：重复条目会降低搜索效率，增加文件大小
- **准确性影响**：重复条目可能影响搜索结果的相关性排序
- **存储影响**：浪费磁盘空间

### 修复后效果

- ✅ 不再产生新的重复条目
- ✅ 向量索引文件大小显著减小
- ✅ 搜索性能提升
- ✅ 搜索结果更准确

## 预防措施

### 代码审查要点

在涉及文件保存的代码中，明确区分：

- **追加内容**：使用 `write()` 或 `appendFile()`
  - 适用场景：日志文件、聊天记录、Daily Notes
  
- **覆盖内容**：使用 `writeOverwrite()`
  - 适用场景：索引文件、配置文件、状态文件

### 相关文件检查

已检查以下文件，确认使用正确的方法：

- ✅ `vectorStore.ts` - 已修复为 `writeOverwrite()`
- ✅ `MemoryService.ts` - 正确使用 `write()` 追加 Daily Notes
- ✅ 其他索引/状态文件 - 待审查

## 后续工作

- [ ] 审查所有使用 `SandboxFS.write()` 的地方，确认是否应该使用 `writeOverwrite()`
- [ ] 考虑在 `SandboxFS` 中添加更明确的方法名（如 `append()` vs `overwrite()`）
- [ ] 添加文件大小监控，及时发现异常增长

## 相关文件

- 修复代码：`server/src/memory/vectorStore.ts`
- 去重脚本：`server/scripts/deduplicate-vector-index.js`
- 测试文件：`server/src/memory/vectorStore.test.ts`
- 本文档：`docs/BUGFIX_VECTOR_INDEX_DUPLICATION.md`

## 总结

这是一个典型的"追加 vs 覆盖"混淆导致的 bug。修复方法简单但影响重要。通过：

1. 修改一行代码（`write` → `writeOverwrite`）
2. 提供去重脚本清理历史数据
3. 添加测试防止回归

成功解决了向量索引重复问题，提升了系统的稳定性和性能。
