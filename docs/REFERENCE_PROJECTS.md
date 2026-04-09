# 参考项目总览

**更新时间**: 2026-04-08  
**作用**: 为 X-Computer 开发提供参考和灵感

---

## 📁 项目列表

### 1. awesome-mcp-servers (33MB)

**类型**: 资源集合  
**描述**: MCP (Model Context Protocol) 服务器资源列表  
**大小**: 33MB  
**用途**: 了解 MCP 协议和服务器实现

**关键内容**:
- MCP 服务器示例
- 协议规范
- 最佳实践
- 工具集成案例

---

### 2. claude-code / CCB (37MB)

**类型**: CLI 工具逆向工程  
**描述**: Anthropic 官方 Claude Code CLI 工具的反编译/逆向还原项目  
**语言**: TypeScript/TSX  
**运行时**: Bun  
**大小**: 37MB  

**核心功能**:
- ✅ Claude API 集成（支持多提供商）
- ✅ 工具系统（Bash、File、Grep、Agent等）
- ✅ 流式响应处理
- ✅ React/Ink 终端 UI
- ✅ 权限管理和审批
- ✅ 上下文管理（git、CLAUDE.md）
- ✅ 会话状态管理

**架构亮点**:
```
入口点 (cli.tsx)
  → 初始化 (main.tsx)
    → REPL 界面 (REPL.tsx)
      → 查询引擎 (QueryEngine.ts)
        → API 客户端 (claude.ts)
          → 工具执行 (tools/*)
```

**技术栈**:
- 运行时: Bun (非 Node.js)
- 构建: 单文件 Bundle (~25MB)
- UI: React + Ink (终端渲染)
- 状态: Zustand-like store
- API: Anthropic SDK

**可借鉴点**:
- 🔧 工具系统设计
- 🎨 终端 UI 实现
- 📊 状态管理方案
- 🔄 流式响应处理
- 🔐 权限管理机制

**状态**: 反编译版本，仅用于学习参考，不建议直接使用代码

---

### 3. claude-skills (18MB)

**类型**: Skills 集合  
**描述**: Claude 相关的技能模块  
**大小**: 18MB  

**关键内容**:
- Skill 定义和加载机制
- 工具包装和扩展
- 提示词模板
- 技能组合示例

---

### 4. CoPaw (63MB)

**类型**: AI 代理框架  
**描述**: AI 驱动的代码助手  
**大小**: 63MB  

**关键内容**:
- 任务执行框架
- 代码生成工具
- 测试自动化
- 文档生成

---

### 5. ironclaw (60MB)

**类型**: 多通道 AI 网关  
**描述**: 可扩展的消息集成系统  
**大小**: 60MB  

**关键内容**:
- 多渠道消息接入（Discord、Slack、Telegram等）
- AI 模型集成
- 消息路由和处理
- 插件架构

**多语言文档**:
- README.zh-CN.md (中文)
- README.ja.md (日语)
- README.ru.md (俄语)
- 等 10+ 种语言

---

### 6. openclaw (1.2GB) ⭐️ 最大项目

**类型**: 个人 AI 助手  
**描述**: 功能完整的 AI 助手平台  
**版本**: 2026.4.1  
**大小**: 1.2GB  

**核心特性**:
- 🤖 多模型支持
- 🔌 插件系统
- 📊 任务调度
- 🔐 权限管理
- 📝 审计日志

**技术架构**:
- 前端: React + TypeScript + Vite
- 后端: Node.js + Express
- 数据库: SQLite/PostgreSQL
- 容器: Docker

**特色功能**:
- 任务编排引擎
- 工具执行沙箱
- 记忆系统
- 多代理协作
- 工作流自动化

**文档**:
- VISION.md - 愿景规划
- docs.acp.md - API 文档
- CHANGELOG.md - 变更记录

---

### 7. opencode (365MB) ⭐️ 重点参考

**类型**: 开源 AI 编码代理  
**描述**: "The open source AI coding agent"  
**大小**: 365MB  

**核心特性**:
- 🎯 AI 驱动的代码生成和编辑
- 🔧 工具集成（Bash、File、Grep 等）
- 🖥️ 终端 UI (Ink)
- 📦 SDK 支持
- 🌐 多平台支持

**技术栈**:
- 语言: TypeScript
- 运行时: Bun
- UI: React + Ink
- 构建: 单文件 Bundle
- SDK: JavaScript SDK

**项目结构**:
```
packages/
  ├── opencode/      # 核心包
  ├── sdk/           # JavaScript SDK
  ├── web/           # Web 界面
  └── console/       # 控制台应用
```

**关键文件**:
- `AGENTS.md` - Agent 开发指南
- `README.*.md` - 多语言文档 (15+ 种语言)

**可借鉴点**:
- 🏗️ Monorepo 架构
- 🔌 SDK 设计
- 🌍 国际化方案
- 📦 构建和发布流程

---

### 8. skills (14MB)

**类型**: Skills 示例  
**描述**: 基础技能模块示例  
**大小**: 14MB  

**关键内容**:
- 基础技能定义
- 工具集成示例
- 提示词工程
- 测试用例

---

## 🎯 推荐关注顺序

### 对于工具系统开发

1. **claude-code** - 学习工具注册和执行机制
   - `src/tools.ts` - 工具注册
   - `src/tools/*/` - 各工具实现
   - `src/Tool.ts` - 工具接口定义

2. **opencode** - 学习 SDK 和 API 设计
   - `packages/sdk/` - JavaScript SDK
   - `packages/opencode/src/tools/` - 工具实现

### 对于 UI 开发

1. **claude-code** - 终端 UI 实现
   - `src/screens/REPL.tsx` - 主界面
   - `src/components/` - UI 组件
   - `src/ink.ts` - Ink 集成

2. **opencode** - Web UI 实现
   - `packages/web/` - Web 界面
   - `packages/console/` - 控制台应用

### 对于架构设计

1. **openclaw** - 完整的架构参考
   - 任务编排引擎
   - 插件系统
   - 权限管理

2. **ironclaw** - 多渠道消息集成
   - 消息路由
   - 插件架构

### 对于协议和集成

1. **awesome-mcp-servers** - MCP 协议参考
2. **claude-skills** - Skill 定义机制

---

## 📊 技术对比

| 项目 | 运行时 | UI 框架 | 语言 | 工具系统 | 复杂度 |
|------|--------|---------|------|---------|--------|
| claude-code | Bun | Ink (终端) | TS | ✓✓✓ | 高 |
| opencode | Bun | Ink + Web | TS | ✓✓✓ | 高 |
| openclaw | Node | Web | TS | ✓✓✓ | 很高 |
| ironclaw | Node | - | TS | ✓✓ | 中 |
| CoPaw | Node | - | TS | ✓✓ | 中 |

---

## 🔍 关键学习点

### 1. 工具系统设计 (claude-code)

```typescript
// 工具接口定义
interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  call: (params: any) => Promise<ToolResult>;
  render?: React.ComponentType<{result: ToolResult}>;
}

// 工具注册
const tools: Tool[] = [
  new BashTool(),
  new FileEditTool(),
  new GrepTool(),
  new AgentTool(),
];
```

### 2. 状态管理

```typescript
// AppState 结构
interface AppState {
  messages: Message[];
  tools: Tool[];
  permissions: Permission[];
  mcpConnections: MCPConnection[];
  // ...
}

// Zustand-like store
const useStore = create<State>((set, get) => ({
  // state & actions
}));
```

### 3. 终端 UI (Ink)

```tsx
// React 组件在终端渲染
const REPL: React.FC = () => {
  useInput(handleInput);
  
  return (
    <Box flexDirection="column">
      <Messages messages={messages} />
      <PromptInput />
    </Box>
  );
};
```

### 4. 流式响应处理

```typescript
// API 流式客户端
const stream = await anthropic.messages.stream({
  model: 'claude-3-5-sonnet',
  messages: [...],
  tools: [...],
});

for await (const event of stream) {
  switch (event.type) {
    case 'content_block_delta':
      // 处理文本
      break;
    case 'content_block_stop':
      // 完成
      break;
  }
}
```

---

## ⚠️ 注意事项

### claude-code
- ❌ 反编译代码，**不可用于生产**
- ❌ 包含大量 TypeScript 错误
- ✅ 仅用于学习架构和设计
- ✅ `feature()` 函数始终返回 false

### opencode
- ✅ 开源项目，可以学习
- ✅ 有完整的开发指南 (AGENTS.md)
- ✅ 有详细的编码规范

### openclaw
- ✅ 完整的生产级代码
- ✅ 有详细的架构文档
- ⚠️ 代码量大 (1.2GB)

---

## 📚 推荐阅读

### 架构文档
- `claude-code/CLAUDE.md` - 架构说明
- `opencode/AGENTS.md` - Agent 开发指南
- `openclaw/VISION.md` - 愿景规划

### 代码示例
- `claude-code/src/tools/` - 工具实现
- `opencode/packages/sdk/` - SDK 设计
- `openclaw/src/orchestrator/` - 任务编排

### UI 实现
- `claude-code/src/screens/REPL.tsx` - 终端 UI
- `opencode/packages/web/` - Web UI

---

## 🎓 学习路径建议

### 初级：理解基本概念
1. 阅读 `claude-code/CLAUDE.md`
2. 运行 `opencode` 示例
3. 学习工具系统基础

### 中级：学习具体实现
1. 研究 `claude-code/src/tools/` - 工具实现
2. 学习 `opencode/packages/sdk/` - SDK 设计
3. 理解 `ironclaw` - 多渠道集成

### 高级：架构设计
1. 分析 `openclaw` - 完整系统架构
2. 学习任务编排引擎
3. 研究插件系统设计

---

## 📝 总结

**最佳参考项目**:
- 🔧 工具系统: `claude-code`
- 🏗️ 架构设计: `openclaw`
- 📦 SDK 开发: `opencode`
- 🔌 插件系统: `ironclaw`

**推荐借鉴优先级**:
1. opencode - 开源、有文档、现代化
2. openclaw - 功能完整、生产级
3. claude-code - 架构设计（仅参考）
4. awesome-mcp-servers - 协议参考

---

**最后更新**: 2026-04-08