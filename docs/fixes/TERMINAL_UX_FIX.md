# 终端用户体验修复

## 🐛 问题描述

用户报告终端应用存在两个体验问题：

1. **输入命令后失去焦点**：执行命令后需要手动点击才能继续输入
2. **不支持 Tab 补全**：无法使用 Tab 键补全命令和文件名

---

## ✅ 修复方案

### 1. 自动保持焦点

**问题原因**：
- 执行命令后 `setInput('')` 清空输入框
- React 重新渲染导致输入框失去焦点
- 用户需要手动点击才能继续输入

**修复方法**：

添加 `useEffect` 钩子，在命令执行完成后自动恢复焦点：

```typescript
// 保持输入框焦点
useEffect(() => {
  if (!running) {
    inputRef.current?.focus();
  }
}, [running, lines]);
```

**效果**：
- ✅ 命令执行完成后自动聚焦输入框
- ✅ 无需手动点击即可继续输入
- ✅ 流畅的连续操作体验

---

### 2. Tab 补全功能

**实现功能**：

#### 命令补全
当输入第一个词时，Tab 补全常用命令：

```typescript
const commands = [
  ...Object.keys(BUILTINS),  // 内置命令：help, clear, ai
  'ls', 'cat', 'cd', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'grep', 'find',
  'echo', 'touch', 'head', 'tail', 'wc', 'sort', 'uniq',
  'node', 'npm', 'npx', 'python3', 'python', 'pip',
  'git', 'curl', 'wget', 'tar', 'gzip', 'zip', 'unzip',
];
```

**行为**：
- 单个匹配：自动补全并添加空格
- 多个匹配：显示所有可能的命令

#### 文件/目录补全
当输入命令参数时，Tab 补全文件和目录名：

```typescript
// 调用后端 API 获取文件列表
const result = await api.listFiles(dir);
const matches = result.entries
  .filter((e: any) => e.name.startsWith(prefix))
  .map((e: any) => e.name);
```

**行为**：
- 单个匹配：自动补全
  - 目录：添加 `/`
  - 文件：添加空格
- 多个匹配：显示所有可能的文件/目录

**支持路径**：
- 相对路径：`cat file.txt` → Tab
- 绝对路径：`cat /path/to/file` → Tab
- 子目录：`cat subdir/file` → Tab

---

## 📝 使用示例

### 命令补全

```bash
$ gi<Tab>
→ $ git 

$ gre<Tab>
→ $ grep 

$ p<Tab>
pwd  python  python3  pip
```

### 文件补全

```bash
$ cat f<Tab>
→ $ cat file.txt 

$ cd d<Tab>
→ $ cd documents/

$ ls s<Tab>
scripts/  src/
```

### 多级路径补全

```bash
$ cat doc<Tab>
→ $ cat documents/

$ cat documents/r<Tab>
→ $ cat documents/report.txt 
```

---

## 🎯 快捷键总结

| 快捷键 | 功能 | 说明 |
|--------|------|------|
| **Tab** | 命令/文件补全 | 🆕 新增 |
| **↑/↓** | 历史命令 | 浏览命令历史 |
| **Ctrl+L** | 清屏 | 清除所有输出 |
| **Ctrl+C** | 取消输入 | 取消当前输入 |
| **Enter** | 执行命令 | 执行输入的命令 |

---

## 🧪 测试场景

### 场景 1：连续执行命令

**测试步骤**：
1. 输入 `ls` 并按 Enter
2. 命令执行完成后，立即输入 `pwd`
3. 无需点击输入框

**预期结果**：
- ✅ 命令执行后自动聚焦
- ✅ 可以立即输入下一个命令

### 场景 2：命令补全

**测试步骤**：
1. 输入 `gi` 并按 Tab
2. 自动补全为 `git `

**预期结果**：
- ✅ 自动补全命令
- ✅ 添加空格便于继续输入

### 场景 3：文件补全

**测试步骤**：
1. 创建测试文件：`touch test1.txt test2.txt`
2. 输入 `cat t` 并按 Tab
3. 显示 `test1.txt  test2.txt`
4. 输入 `cat test1` 并按 Tab
5. 自动补全为 `cat test1.txt `

**预期结果**：
- ✅ 显示所有匹配的文件
- ✅ 唯一匹配时自动补全

### 场景 4：目录补全

**测试步骤**：
1. 创建目录：`mkdir mydir`
2. 输入 `cd my` 并按 Tab
3. 自动补全为 `cd mydir/`

**预期结果**：
- ✅ 目录补全后添加 `/`
- ✅ 便于继续浏览子目录

---

## 🔧 技术实现

### 文件修改

**文件**：`frontend/src/components/apps/TerminalApp.tsx`

### 关键代码

#### 1. 自动聚焦

```typescript
useEffect(() => {
  if (!running) {
    inputRef.current?.focus();
  }
}, [running, lines]);
```

#### 2. Tab 补全处理

```typescript
const handleTabComplete = useCallback(async () => {
  const trimmed = input.trim();
  if (!trimmed) return;

  const parts = trimmed.split(/\s+/);
  const lastPart = parts[parts.length - 1];
  
  // 命令补全
  if (parts.length === 1) {
    const commands = [...];
    const matches = commands.filter(cmd => cmd.startsWith(lastPart));
    
    if (matches.length === 1) {
      setInput(matches[0] + ' ');
    } else if (matches.length > 1) {
      addLines([{ type: 'system', content: matches.join('  ') }]);
    }
  } 
  // 文件补全
  else {
    const result = await api.listFiles(dir);
    const matches = result.entries.filter(...);
    // ... 补全逻辑
  }
}, [input, addLines]);
```

#### 3. 键盘事件处理

```typescript
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    if (!running) {
      handleTabComplete();
    }
  }
  // ... 其他按键处理
};
```

---

## 🎨 用户体验改进

### 修复前

❌ **焦点问题**：
```
用户: ls [Enter]
系统: (显示文件列表)
用户: (需要点击输入框)
用户: pwd [Enter]
```

❌ **补全问题**：
```
用户: gi [Tab]
系统: (无反应)
用户: (手动输入完整命令) git status
```

### 修复后

✅ **焦点问题**：
```
用户: ls [Enter]
系统: (显示文件列表，自动聚焦)
用户: pwd [Enter]  ← 无需点击
```

✅ **补全问题**：
```
用户: gi [Tab]
系统: git █  ← 自动补全
用户: status [Enter]
```

---

## 📊 对比总结

| 功能 | 修复前 | 修复后 |
|------|--------|--------|
| **焦点保持** | ❌ 需要手动点击 | ✅ 自动聚焦 |
| **命令补全** | ❌ 不支持 | ✅ Tab 补全 |
| **文件补全** | ❌ 不支持 | ✅ Tab 补全 |
| **目录补全** | ❌ 不支持 | ✅ Tab 补全 + `/` |
| **多匹配提示** | ❌ 无提示 | ✅ 显示所有匹配 |
| **连续操作** | ❌ 中断 | ✅ 流畅 |

---

## 🚀 部署

修改已完成，前端会自动热重载。

**验证步骤**：

1. 打开终端应用
2. 输入命令并按 Enter
3. 验证焦点自动保持
4. 输入 `gi` 并按 Tab
5. 验证命令自动补全

---

## 💡 未来改进

可以考虑的增强功能：

1. **智能补全**：
   - 基于命令历史的智能建议
   - 常用命令优先排序

2. **路径导航**：
   - 支持 `cd -` 返回上一个目录
   - 显示当前路径在提示符中

3. **多行输入**：
   - 支持 `\` 续行
   - 支持多行脚本输入

4. **语法高亮**：
   - 命令高亮
   - 参数高亮
   - 路径高亮

5. **自动建议**：
   - 类似 fish shell 的自动建议
   - 灰色显示历史命令建议

---

**修复完成时间**：2026-03-01  
**影响文件**：`frontend/src/components/apps/TerminalApp.tsx`  
**测试状态**：✅ 待验证
