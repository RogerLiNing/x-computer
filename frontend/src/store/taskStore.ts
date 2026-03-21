import { create } from 'zustand';
import type { Task, TaskStep, ApprovalRequest, AuditEntry } from '@shared/index';

interface TaskStore {
  // Tasks (enhanced)
  tasks: Task[];
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  upsertTask: (taskId: string, data: any) => void;
  syncTasks: (tasks: Task[]) => void;
  updateTaskStep: (taskId: string, stepId: string, updates: Partial<TaskStep>) => void;
  removeTask: (taskId: string) => void;

  // Approvals
  approvals: ApprovalRequest[];
  addApproval: (req: ApprovalRequest) => void;
  resolveApproval: (id: string, status: 'approved' | 'rejected') => void;

  // Audit
  auditLog: AuditEntry[];
  addAuditEntry: (entry: AuditEntry) => void;
  syncAuditLog: (entries: AuditEntry[]) => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  // -- Tasks (enhanced) --
  tasks: [],
  addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),

  updateTask: (taskId, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...updates, updatedAt: Date.now() } : t)),
    })),

  upsertTask: (taskId, data) =>
    set((s) => {
      const idx = s.tasks.findIndex((t) => t.id === taskId);
      if (idx >= 0) {
        const tasks = [...s.tasks];
        tasks[idx] = { ...tasks[idx], ...data, updatedAt: Date.now() };
        return { tasks };
      }
      // 新任务：完整对象直接插入；仅 status/result 时也插入最小项，便于对话里「查看任务」能收到完成状态
      const inserted = data.domain && data.title ? data : { id: taskId, ...data, updatedAt: Date.now() };
      return { tasks: [inserted, ...s.tasks] };
    }),

  syncTasks: (tasks) => set({ tasks: Array.isArray(tasks) ? tasks : [] }),

  updateTaskStep: (taskId, stepId, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const steps = t.steps ?? [];
        return {
          ...t,
          updatedAt: Date.now(),
          steps: steps.map((step) =>
            step.id === stepId ? { ...step, ...updates } : step,
          ),
        };
      }),
    })),

  removeTask: (taskId) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) })),

  // -- Approvals --
  approvals: [],
  addApproval: (req) =>
    set((s) => {
      if (s.approvals.some((a) => a.id === req.id)) return {};
      return { approvals: [req, ...s.approvals] };
    }),
  resolveApproval: (id, status) =>
    set((s) => ({
      approvals: s.approvals.map((a) =>
        a.id === id ? { ...a, status, resolvedAt: Date.now() } : a,
      ),
    })),

  // -- Audit --
  auditLog: [],
  addAuditEntry: (entry) =>
    set((s) => ({ auditLog: [...s.auditLog, entry] })),
  syncAuditLog: (entries) => set({ auditLog: Array.isArray(entries) ? entries : [] }),
}));
