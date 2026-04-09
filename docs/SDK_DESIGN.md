# X-Computer SDK 设计模式

**最后更新**: 2026-04-08  
**状态**: 设计中

---

## 🎯 概述

X-Computer SDK 提供标准化的 API 客户端，方便第三方开发者集成和扩展。

---

## 📦 SDK 架构

### 设计原则

参考 **opencode** SDK 设计：

1. **最小化依赖** - 核心功能零依赖
2. **类型安全** - 完整的 TypeScript 类型定义
3. **模块化** - 按功能分离模块
4. **易于使用** - 简洁的 API 接口

### 目录结构

```
packages/
├── sdk/
│   ├── js/                    # JavaScript SDK
│   │   ├── src/
│   │   │   ├── client.ts      # 核心客户端
│   │   │   ├── auth.ts        # 认证模块
│   │   │   ├── tools.ts       # 工具接口
│   │   │   ├── tasks.ts       # 任务管理
│   │   │   ├── files.ts       # 文件操作
│   │   │   └── index.ts       # 入口文件
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── python/                # Python SDK（未来）
│       ├── xcomputer/
│       │   ├── __init__.py
│       │   ├── client.py
│       │   └── tools.py
│       └── setup.py
│
└── core/                      # 核心类型定义
    ├── src/
    │   ├── types.ts          # 共享类型
    │   ├── constants.ts      # 常量定义
    │   └── index.ts          # 导出
    └── package.json
```

---

## 🔧 核心 API

### 1. 客户端初始化

```typescript
// packages/sdk/js/src/client.ts

import type { Task, TaskStep, ToolResult } from '@x-computer/core'

export interface XComputerConfig {
  baseUrl: string
  apiKey?: string
  userId?: string
  timeout?: number
}

export class XComputerClient {
  private config: XComputerConfig
  
  constructor(config: XComputerConfig) {
    this.config = {
      timeout: 30000,
      ...config
    }
  }
  
  // 认证
  async login(email: string, password: string): Promise<AuthResult>
  async logout(): Promise<void>
  
  // 任务管理
  async createTask(request: CreateTaskRequest): Promise<Task>
  async getTask(id: string): Promise<Task>
  async listTasks(filter?: TaskFilter): Promise<Task[]>
  async pauseTask(id: string): Promise<void>
  async resumeTask(id: string): Promise<void>
  
  // 工具执行
  async executeTool(name: string, params: unknown): Promise<ToolResult>
  
  // 文件操作
  async readFile(path: string): Promise<string>
  async writeFile(path: string, content: string): Promise<void>
  async listDirectory(path: string): Promise<FileInfo[]>
  
  // Shell 执行
  async runCommand(command: string, options?: ShellOptions): Promise<ShellResult>
}
```

### 2. 使用示例

```typescript
// 基础使用
import { XComputerClient } from '@x-computer/sdk'

const client = new XComputerClient({
  baseUrl: 'http://localhost:4000',
  apiKey: 'your-api-key'
})

// 创建任务
const task = await client.createTask({
  domain: 'coding',
  goal: 'Create a React component',
  context: 'User wants a button component'
})

// 查询任务状态
const status = await client.getTask(task.id)

// 执行工具
const result = await client.executeTool('file_read', {
  path: '/src/App.tsx'
})
```

---

## 🛠️ 工具接口

### 工具定义模式

参考 **claude-code** 工具系统：

```typescript
// packages/core/src/types.ts

export interface Tool {
  name: string
  description: string
  inputSchema: JSONSchema
  call: (params: unknown) => Promise<ToolResult>
  render?: React.ComponentType<{ result: ToolResult }>
}

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
  metadata?: Record<string, unknown>
}

// 工具注册
export const tools: Map<string, Tool> = new Map([
  ['file_read', fileReadTool],
  ['file_write', fileWriteTool],
  ['shell_run', shellRunTool],
  // ...
])
```

### 工具创建模式

```typescript
// 定义工具接口
export function createTool<TInput, TOutput>(
  definition: ToolDefinition,
  handler: (params: TInput) => Promise<TOutput>
): Tool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    call: async (params: unknown) => {
      const validated = validate<TInput>(params, definition.inputSchema)
      const output = await handler(validated)
      return { success: true, data: output }
    }
  }
}

// 使用示例
const fileReadTool = createTool(
  {
    name: 'file_read',
    description: 'Read file contents',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  },
  async (params: { path: string }) => {
    return fs.readFile(params.path, 'utf-8')
  }
)
```

---

## 🌍 国际化 (i18n)

参考 **opencode** 多语言支持设计：

### 当前状态

```
frontend/src/locales/
├── en.json       # 英语 (100%)
└── zh-CN.json    # 简体中文 (100%)
```

### 扩展计划

```
frontend/src/locales/
├── en.json       # English
├── zh-CN.json    # 简体中文
├── zh-TW.json    # 繁體中文
├── ja.json       # 日本語
├── ko.json       # 한국어
├── es.json       # Español
├── fr.json       # Français
├── de.json       # Deutsch
├── pt.json       # Português
└── ru.json       # Русский
```

### 实现方式

```typescript
// frontend/src/i18n.ts

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const resources = {
  en: { translation: require('./locales/en.json') },
  'zh-CN': { translation: require('./locales/zh-CN.json') },
  'zh-TW': { translation: require('./locales/zh-TW.json') },
  ja: { translation: require('./locales/ja.json') },
  ko: { translation: require('./locales/ko.json') },
  // ... 更多语言
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  })

export default i18n
```

### 语言切换组件

```typescript
// frontend/src/components/LanguageSwitcher.tsx

import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'

const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: '繁體中文', flag: '🇹🇼' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
]

export function LanguageSwitcher() {
  const { i18n } = useTranslation()
  
  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code)
    localStorage.setItem('language', code)
  }
  
  return (
    <div className="relative group">
      <button className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10">
        <Globe size={16} />
        <span>{languages.find(l => l.code === i18n.language)?.name}</span>
      </button>
      
      <div className="absolute right-0 mt-2 py-2 bg-gray-800 rounded-lg shadow-lg hidden group-hover:block">
        {languages.map(lang => (
          <button
            key={lang.code}
            onClick={() => changeLanguage(lang.code)}
            className="flex items-center gap-2 w-full px-4 py-2 hover:bg-white/10"
          >
            <span>{lang.flag}</span>
            <span>{lang.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

---

## 🔌 插件系统设计

参考 **openclaw** 插件架构：

### 插件接口

```typescript
// packages/core/src/types.ts

export interface Plugin {
  // 插件元信息
  id: string
  name: string
  version: string
  description: string
  author: string
  
  // 插件生命周期
  onLoad?: (context: PluginContext) => Promise<void>
  onUnload?: () => Promise<void>
  
  // 插件能力
  tools?: Tool[]
  skills?: SkillDefinition[]
  routes?: RouteDefinition[]
  hooks?: HookDefinition[]
}

export interface PluginContext {
  // 核心 API
  client: XComputerClient
  db: Database
  logger: Logger
  
  // 插件能力
  registerTool(tool: Tool): void
  registerSkill(skill: SkillDefinition): void
  registerRoute(route: RouteDefinition): void
  
  // 钩子能力
  on(event: string, handler: EventHandler): void
  emit(event: string, data: unknown): void
}

export interface HookDefinition {
  event: string
  handler: (data: unknown) => Promise<unknown>
}
```

### 插件示例

```typescript
// plugins/example-plugin/index.ts

import { Plugin, PluginContext, Tool } from '@x-computer/core'

const plugin: Plugin = {
  id: 'com.example.plugin',
  name: 'Example Plugin',
  version: '1.0.0',
  description: 'An example plugin',
  author: 'Example Team',
  
  async onLoad(context: PluginContext) {
    // 注册工具
    context.registerTool({
      name: 'example_tool',
      description: 'An example tool from plugin',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' }
        },
        required: ['message']
      },
      call: async (params: { message: string }) => {
        context.logger.info('Tool called', params)
        return { success: true, data: `Received: ${params.message}` }
      }
    })
    
    // 注册钩子
    context.on('task:beforeExecute', async (data) => {
      context.logger.info('Task about to execute', data)
    })
  },
  
  async onUnload() {
    console.log('Plugin unloaded')
  }
}

export default plugin
```

### 插件加载器

```typescript
// server/src/plugins/loader.ts

import { Plugin, PluginContext } from '@x-computer/core'
import path from 'path'
import fs from 'fs/promises'

export class PluginLoader {
  private plugins: Map<string, Plugin> = new Map()
  private context: PluginContext
  
  constructor(context: PluginContext) {
    this.context = context
  }
  
  async load(pluginPath: string): Promise<void> {
    const manifest = await fs.readFile(
      path.join(pluginPath, 'plugin.json'),
      'utf-8'
    )
    
    const config = JSON.parse(manifest)
    const plugin: Plugin = require(path.join(pluginPath, config.main))
    
    await plugin.onLoad?.(this.context)
    this.plugins.set(plugin.id, plugin)
  }
  
  async unload(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId)
    if (plugin) {
      await plugin.onUnload?.()
      this.plugins.delete(pluginId)
    }
  }
  
  async loadAll(pluginDir: string): Promise<void> {
    const dirs = await fs.readdir(pluginDir)
    
    for (const dir of dirs) {
      const pluginPath = path.join(pluginDir, dir)
      await this.load(pluginPath)
    }
  }
}
```

---

## 🦾 Skill 系统扩展

参考 **claude-skills** 和 **skills** 项目：

### Skill 定义

```typescript
// packages/core/src/types.ts

export interface SkillDefinition {
  id: string
  name: string
  description: string
  category: SkillCategory
  version: string
  
  // Skill 能力
  tools?: ToolDefinition[]
  prompts?: PromptDefinition[]
  handlers?: HandlerDefinition[]
  
  // 依赖关系
  dependencies?: string[]
  
  // 元数据
  author?: string
  homepage?: string
  repository?: string
}

export type SkillCategory = 
  | 'coding'
  | 'writing'
  | 'analysis'
  | 'automation'
  | 'integration'
  | 'custom'

export interface PromptDefinition {
  id: string
  template: string
  variables: PromptVariable[]
}

export interface HandlerDefinition {
  event: string
  handler: string  // 函数名
}
```

### Skill 加载流程

```typescript
// server/src/skills/loader.ts

export class SkillLoader {
  async load(skillId: string): Promise<Skill> {
    // 1. 查找 Skill 配置
    const config = await this.findSkillConfig(skillId)
    
    // 2. 加载 Skill 代码
    const skillPath = await this.downloadSkill(config)
    const skillModule = require(skillPath)
    
    // 3. 注册工具
    for (const tool of skillModule.tools || []) {
      this.toolRegistry.register(tool)
    }
    
    // 4. 注册提示词
    for (const prompt of skillModule.prompts || []) {
      this.promptRegistry.register(prompt)
    }
    
    // 5. 返回 Skill 实例
    return {
      id: skillId,
      ...skillModule
    }
  }
  
  async unload(skillId: string): Promise<void> {
    // 1. 取消注册工具
    // 2. 取消注册提示词
    // 3. 清理缓存
  }
}
```

---

## 📊 性能优化

### 懒加载

```typescript
// 延迟加载模块
const lazy = {
  get toolExecutor() {
    return import('./ToolExecutor').then(m => m.ToolExecutor)
  }
}

// 使用时
const executor = await lazy.toolExecutor
```

### 缓存策略

```typescript
// 内存缓存
const cache = new Map<string, { data: unknown; expire: number }>()

function cached<T>(key: string, fn: () => T, ttl: number = 60000): T {
  const now = Date.now()
  const cached = cache.get(key)
  
  if (cached && cached.expire > now) {
    return cached.data as T
  }
  
  const data = fn()
  cache.set(key, { data, expire: now + ttl })
  return data
}
```

---

## 🔒 安全考虑

### 输入验证

```typescript
// 使用 Schema 验证
import { z } from 'zod'

const CreateTaskSchema = z.object({
  domain: z.enum(['chat', 'coding', 'agent', 'office']),
  goal: z.string().min(1).max(1000),
  context: z.string().max(10000).optional()
})

function validateCreateTask(input: unknown) {
  return CreateTaskSchema.parse(input)
}
```

### 权限检查

```typescript
// 基于角色的访问控制
enum Role {
  Guest = 'guest',
  User = 'user',
  Pro = 'pro',
  Admin = 'admin'
}

const permissions: Record<Role, string[]> = {
  [Role.Guest]: ['read'],
  [Role.User]: ['read', 'write'],
  [Role.Pro]: ['read', 'write', 'execute'],
  [Role.Admin]: ['read', 'write', 'execute', 'admin']
}

function checkPermission(user: User, permission: string): boolean {
  const userPermissions = permissions[user.role] || []
  return userPermissions.includes(permission)
}
```

---

## 📈 监控和日志

### 日志格式

```typescript
// 结构化日志
logger.info('Task created', {
  taskId: task.id,
  userId: user.id,
  domain: task.domain,
  timestamp: new Date().toISOString()
})
```

### 性能指标

```typescript
// 性能追踪
const metrics = {
  taskCreated: new Counter('tasks.created'),
  taskDuration: new Histogram('tasks.duration'),
  toolExecutions: new Counter('tools.executed')
}

// 记录指标
metrics.taskCreated.inc()
metrics.taskDuration.observe(duration)
```

---

## 🚀 发布流程

### 版本管理

```json
// packages/sdk/js/package.json
{
  "name": "@x-computer/sdk",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src"
  }
}
```

### 发布脚本

```bash
#!/bin/bash
# scripts/publish-sdk.sh

# 构建
npm run build

# 测试
npm run test

# 发布到 npm
npm publish --access public

# 发布到 GitHub Packages
npm publish --registry=https://npm.pkg.github.com
```

---

## 📚 参考资源

### SDK 设计模式

- **opencode SDK**: JavaScript SDK 最佳实践
- **Stripe SDK**: API 客户端设计模式
- **Notion SDK**: 类型安全的 API 封装

### 工具系统

- **claude-code**: 工具注册和执行机制
- **LangChain**: 工具链设计模式

### 插件系统

- **openclaw**: 插件生命周期管理
- **VS Code**: 扩展系统设计

---

**下一步计划**:

1. 实现 JavaScript SDK 核心模块
2. 添加多语言支持（日语、韩语等）
3. 设计插件系统原型
4. 完善 Skill 加载机制
5. 添加性能监控和指标