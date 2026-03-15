/**
 * 精选 Skill 推荐列表：供 SaaS 试用/个人版展示，一键安装。
 * 格式与 SkillHub 兼容，前端可调用 skill.install(source: "skillhub:<slug>") 安装。
 * slug 需与 SkillHub (skillhub.ai) 上的实际包名一致。
 */
export interface RecommendedSkill {
  slug: string;
  name: string;
  description: string;
  category?: 'search' | 'office' | 'dev' | 'research' | 'general';
}

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  { slug: 'serpapi-search', name: 'SerpAPI 搜索', description: '通过 SerpAPI 进行网页搜索，获取实时信息', category: 'search' },
  { slug: 'docx-cn', name: 'Word 文档', description: '创建和编辑 Word 文档，支持中文', category: 'office' },
  { slug: 'excel-helper', name: 'Excel 助手', description: '处理 Excel 表格，支持读取、分析和生成', category: 'office' },
  { slug: 'code-explainer', name: '代码解释', description: '解释代码逻辑、生成注释和文档', category: 'dev' },
  { slug: 'unit-test-gen', name: '单元测试生成', description: '根据代码自动生成单元测试用例', category: 'dev' },
  { slug: 'pdf-summarizer', name: 'PDF 总结', description: '总结 PDF 文档核心内容，提取要点', category: 'research' },
  { slug: 'email-helper', name: '邮件助手', description: '起草、整理和发送邮件', category: 'office' },
];
