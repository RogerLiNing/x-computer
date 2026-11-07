/**
 * Task Templates - Stub implementation
 * This file was deleted but is still referenced by ChatApp.tsx
 */

export type TaskTemplateCategory = 'student' | 'office' | 'research' | 'dev';

export interface TaskTemplate {
  id: string;
  labelKey: string;
  textKey: string;
  category: TaskTemplateCategory;
}

export const TASK_TEMPLATES: TaskTemplate[] = [];
