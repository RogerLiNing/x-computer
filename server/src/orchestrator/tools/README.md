# 工具实现目录（ToolExecutor 拆分）

工具按领域拆分到独立文件，便于结构化管理与扩展。

## 目录结构

- **types.ts** — `ToolExecutorDeps` 接口与 `ToolHandler` 类型，供各工具模块使用，避免与 ToolExecutor 循环依赖。
- **utils.ts** — 工具共用工具函数（如 `escapeRe`、`decodeHtmlEntities`）。
- **file/** — 文件类工具
  - `read.ts` — file.read
  - `write.ts` — file.write
  - `tail.ts` — file.tail
  - `replace.ts` — file.replace
  - `parse.ts` — file.parse（智谱文档解析）
  - `list.ts` — file.list
  - `index.ts` — 统一导出 definitions 与 createFileHandlers
- **grep.ts** — grep（沙箱内正则搜索）
- **shell/** —  shell 类工具
  - `run.ts` — shell.run

## 约定

- 每个工具文件导出：`xxxDefinition: ToolDefinition` 与 `createXxxHandler(deps: ToolExecutorDeps): ToolHandler`。
- 执行时依赖（resolveFS、simulateDelay、getZhipuApiKey 等）通过 `ToolExecutorDeps` 注入，由 ToolExecutor 在 `registerBuiltinTools()` 中传入 `this as ToolExecutorDeps` 并注册。
- 新增同类工具时在对应目录添加文件，并在该目录的 index（若有）或 ToolExecutor 中注册。

## 后续可拆分

llm、x、skill、signal、workflow、memory、capability 等工具仍保留在 `ToolExecutor.ts` 内联实现，可按同样模式逐步迁入 `tools/llm/`、`tools/x/` 等目录。
