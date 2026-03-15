# 应用/游戏多媒体 API Key 获取规划

按「先能跑起来、再按需扩展」的顺序，建议你按下面顺序注册并获取 API Key。拿到 Key 后写入环境变量或设置页，供 R022（音乐/音效生成）接入使用。

---

## 一、优先获取（推荐先拿这两个）

### 1. 音效 (SFX) — fal.ai（推荐首选）

| 项目 | 说明 |
|------|------|
| **用途** | 文本 → 音效（点击、爆炸、脚步、环境声等），单条约 1 秒出结果 |
| **注册** | https://fal.ai — 注册/登录后进入 Dashboard |
| **获取 Key** | 在 Dashboard 或 Settings 中创建 API Key，复制保存 |
| **环境变量** | `FAL_KEY=你的key` |
| **定价** | **约 $0.01/次** 生成，按量付费，无月费门槛 |
| **备注** | 同一 Key 可复用 fal 上其他模型（如音乐生成），适合先拿一个 Key 试 BGM+SFX |

- **文档**：https://fal.ai/models/cassetteai/sound-effects-generator/api  
- **音乐**：fal 上也有 CassetteAI music-generator，可同 Key 使用

---

### 2. 背景音乐 (BGM) — MusicAPI.ai 或 Suno 第三方

**方案 A：MusicAPI.ai（有官方 API、有免费额度）**

| 项目 | 说明 |
|------|------|
| **用途** | 文本/歌词 → 完整音乐（人声/器乐、延伸、封面等） |
| **注册** | https://aimusicapi.ai （或 docs.musicapi.ai 文档中的注册入口） |
| **获取 Key** | 注册后 Dashboard 中生成 API Key |
| **环境变量** | `MUSICAPI_KEY=你的key` 或按项目约定命名 |
| **免费** | 注册送约 30 credits；Starter/Pro 有 0 元档（约 250/750 次生成/月，以官网为准） |
| **定价** | 超出后约 $0.08/10 credits（约 1 次生成 = 10 credits，具体见文档） |
| **文档** | https://docs.musicapi.ai |

**方案 B：Suno 第三方（无官方 API 时的选择）**

| 项目 | 说明 |
|------|------|
| **用途** | 文本/歌词 → Suno 风格歌曲，质量高 |
| **说明** | Suno 官方暂无公开 API，需用第三方封装服务 |
| **示例服务** | sunoapi.com、sunoapi.org 等（需自行甄别合规与稳定性） |
| **获取 Key** | 例如 sunoapi.com → 注册 → Dashboard/API Key 页面生成 |
| **环境变量** | 如 `SUNO_API_KEY=你的key` 或服务商要求的变量名 |
| **定价** | 各第三方不同，约 $8/月起或按次约 $0.01–0.02/次，以服务商页面为准 |

---

## 二、按需补充（可选）

### 3. 音效 (SFX) — ElevenLabs Sound Effects

| 项目 | 说明 |
|------|------|
| **用途** | 文本 → 高质量音效，支持时长、循环等，适合电影/游戏级 |
| **注册** | https://elevenlabs.io |
| **获取 Key** | https://elevenlabs.io/app/settings/api-keys 创建 API Key |
| **环境变量** | `ELEVENLABS_API_KEY=你的key` |
| **免费** | 有免费档（非商用+署名）；音效商用约 $0.07/次（Business 档） |
| **文档** | https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert |

适合：需要更高品质 SFX 或已有 ElevenLabs 账号时作为 fal 的补充。

---

### 4. 音乐 + 音效一体 — Beatoven.ai

| 项目 | 说明 |
|------|------|
| **用途** | BGM + SFX 都支持，Fairly Trained 认证 |
| **获取 Key** | 无公开自助 API Key 页，需发邮件 **hello@beatoven.ai** 说明用途，由团队发放 |
| **环境变量** | 拿到 Key 后如 `BEATOVEN_API_KEY=你的key` |
| **定价** | 官网订阅制（如 $100/年约 30 分钟/月）；API 具体价格需与对方确认 |

适合：希望 BGM+SFX 同一家、且可接受邮件申请时使用。

---

## 三、环境变量汇总（拿到 Key 后填写）

在项目根目录 `.env` 或系统环境变量中配置（变量名可与实现约定一致）：

```bash
# 音效 (SFX) — 二选一或都配
FAL_KEY=你的fal_key                    # 推荐，约 $0.01/次
# FAL_QUEUE_TIMEOUT_MS=300000          # 可选，fal 队列等待上限（毫秒），默认音效 120s、音乐 180s、图片 120s；遇 "fal queue timeout" 可适当加大
# FAL_MEDIA_DOWNLOAD_TIMEOUT_MS=900000 # 可选，fal.media 下载超时（毫秒），默认 15 分钟；国内服务器访问 fal.media 较慢，可适当加大
# FAL_MEDIA_PARALLEL_CHUNKS=4          # 可选，并行分段下载的并发数（2–8，默认 4），用于加速 fal.media 大文件下载
ELEVENLABS_API_KEY=你的elevenlabs_key  # 可选，更高品质

# 背景音乐 (BGM) — 使用 fal Key，与音效共用（llm.generate_music 仅用 fal.ai）
# MUSICAPI_KEY / SUNO_API_KEY 等为可选第三方，当前未接入

# 若使用 Beatoven（需先邮件申请）
# BEATOVEN_API_KEY=你的beatoven_key
```

---

## 四、推荐获取顺序（你去拿 Key 的顺序）

1. **fal.ai** — 注册 → 创建 API Key → 存为 `FAL_KEY`  
   - 立刻可做：音效生成；同一 Key 可试 CassetteAI 音乐。
2. **MusicAPI.ai** — 注册 → Dashboard 拿 Key → 存为 `MUSICAPI_KEY`  
   - 立刻可做：BGM 生成，且有免费额度。
3. （可选）**ElevenLabs** — 需要更好音效时再补 `ELEVENLABS_API_KEY`。
4. （可选）**Suno 第三方** — 若确定要 Suno 风格再注册对应服务拿 `SUNO_API_KEY`。
5. （可选）**Beatoven** — 需要一体方案时发邮件申请，再配 `BEATOVEN_API_KEY`。

实现 R022 时，优先对接 **FAL_KEY**（音效 + 可选音乐）和 **MUSICAPI_KEY**（BGM），即可覆盖「应用/游戏」所需的音乐与音效生成；其余 Key 按需启用。
