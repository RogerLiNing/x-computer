# X-Computer 适配说明

在 X-Computer 中使用 skill-creator 时，请遵循本适配说明。整体流程与 SKILL.md 中「Claude.ai-specific instructions」一致（无 subagents），并增加以下 X 特有约定。

## 创建 Skill 的路径与发现

- **写入路径**：新 skill 写到沙箱内的 `skills/<skill-name>/SKILL.md`。
- **用户工作区**：多用户时，可写入 `users/{userId}/workspace/skills/<skill-name>/SKILL.md`。
- **发现**：X 通过 `capability.search` 或 `skill.load` 会从 `skills/` 与用户沙箱的 skills 目录中发现并加载新 skill。

## 工作流简化

1. **Capture Intent** → **Interview** → **Write SKILL.md**：与主文档相同。
2. **Test**：无 subagents，你依次执行每个 test case（`skill.load` 该 skill 后按说明完成任务），把结果展示给用户。
3. **Benchmark**：跳过定量 benchmark，以用户定性反馈为主。
4. **Iterate**：根据反馈用 `file.write` 更新 `skills/<name>/SKILL.md`。

## 创建完成后

- 使用 `file.write` 创建 `skills/<skill-name>/SKILL.md` 及可选资源文件。
- 提醒用户：新 skill 已写入沙箱，后续任务中可通过 `skill.load("<skill-name>")` 使用。
- 如需打包或分享，可用 `file.read` 读取内容，或由用户自行从工作区导出。
