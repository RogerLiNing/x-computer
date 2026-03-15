/** 快捷任务模板：按场景分类，点击即发送 */
export type TaskTemplateCategory = 'student' | 'office' | 'research' | 'dev';

export interface TaskTemplate {
  id: string;
  category: TaskTemplateCategory;
  labelKey: string;
  textKey: string;
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  // 学生
  { id: 'student-homework', category: 'student', labelKey: 'templates.studentHomework', textKey: 'templates.studentHomeworkText' },
  { id: 'student-literature', category: 'student', labelKey: 'templates.studentLiterature', textKey: 'templates.studentLiteratureText' },
  { id: 'student-reading', category: 'student', labelKey: 'templates.studentReading', textKey: 'templates.studentReadingText' },
  { id: 'student-summarize-pdf', category: 'student', labelKey: 'templates.studentSummarizePdf', textKey: 'templates.studentSummarizePdfText' },
  // 办公
  { id: 'office-weekly', category: 'office', labelKey: 'templates.officeWeekly', textKey: 'templates.officeWeeklyText' },
  { id: 'office-meeting', category: 'office', labelKey: 'templates.officeMeeting', textKey: 'templates.officeMeetingText' },
  { id: 'office-excel', category: 'office', labelKey: 'templates.officeExcel', textKey: 'templates.officeExcelText' },
  { id: 'office-email', category: 'office', labelKey: 'templates.officeEmail', textKey: 'templates.officeEmailText' },
  // 研究
  { id: 'research-review', category: 'research', labelKey: 'templates.researchReview', textKey: 'templates.researchReviewText' },
  { id: 'research-analysis', category: 'research', labelKey: 'templates.researchAnalysis', textKey: 'templates.researchAnalysisText' },
  { id: 'research-visualize', category: 'research', labelKey: 'templates.researchVisualize', textKey: 'templates.researchVisualizeText' },
  // 开发
  { id: 'dev-explain', category: 'dev', labelKey: 'templates.devExplain', textKey: 'templates.devExplainText' },
  { id: 'dev-unit-test', category: 'dev', labelKey: 'templates.devUnitTest', textKey: 'templates.devUnitTestText' },
  { id: 'dev-code-review', category: 'dev', labelKey: 'templates.devCodeReview', textKey: 'templates.devCodeReviewText' },
  { id: 'dev-api-doc', category: 'dev', labelKey: 'templates.devApiDoc', textKey: 'templates.devApiDocText' },
];
