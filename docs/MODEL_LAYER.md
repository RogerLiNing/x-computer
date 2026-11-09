# 模型层：适配器、能力目录、自动路由、用量记录

更新：2026-11-09。对应调研清单第 3、6 项。

## 适配器 seam（`server/src/llm/adapters/`）

`ModelAdapter { kind, describe(), complete(), stream() }` 是 X 与模型提供方之间的接口。`getModelAdapter({ providerId, baseUrl, apiType })` 按 `resolveLlmApiType` 选出 `openai`（OpenAI 兼容）或 `anthropic` 适配器。现有的 `callLLM / callLLMWithTools / callLLMWithToolsStream` 仍是底层实现，适配器是新代码应依赖的入口；后续接入新协议只需新增一个适配器。

## 能力目录（`server/src/llm/modelCatalog.ts`）

`describeModel(providerId, modelId)` 返回 `contextWindow / supportsTools / supportsImages / inputUsdPerMTok / outputUsdPerMTok / source`。内置按模型 id 模式匹配的表（OpenAI、Claude、DeepSeek、MiniMax、通义、GLM、Kimi、豆包、Gemini、本地模型），未知模型给保守默认（32K，不支持图片）。价格是公开标价的估算，仅用于用量面板。

部署覆盖写在 `server/.x-config.json`：

```jsonc
"llm_config": {
  "models": [
    { "match": "MiniMax-M3.1", "contextWindow": 204800, "supportsImages": false, "inputUsdPerMTok": 0.2, "outputUsdPerMTok": 1.1 },
    { "match": "volcengine:doubao", "contextWindow": 256000 }
  ]
}
```

`estimateTokens(text)` 用于路由与后续的上下文压缩阈值判断（中文按字、英文按 4 字符一个 token 估算）。

## 虚拟模型 `auto`（`server/src/llm/virtualModel.ts`）

用户把模型选成 `auto` 时，每次交办先按请求特征挑一个物理模型，并把结果存到该次运行的 `routedModel`，后续轮次与恢复都沿用：

- 有图片、需要工具（专家/团队运行）、提示词估算超过 `longInputTokens`（默认 6000）或用户消息含「写一篇/分析/方案/报告/代码…」等词 → `strong`；
- 其他 → `cheap`。

配置（用户 `llm_config` 优先，其次 `.x-config.json`）：

```jsonc
"llm_config": {
  "autoRoute": {
    "cheap":  { "providerId": "minimax",  "modelId": "MiniMax-M3.1-Flash" },
    "strong": { "providerId": "deepseek", "modelId": "deepseek-chat" },
    "longInputTokens": 6000
  }
}
```

选了 `auto` 但没有配置时，运行会以明确的提示进入 `blocked` 状态，不会偷偷换模型。

## 用量记录（`server/src/llm/usage.ts`、`ModelUsageStore.ts`）

- 四条模型调用路径（OpenAI 非流式/流式、Anthropic 非流式/流式）在拿到响应后调用 `recordModelUsage`；流式 OpenAI 请求带 `stream_options.include_usage`，Anthropic 流式取 `message_start` / `message_delta` 的 usage。
- 记录带 `userId / runId`（来自模型预算的 AsyncLocalStorage 作用域）、provider、model、token 数，以及按目录估算的 `costUsd`（目录无价格时为空）。
- 表 `model_usage`，`GET /api/usage/models?days=30` 返回总计、按模型、按天；前端订阅页新增「模型用量」面板。
- 写入失败只记日志，绝不影响模型调用。
