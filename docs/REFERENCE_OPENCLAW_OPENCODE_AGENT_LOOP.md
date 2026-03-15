# OpenClaw / OpenCode 动态执行参考摘要

本文档基于对 `projects-for-reference/openclaw` 与 `projects-for-reference/opencode` 的阅读，总结「收到用户需求后不间断执行直至完成」的实现方式，供 X-Computer 对齐开发。

---

## 1. 核心差异：预规划步骤 vs 运行时循环

| 维度 | X-Computer（当前） | OpenClaw / OpenCode |
|------|-------------------|----------------------|
| **规划** | 先由 TaskPlanner 生成固定步骤列表（LLM 一次或模板） | **无预生成步骤列表** |
| **执行** | 按步骤顺序执行，每步调用 ToolExecutor 一次 | **循环**：LLM 调用 → 若有 tool_calls 则执行工具 → 将结果追加到会话 → 再次调用 LLM，直到模型不再返回 tool_calls |
| **动态性** | 步骤在规划时确定，执行中不增删 | **完全由模型每轮决定**：下一动作为何、何时结束 |

---

## 2. OpenClaw 流程摘要

- **入口**：`gateway/server-methods/agent.ts` 的 `agent` handler → `commands/agent.ts` 的 `agentCommand()`。
- **执行路径**：`runEmbeddedPiAgent()`（`agents/pi-embedded-runner/run.ts`）。
- **外层循环**：`run.ts` 中的 `while (true)` 主要用于**重试**（context overflow 后 compaction、auth 轮换、thinking level 降级等），不是「下一步」循环。
- **单次运行**：`runEmbeddedAttempt()` 使用 PI（`@mariozechner/pi-coding-agent`）的 SessionManager。**一次 attempt = 一次完整 agent 运行**：在库内部完成「LLM 回复 → 若有 tool_calls 则执行 → 结果写回 session → 再调 LLM」的循环，直到模型不再发起 tool call。
- **结论**：无预先步骤列表；由模型在会话中多轮调用工具，直到自行结束。

---

## 3. OpenCode 流程摘要

- **Session 与处理器**：`session/processor.ts` 的 `SessionProcessor.create()` 返回的 `process(streamInput)` 处理**单次** LLM 流。
- **单次 process**：调用 `LLM.stream(streamInput)`，消费 `stream.fullStream`，处理 `tool-call`、`tool-result`、`finish-step`、`text-delta` 等事件；工具执行由 AI SDK 或上层在流中/流后完成。
- **返回值**：`process()` 返回 `"continue" | "stop" | "compact"`。返回 `"continue"` 表示本轮有工具调用或需继续，**调用方会更新 messages（追加 assistant 与 tool 结果）后再次调用 `process()`**，形成「用户消息 → 循环 process 直至 stop」。
- **max-steps**：通过提示词（如 `max-steps.txt`）在达到最大步数时要求模型仅用文本回复、不再调用工具，从而结束循环。
- **结论**：同样无预定义步骤；每轮一次 LLM 调用，由模型决定是否调用工具；多轮由调用方根据 `process()` 返回值驱动。

---

## 4. 对齐 X-Computer 的实现要点

1. **引入「Agent 循环」**  
   - 在「有 llmConfig 时」不再：先 `planWithLLM` 得到步骤列表再 `runSteps`。  
   - 改为：**单任务 = 一次 Agent 循环**：`messages = [system, user: 用户描述]`，然后：
     - `response = await callLLMWithTools(messages, tools)`
     - 若 `response.toolCalls` 为空则结束任务
     - 否则对每个 tool call 用 ToolExecutor 执行，将 assistant 消息 + tool 结果追加到 messages，回到上一步
   - 可选：设置 maxSteps（如 20），超过后强制结束或注入「仅文本回复」提示。

2. **工具注册方式**  
   - 将当前 4 个工具（llm.generate, file.write, file.read, http.request）以 LLM function-calling 格式注册到 `callLLMWithTools`，与 OpenClaw/OpenCode 的「模型所见即所调」一致。

3. **TaskPlanner 角色**  
   - 可保留为「无 LLM 时的兜底」：无 llmConfig 时仍返回单步 llm.generate 或简单步骤；有 llmConfig 时不再用 planWithLLM 生成多步，而是直接进 Agent 循环。

4. **审批/策略**  
   - 可在每轮「执行 tool 前」做策略检查（如高风险 tool 需用户批准），与现有 PolicyEngine 结合；通过后再执行并继续循环。

---

## 5. 参考文件清单

- OpenClaw：`src/commands/agent.ts`、`src/agents/pi-embedded-runner/run.ts`、`src/agents/pi-embedded-runner/run/attempt.ts`
- OpenCode：`packages/opencode/src/session/processor.ts`、`packages/opencode/src/session/llm.ts`、`packages/opencode/src/session/prompt/max-steps.txt`
