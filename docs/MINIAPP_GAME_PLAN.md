# 小程序与小游戏创作增强规划（R023）

目标：**强化 X 创造小程序和小游戏的能力**，通过资源目录约定与主脑指引，使 X 能按用户意图规划、生成资源、写出可运行的小程序或小游戏。

---

## 1. 资源目录约定（R023 实现）

小程序/小游戏的静态资源统一放在 `apps/<id>/assets/` 下，便于 X 生成与引用：

| 路径 | 说明 | 示例 |
|------|------|------|
| `apps/<id>/assets/` | 根资源目录 | 图片、图标 |
| `apps/<id>/assets/images/` | 图片资源 | icon.png、background.png、角色贴图 |
| `apps/<id>/assets/sfx/` | 音效（短音） | click.wav、explosion.wav、jump.wav |
| `apps/<id>/assets/bgm/` | 背景音乐 | theme.wav、menu.wav |

**引用方式**：在 index.html、app.js 中使用相对路径，如 `assets/icon.png`、`assets/sfx/click.wav`、`assets/bgm/theme.wav`。沙箱服务 `/api/apps/sandbox/:userId/apps/:id/` 会正确解析子路径。

**生成工具**：
- 图片：`llm.generate_image` → 保存到 `apps/<id>/assets/images/`
- 音效：`llm.generate_sound_effect` → 保存到 `apps/<id>/assets/sfx/`
- BGM：`llm.generate_music` → 保存到 `apps/<id>/assets/bgm/`

---

## 2. 现状与缺口

- **已有**：x.create_app（工程化 plan.md → index.html/style.css/app.js、或快速单页）、llm.generate_image、llm.generate_sound_effect、llm.generate_music、python.run、沙箱 apps/&lt;id&gt;/ 与静态资源服务。
- **缺口**：X 做「小游戏」时缺少统一约定（资源放哪、plan 结构、先资源后代码），容易一次性写一大坨或漏掉音效/BGM。

---

## 3. 子项与优先级

| 子项 | 说明 | 优先级 | 依赖 |
|------|------|--------|------|
| **2.1 资源目录约定** | 约定 apps/&lt;id&gt;/assets/ 存放图片、音效、BGM（如 icon.png、sfx/click.wav、bgm/theme.mp3）；主脑与 x.create_app 指引中明确「资源统一放 assets，用相对路径引用」 | P2 高 | 无 |
| **2.2 主脑「做小游戏」指引** | 在 x_direct 或系统提示中注入「做小游戏」指引：plan.md 必须包含游戏类型、玩法一句话、资源清单（需生成的图/音效/BGM）、技术选型（Canvas 2D + requestAnimationFrame）、文件结构（index.html、style.css、app.js、assets/）；先写 plan → 自检 → 再按 plan 生成资源（调用 llm.generate_*）与代码 | P2 高 | 2.1 |

---

## 4. 实现要点

1. **文档约定**：在 DEVELOPMENT.md 或本计划中写明「小程序资源目录」：`apps/<id>/assets/`（可选子目录：images/、sfx/、bgm/）；iframe 内引用方式：相对路径 `assets/xxx.png`、`assets/sfx/click.wav` 等（与现有 /api/apps/sandbox/:userId/apps/:id/ 路径一致）。
2. **主脑提示注入**：在 systemCore 或 x_direct 组装逻辑中，当能力列表包含 llm.generate_image、llm.generate_sound_effect、llm.generate_music 时，追加一段「做小游戏/小程序」指引（见下节示例），要求先 plan.md、再按 plan 生成资源与代码、最后 x.create_app 注册。
3. **错误与日志**：已有 x.get_app_logs；可提示 X 在生成小游戏后建议用户「若白屏或报错，请告诉我，我会用 x.get_app_logs 排查」。

---

## 5. 「做小游戏」指引示例（供注入主脑）

可追加到主脑系统提示或 x_direct 的 capability 说明中：

```
当用户要求「做一个小游戏」或做需音效/图片的小程序时：
1) 在 apps/<id>/ 下先只写 plan.md，内容必须包含：游戏类型与一句话玩法、需要生成的资源清单（如：背景图、按钮音效、BGM、角色贴图）、技术选型（建议 Canvas 2D + requestAnimationFrame）、文件结构（index.html、style.css、app.js、assets/images/、assets/sfx/、assets/bgm/）。
2) 用 file.read 自检 plan.md，不完善则完善后再次自检。
3) 按 plan 依次生成资源：图片用 llm.generate_image 保存到 apps/<id>/assets/...，音效用 llm.generate_sound_effect、BGM 用 llm.generate_music 保存到 apps/<id>/assets/sfx/、assets/bgm/。
4) 再创建 index.html、style.css、app.js，其中 HTML 用 <canvas>、JS 里实现游戏循环与事件，资源引用使用相对路径 assets/xxx。
5) 最后调用 x.create_app(app_id, name) 仅注册。不要一次性生成所有文件，按步骤 1→2→3→4→5 执行。
```

### 5.1 音效/BGM 必须在用户手势下「解锁」（必做）

浏览器规定：**第一次**对 `HTMLAudioElement` 或 `AudioContext` 的播放必须在**用户手势的同步调用栈**内（例如点击按钮时直接调用），否则会被静默拦截。若在游戏循环（requestAnimationFrame / update）里才第一次 `play()`，音效不会响。

**正确做法**：在用户点击「开始游戏」的回调里（如 `startGame()`），**立即**对每个音效做一次「解锁」：调用 `audio.play().then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => {})`，不播放出声，但让浏览器允许该元素后续在任意时机播放。然后再启动 BGM 和游戏循环。示例：

```js
// 在 startGame() 开头、启动游戏循环之前执行一次（用户已点击「开始」）
function unlockAudioForGesture() {
    [shootSound, hitSound, explosionSound].filter(Boolean).forEach(audio => {
        audio.play().then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => {});
    });
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
}
startGame() {
    // ...
    unlockAudioForGesture();  // 必须在 startGame 内、用户点击触发的栈里调用
    // 再 playBGM()、gameLoop() 等
}
```

BGM 若用 Web Audio API，同样在 `startGame()` 里先 `audioContext.resume()`（该代码已有即可）。

---

## 6. 与 R022 的关系

R022（多媒体资源生成）已提供 llm.generate_image、llm.generate_sound_effect、llm.generate_music 与设置页配置。R023 在此基础上：**约定资源放哪、怎么规划（plan）、怎么在提示里教 X 做小游戏**，使「做小游戏」从「能做但容易乱」变为「有章法、易出可玩结果」。

---

## 7. 验收标准

- 用户对 X 说「帮我做一个小游戏」或类似需求时，X 能产出可在桌面打开并**可玩**的小程序（有基本玩法、有资源引用、无致命报错）。
- 资源（图片/音效/BGM）集中在 apps/&lt;id&gt;/assets/，与文档约定一致。
