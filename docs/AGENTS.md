# X-Computer 开发指南

**最后更新**: 2026-04-08  
**目标**: 为开发者提供清晰、一致的编程指导

---

## 🎯 项目愿景

X-Computer 是一个 **AI 驱动的自主计算机系统**，提供 Web 桌面界面、办公应用和智能 Agent。我们的目标是让 AI 能够像人类一样操作计算机。

---

## 📐 设计原则

### 1. 单一职责原则

每个模块、函数、类应该只有一个变化的原因。

```typescript
// ✅ Good - 单一职责
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ❌ Bad - 多重职责
function validateAndSendEmail(email: string): void {
  if (!email.includes('@')) throw new Error('Invalid')
  sendEmail(email)
}
```

### 2. 组合优于继承

优先使用组合和函数式编程，而不是类继承。

```typescript
// ✅ Good - 组合
type Tool = {
  name: string
  execute: (params: unknown) => Promise<Result>
}

function createFileTool(fs: FileSystem): Tool {
  return {
    name: 'file',
    execute: async (params) => fs.write(params)
  }
}

// ❌ Bad - 继承
class BaseTool {
  abstract execute(params: unknown): Promise<Result>
}
```

### 3. 显式优于隐式

代码应该清晰表达意图，避免魔法数字和隐式行为。

```typescript
// ✅ Good - 显式
const MAX_RETRY_COUNT = 3
const RETRY_DELAY_MS = 1000

async function withRetry<T>(fn: () => T): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRY_COUNT; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === MAX_RETRY_COUNT) throw err
      await sleep(RETRY_DELAY_MS)
    }
  }
}

// ❌ Bad - 隐式
async function retry(fn: () => any, n: number = 3) {
  // ... magic logic
}
```

---

## 📝 命名规范

### 变量命名

**优先使用单个词汇**，除非必要的清晰度需要多个词汇。

```typescript
// ✅ Good - 单个词汇
const user = await db.getUser(id)
const file = await fs.read(path)
const task = orchestrator.getTask(id)

// ✅ Good - 必要的多词汇
const subscriptionService = new SubscriptionService()
const userSessionTimeout = 30000

// ❌ Bad - 不必要的多词汇
const currentUserObject = await db.getUser(id)
const fileObjectInstance = await fs.read(path)
const newTaskResultData = orchestrator.getResult()
```

### 推荐的短名称

以下短名称是推荐使用的：

```typescript
// 变量
var err    // error
var req    // request
var res    // response
var ctx    // context
var cfg    // config
var opts   // options
var dir    // directory
var msg    // message
var val    // value
var key    // key
var len    // length
var idx    // index
var tmp    // temporary
var buf    // buffer
var src    // source
var dst    // destination

// 函数
var fn     // function
var cb     // callback
var pred   // predicate
var calc   // calculate
var init   // initialize
var exec   // execute
var run    // run
var load   // load
var save   // save
var read   // read
var write  // write
var parse  // parse
var format // format
var validate // validate

// 常用缩写
var id     // identifier
var pid    // process id
var uid    // user id
var uid    // unique id
var ts     // timestamp
var ms     // milliseconds
var kb     // kilobytes
var mb     // megabytes
var gb     // gigabytes
```

### 文件命名

```
// ✅ Good
ToolExecutor.ts        // 类名 PascalCase
tool-executor.ts        // 工具文件 kebab-case
toolExecutor.test.ts   // 测试文件
user-config.json       // 配置文件 kebab-case

// ❌ Bad
toolExecutor.ts         // 不一致
Tool_Executor.ts        // 混合风格
tool_executor.ts        // 下划线风格
```

---

## 🔄 控制流

### 优先使用早返回

避免深层嵌套，使用早返回提高可读性。

```typescript
// ✅ Good - 早返回
function processUser(user: User | null): Result {
  if (!user) {
    return { error: 'User not found' }
  }
  
  if (!user.isActive) {
    return { error: 'User inactive' }
  }
  
  return { data: user }
}

// ❌ Bad - 深层嵌套
function processUser(user: User | null): Result {
  if (user) {
    if (user.isActive) {
      return { data: user }
    } else {
      return { error: 'User inactive' }
    }
  } else {
    return { error: 'User not found' }
  }
}
```

### 避免不必要的 else

```typescript
// ✅ Good
function getStatus(code: number): string {
  if (code === 200) return 'OK'
  if (code === 404) return 'Not Found'
  if (code === 500) return 'Server Error'
  return 'Unknown'
}

// ❌ Bad
function getStatus(code: number): string {
  if (code === 200) {
    return 'OK'
  } else if (code === 404) {
    return 'Not Found'
  } else if (code === 500) {
    return 'Server Error'
  } else {
    return 'Unknown'
  }
}
```

---

## 📦 函数式编程

### 优先使用函数式方法

```typescript
// ✅ Good - 函数式
const activeUsers = users
  .filter(user => user.isActive)
  .map(user => user.email)
  .slice(0, 10)

// ✅ Good - 带类型守卫
const files = items
  .filter((item): item is File => item.type === 'file')
  .map(file => file.path)

// ❌ Bad - 命令式
const activeUsers: string[] = []
for (let i = 0; i < users.length && activeUsers.length < 10; i++) {
  if (users[i].isActive) {
    activeUsers.push(users[i].email)
  }
}
```

### 避免不必要的中间变量

```typescript
// ✅ Good - 内联
const total = items.reduce((sum, item) => sum + item.price, 0)

// ❌ Bad - 不必要的变量
const prices = items.map(item => item.price)
const total = prices.reduce((sum, price) => sum + price, 0)
```

### 使用对象扩展而非 Object.assign

```typescript
// ✅ Good
const updated = { ...user, name: 'New Name' }

// ❌ Bad
const updated = Object.assign({}, user, { name: 'New Name' })
```

---

## 🎨 TypeScript 规范

### 类型定义

```typescript
// ✅ Good - 接口优先
interface User {
  id: string
  name: string
  email: string
}

// ✅ Good - 类型别名用于联合/工具类型
type UserRole = 'admin' | 'user' | 'guest'
type UserWithRole = User & { role: UserRole }

// ✅ Good - 泛型约束
interface Container<T> {
  value: T
  map<U>(fn: (value: T) => U): Container<U>
}

// ❌ Bad - 过度使用 any
function process(data: any): any {
  return data
}

// ✅ Good - 使用 unknown
function process(data: unknown): Result {
  if (typeof data === 'string') {
    return { value: data }
  }
  return { error: 'Invalid type' }
}
```

### 解构赋值

```typescript
// ✅ Good - 点号访问保留上下文
user.name
user.email

// ❌ Bad - 不必要的解构
const { name, email } = user

// ✅ Good - 必要时解构
const { id } = params  // 参数解构
const [first, second] = items  // 数组解构
```

---

## 🗂️ 文件组织

### 目录结构

```
server/src/
├── orchestrator/        # 核心编排器
│   ├── ToolExecutor.ts # 工具执行器
│   ├── Agent.ts        # Agent 实现
│   └── tools/          # 工具定义
│       ├── file/       # 文件工具
│       ├── shell/      # Shell 工具
│       └── docker/     # Docker 工具
├── routes/              # API 路由
│   ├── api.ts          # 主 API
│   ├── chat.ts         # 聊天路由
│   └── auth.ts         # 认证路由
├── db/                  # 数据库
│   ├── database.ts     # SQLite/MySQL
│   └── migrate.ts      # 迁移工具
└── utils/               # 工具函数
    ├── api.ts          # API 客户端
    └── userId.ts       # 用户 ID
```

### 导入顺序

```typescript
// 1. Node.js 标准库
import { spawn } from 'child_process'
import path from 'path'

// 2. 第三方库
import { v4 as uuid } from 'uuid'
import express from 'express'

// 3. 内部模块（相对导入）
import { SandboxFS } from '../tooling/SandboxFS.js'
import { serverLogger } from '../observability/ServerLogger.js'

// 4. 类型导入
import type { Task, TaskStep } from '../../../shared/src/index.js'
```

---

## 🧪 测试规范

### 测试文件命名

```
ToolExecutor.ts           # 源文件
ToolExecutor.test.ts      # 测试文件
```

### 测试结构

```typescript
describe('ToolExecutor', () => {
  describe('executeTool', () => {
    it('should execute file read tool', async () => {
      // Arrange
      const tool = 'file_read'
      const params = { path: '/tmp/test.txt' }
      
      // Act
      const result = await executor.executeTool(tool, params)
      
      // Assert
      expect(result.success).toBe(true)
      expect(result.data).toContain('test content')
    })
  })
})
```

### 测试原则

1. **不要模拟内部逻辑** - 测试真实实现
2. **使用真实的依赖** - 除非必要，不使用 mock
3. **测试行为，而非实现** - 关注输入输出
4. **一个测试一个断言** - 保持测试简单

---

## 📚 工具系统

### 工具定义

```typescript
// ✅ Good - 清晰的工具定义
export const fileReadDefinition: ToolDefinition = {
  name: 'file_read',
  description: 'Read contents from a file in the sandbox',
  input: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read'
      }
    },
    required: ['path']
  }
}

export function createFileReadHandler(fs: SandboxFS): ToolHandler {
  return async (params: unknown) => {
    const { path } = validateParams(params, fileReadDefinition.input)
    const content = await fs.read(path)
    return { success: true, data: content }
  }
}
```

### 工具注册

```typescript
// ✅ Good - 集中注册
const tools: Map<string, ToolHandler> = new Map()

tools.set('file_read', createFileReadHandler(sandboxFS))
tools.set('file_write', createFileWriteHandler(sandboxFS))
tools.set('shell_run', createShellRunHandler(sandboxShell))

// 工具执行
export async function executeTool(name: string, params: unknown) {
  const handler = tools.get(name)
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`)
  }
  return handler(params)
}
```

---

## 🔐 安全规范

### 输入验证

```typescript
// ✅ Good - 使用 schema 验证
import { z } from 'zod'

const FileWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  mode: z.enum(['write', 'append']).optional()
})

function validateFileWrite(params: unknown) {
  return FileWriteSchema.parse(params)
}

// ❌ Bad - 直接使用未验证的输入
function write(params: any) {
  fs.write(params.path, params.content)  // 危险！
}
```

### 错误处理

```typescript
// ✅ Good - 不暴露内部错误
try {
  await riskyOperation()
} catch (err) {
  logger.error('Operation failed', err)
  throw new Error('Operation failed. Please try again.')
}

// ❌ Bad - 泄露敏感信息
try {
  await riskyOperation()
} catch (err) {
  throw err  // 可能暴露数据库密码等
}
```

---

## 📖 文档规范

### 函数注释

```typescript
/**
 * Executes a task step using specified tool
 * 
 * @param step - The task step to execute
 * @param runtime - Runtime environment (container or VM)
 * @returns Tool execution result
 * @throws {ToolExecutionError} If tool execution fails
 * 
 * @example
 * ```ts
 * const result = await executeStep(step, 'container')
 * if (result.success) {
 *   console.log(result.data)
 * }
 * ```
 */
export async function executeStep(
  step: TaskStep,
  runtime: RuntimeType
): Promise<ToolResult> {
  // implementation
}
```

### 模块文档

```typescript
/**
 * @fileoverview Tool execution system
 * 
 * This module provides the core tool execution framework for X-Computer.
 * It handles tool registration, validation, execution, and result processing.
 * 
 * @module orchestrator/ToolExecutor
 * @requires ./tools/types
 * @requires ./tools/file
 * @requires ./tools/shell
 * 
 * @example
 * ```ts
 * import { ToolExecutor } from './ToolExecutor'
 * 
 * const executor = new ToolExecutor(deps)
 * await executor.executeStep(step, 'container')
 * ```
 */
```

---

## 🚀 性能优化

### 使用 Promise.all 并行执行

```typescript
// ✅ Good - 并行执行
const [users, tasks, stats] = await Promise.all([
  db.getUsers(),
  db.getTasks(),
  db.getStats()
])

// ❌ Bad - 串行执行
const users = await db.getUsers()
const tasks = await db.getTasks()
const stats = await db.getStats()
```

### 使用缓存

```typescript
// ✅ Good - 带缓存的函数
const cache = new Map<string, Promise<Result>>()

function cachedFetch(key: string): Promise<Result> {
  if (cache.has(key)) {
    return cache.get(key)!
  }
  
  const promise = fetchFromDb(key)
  cache.set(key, promise)
  return promise
}
```

---

## 🔄 异步处理

### 优先使用 async/await

```typescript
// ✅ Good
async function fetchUser(id: string): Promise<User> {
  const user = await db.getUser(id)
  return user
}

// ❌ Bad
function fetchUser(id: string): Promise<User> {
  return db.getUser(id)
    .then(user => user)
    .catch(err => { throw err })
}
```

### 错误处理

```typescript
// ✅ Good - 明确的错误处理
async function safeExecute<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn()
    return { success: true, data }
  } catch (err) {
    logger.error('Execution failed', err)
    return { success: false, error: errorMessage(err) }
  }
}
```

---

## ✅ 检查清单

### 提交代码前

- [ ] 代码通过 TypeScript 编译 (`npm run build`)
- [ ] 通过 ESLint 检查 (`npm run lint`)
- [ ] 添加必要的类型注解
- [ ] 编写/更新测试用例
- [ ] 更新相关文档
- [ ] 遵循命名规范（单词汇优先）
- [ ] 使用早返回避免深层嵌套
- [ ] 函数式方法优于命令式循环
- [ ] 错误处理不泄露敏感信息
- [ ] 使用异步/等待而非 Promise.then

### 代码审查要点

- [ ] 逻辑清晰，职责单一
- [ ] 命名准确，易于理解
- [ ] 无冗余代码和过度抽象
- [ ] 错误处理完善
- [ ] 性能考虑充分
- [ ] 安全性考虑周全

---

## 📚 参考资料

### 推荐阅读

- [TypeScript Best Practices](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Clean Code JavaScript](https://github.com/ryanmcdermott/clean-code-javascript)

### 相关文档

- [工具系统设计](./REFERENCE_OPENCLAW_OPENCODE_SKILLS.md)
- [Agent 架构](./REFERENCE_OPENCLAW_OPENCODE_AGENT_LOOP.md)
- [开发指南](./DEVELOPMENT.md)

---

**维护者**: X-Computer Team  
**贡献指南**: 见 CONTRIBUTING.md