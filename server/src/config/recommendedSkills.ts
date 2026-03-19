/**
 * 精选 Skill 推荐列表：供 SaaS 试用/个人版展示，一键安装。
 * 格式与 SkillHub 兼容，前端可调用 skill.install(source: "skillhub:<slug>") 安装。
 * slug 需与 SkillHub (skillhub.ai) 上的实际包名一致，格式: owner/repo/skill-name
 */
export interface RecommendedSkill {
  slug: string;
  name: string;
  description: string;
  category?: 'search' | 'office' | 'dev' | 'research' | 'general' | 'openclaw';
  /** 来源：skillhub 或 openclaw */
  source?: 'skillhub' | 'openclaw';
}

/** OpenClaw Skills 列表（从 GitHub 抓取） */
export const OPENCLAW_SKILLS: RecommendedSkill[] = [
  { slug: 'weather', name: '天气查询', description: '获取全球天气和预报，无需 API Key', category: 'openclaw', source: 'openclaw' },
  { slug: 'notion', name: 'Notion 集成', description: '读写 Notion 页面和数据库', category: 'openclaw', source: 'openclaw' },
  { slug: 'obsidian', name: 'Obsidian 笔记', description: '管理 Obsidian  vault 中的笔记', category: 'openclaw', source: 'openclaw' },
  { slug: 'github', name: 'GitHub 管理', description: '管理 GitHub issues、prs 和仓库', category: 'openclaw', source: 'openclaw' },
  { slug: 'spotify-player', name: 'Spotify 播放器', description: '控制 Spotify 播放音乐', category: 'openclaw', source: 'openclaw' },
  { slug: 'slack', name: 'Slack 消息', description: '发送和接收 Slack 消息', category: 'openclaw', source: 'openclaw' },
  { slug: 'discord', name: 'Discord 消息', description: '发送和接收 Discord 消息', category: 'openclaw', source: 'openclaw' },
  { slug: '1password', name: '1Password 集成', description: '从 1Password 获取凭据', category: 'openclaw', source: 'openclaw' },
  { slug: 'bear-notes', name: 'Bear 笔记', description: '管理 Bear 笔记应用', category: 'openclaw', source: 'openclaw' },
  { slug: 'apple-notes', name: 'Apple Notes', description: '管理 Apple Notes 笔记', category: 'openclaw', source: 'openclaw' },
  { slug: 'things-mac', name: 'Things 任务', description: '管理 Things 3 待办事项', category: 'openclaw', source: 'openclaw' },
  { slug: 'trello', name: 'Trello 看板', description: '管理 Trello 看板和卡片', category: 'openclaw', source: 'openclaw' },
  { slug: 'blogwatcher', name: '博客监控', description: '监控博客更新和 RSS', category: 'openclaw', source: 'openclaw' },
  { slug: 'openai-image-gen', name: 'DALL-E 图像生成', description: '使用 OpenAI DALL-E 生成图像', category: 'openclaw', source: 'openclaw' },
  { slug: 'nano-pdf', name: 'PDF 处理', description: '解析和处理 PDF 文档', category: 'openclaw', source: 'openclaw' },
  { slug: 'voice-call', name: '语音通话', description: '通过 Twilio 进行语音通话', category: 'openclaw', source: 'openclaw' },
  { slug: 'gemini', name: 'Gemini 模型', description: '使用 Google Gemini 模型', category: 'openclaw', source: 'openclaw' },
  { slug: 'gog', name: 'GoG 游戏', description: '管理 GoG 游戏库', category: 'openclaw', source: 'openclaw' },
  { slug: 'sonoscli', name: 'Sonos 音响', description: '控制 Sonos 音响系统', category: 'openclaw', source: 'openclaw' },
  { slug: 'openhue', name: 'Philips Hue', description: '控制 Philips Hue 智能灯', category: 'openclaw', source: 'openclaw' },
  { slug: 'himalaya', name: '邮件客户端', description: '通过 himalaya 管理邮件', category: 'openclaw', source: 'openclaw' },
  { slug: 'imsg', name: 'iMessage', description: '发送和接收 iMessage', category: 'openclaw', source: 'openclaw' },
  { slug: 'bluebubbles', name: 'BlueBubbles', description: 'iMessage Mac 服务器集成', category: 'openclaw', source: 'openclaw' },
  { slug: 'wacli', name: 'Wa.me 消息', description: '通过 wa.me 发送 WhatsApp 消息', category: 'openclaw', source: 'openclaw' },
  { slug: 'session-logs', name: '会话日志', description: '记录和管理对话日志', category: 'openclaw', source: 'openclaw' },
  { slug: 'xurl', name: 'URL 缩短', description: '缩短和解析 URL', category: 'openclaw', source: 'openclaw' },
];

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  { slug: 'openclaw/skills/serpapi', name: 'SerpAPI 搜索', description: '通过 SerpAPI 进行网页搜索，获取实时信息', category: 'search' },
  { slug: 'modelscope/ms-agent/docx', name: 'Word 文档', description: '创建和编辑 Word 文档，支持中文', category: 'office' },
  { slug: 'openclaw/skills/excel', name: 'Excel 助手', description: '处理 Excel 表格，支持读取、分析和生成', category: 'office' },
  { slug: 'openclaw/skills/weather-query', name: '天气查询', description: '获取全球天气和预报（和风天气 API）', category: 'search' },
  { slug: 'openclaw/skills/notion', name: 'Notion 集成', description: '读写 Notion 页面和数据库', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/obsidian', name: 'Obsidian 笔记', description: '管理 Obsidian vault 中的笔记', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/github', name: 'GitHub 管理', description: '管理 GitHub issues、prs 和仓库', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/spotify-player', name: 'Spotify 播放器', description: '控制 Spotify 播放音乐', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/slack', name: 'Slack 消息', description: '发送和接收 Slack 消息', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/discord', name: 'Discord 消息', description: '发送和接收 Discord 消息', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/bear-notes', name: 'Bear 笔记', description: '管理 Bear 笔记应用', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/things-mac', name: 'Things 任务', description: '管理 Things 3 待办事项', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/trello', name: 'Trello 看板', description: '管理 Trello 看板和卡片', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/nano-pdf', name: 'PDF 处理', description: '解析和处理 PDF 文档', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/voice-call', name: '语音通话', description: '通过 Twilio 进行语音通话', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/himalaya', name: '邮件客户端', description: '通过 himalaya 管理邮件', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/imsg', name: 'iMessage', description: '发送和接收 iMessage', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/weather', name: '天气查询(开源)', description: '获取全球天气和预报，无需 API Key（wttr.in）', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/1password', name: '1Password 集成', description: '从 1Password 获取凭据', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/apple-notes', name: 'Apple Notes', description: '管理 Apple Notes 笔记', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/gemini', name: 'Gemini 模型', description: '使用 Google Gemini 模型', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/openhue', name: 'Philips Hue', description: '控制 Philips Hue 智能灯', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/bluebubbles', name: 'BlueBubbles', description: 'iMessage Mac 服务器集成', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/session-logs', name: '会话日志', description: '记录和管理对话日志', category: 'openclaw', source: 'openclaw' },
  { slug: 'openclaw/skills/xurl', name: 'URL 缩短', description: '缩短和解析 URL', category: 'openclaw', source: 'openclaw' },
];
