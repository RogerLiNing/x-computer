# 应用/游戏多媒体资源生成方案

X 在创建应用或游戏时需要资源：**图片**（贴图、图标、背景）已通过 `llm.generate_image`（图片模型）解决；**声音**（背景音乐、音效）需要单独方案。本文档汇总可选技术路线，供实现 R022 或 MCP/Skill 接入时参考。

---

## 1. 资源类型与对应方案

| 类型 | 用途示例 | 推荐方向 | 说明 |
|------|----------|----------|------|
| **图片** | 贴图、图标、UI、背景、游戏形象 | 已实现 | `llm.generate_image`：可选用 fal FLUX（设置→多媒体勾选「图片生成使用 fal」）或大模型 image 模态 |
| **背景音乐 (BGM)** | 游戏/应用循环背景乐 | 见 §2 | 文本描述 → 成曲，30 秒～数分钟 |
| **音效 (SFX)** | 点击、爆炸、脚步、环境声 | 见 §3 | 文本描述 → 短音频，通常 &lt;30 秒 |
| **语音/旁白 (TTS)** | 若有朗读、配音需求 | 可选 | ElevenLabs、OpenAI TTS 等，按需再接入 |

---

## 2. 背景音乐 (BGM) 生成

- **当前实现**：`llm.generate_music` 使用 **fal.ai**，同一 Key 下可在设置→多媒体中选择音乐模型：
  - **CassetteAI**（`cassetteai/music-generator`）：默认，速度快，文本 + 时长。
  - **MusicGen**（`fal-ai/musicgen`）：Meta 模型，质量较好，支持多种子模型（如 stereo-medium / large）。
  - **Stable Audio Open**（`fal-ai/stable-audio`）：开源可商用，文本 + 时长（seconds_total）。
- **其他可选（未接入）**：Suno、MusicAPI、Beatoven 等。

---

## 3. 音效 (SFX) 生成

- **商用 API**
  - **ElevenLabs Sound Effects**：文本描述 → 音效，支持时长 0.1～30 秒、循环等；自然语言与专业术语都支持，适合游戏/影片/Foley。
  - **CassetteAI（fal.ai）**：文本 → 音效，约 1 秒处理、最长 30 秒，API Key 即可调用；当前 `llm.generate_sound_effect` 使用此模型。
  - **Beatoven.ai**：音乐 + SFX 一体，若已接 BGM 可统一考虑。
- **开源/自托管**
  - **Meta AudioCraft / AudioGen**：文本 → 环境声与音效（如狗叫、脚步），与 MusicGen 同套栈，可自托管。

### 3.1 fal CassetteAI 音效提示词建议（最佳实践）

fal 官方示例与博客建议：

- **简洁具体**：用一句话说清「什么在发出声音」，必要时加场景或节奏，效果更好。
- **多试几种说法**：同一效果可换措辞或强调不同侧面（如 "button click" / "UI click sound" / "soft button tap"）；增加上下文通常能提升结果。
- **推荐写法示例**（来自 fal 示例与文档）：
  - 环境/自然：`dog barking in the rain`、`the sound of water gently flowing from a sink`
  - 物体/动作：`a soda can being opened`、`bacon sizzling in a hot pan`
  - 机械/节奏：`typing on a mechanical keyboard at a fast pace`
  - 游戏常用：`button click`、`explosion`、`footsteps on gravel`、`laser shoot`、`coin pick up`

**实现建议**：音效用 **fal.ai CassetteAI** 做 `llm.generate_sound_effect`（prompt + 可选 duration），调用时 prompt 按上列风格填写；需要更高品质时可考虑 ElevenLabs 或 AudioGen 自建。

---

## 4. 与 X 的整合方式

- **工具层**（推荐）：在 ToolExecutor 中新增 `llm.generate_music`、`llm.generate_sound_effect`，参数从步骤或用户意图解析；生成结果写沙箱（如 `apps/<id>/assets/bgm.mp3`、`sfx/click.wav`），与 `llm.generate_image` 写图标一致。
- **配置**：API Key 放入设置或环境变量（如 `SUNO_API_KEY`、`ELEVENLABS_API_KEY`、`FAL_KEY`），与现有大模型/ MCP 配置方式一致。
- **MCP/Skill**：若希望不写死厂商，可由 MCP 或 Skill 提供「音乐/音效生成」工具，X 通过能力发现调用；本表仅约定「图片用图片模型，声音用上述 API 或自托管模型」。

---

## 5. 小结

| 资源 | 当前/建议方案 |
|------|----------------|
| 图片 | **llm.generate_image**（已实现）：fal FLUX.1 [schnell] 或大模型 image 模态，设置→多媒体可切换 |
| 背景音乐 | **fal.ai**（已实现）→ `llm.generate_music`，可选 CassetteAI / MusicGen / Stable Audio，设置→多媒体中切换 |
| 音效 | **ElevenLabs Sound Effects** 或 **fal.ai CassetteAI**（或 **AudioGen 自托管**）→ 可封装为 `llm.generate_sound_effect` |

X 在规划「做应用/游戏」时，可根据资源类型自动选择：贴图/图标用图片模型，BGM 用音乐生成，SFX 用音效生成；实现时按 R022 与本文档选一或多种 API/自托管方案接入即可。
