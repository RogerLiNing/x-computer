import type { TaskDomain } from '@shared/index';

export function useDomainDetection() {
  function detectDomain(text: string): TaskDomain {
    const t = text.toLowerCase();
    if (t.includes('代码') || t.includes('编程') || t.includes('修复') || t.includes('bug') || t.includes('编写') || t.includes('函数'))
      return 'coding';
    if (t.includes('邮件') || t.includes('文档') || t.includes('表格') || t.includes('报告') || t.includes('整理') || t.includes('周报') || t.includes('工作周报'))
      return 'office';
    if (t.includes('帮我') || t.includes('执行') || t.includes('自动') || t.includes('任务') || t.includes('搜索') || t.includes('下载'))
      return 'agent';
    return 'chat';
  }
  return { detectDomain };
}
