/**
 * Task Store - Stub implementation
 * The approval/task planning system was deprecated; this stub provides the minimal
 * interface used by ChatApp.tsx.
 */
import { create } from 'zustand';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval';
  steps?: Array<{ action: string; output?: string; error?: string }>;
  result?: string;
}

interface TaskStore {
  tasks: Task[];
  upsertTask: (id: string, task: Task) => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  upsertTask: (id: string, task: Task) =>
    set((state) => {
      const idx = state.tasks.findIndex((t) => t.id === id);
      if (idx >= 0) {
        const newTasks = [...state.tasks];
        newTasks[idx] = task;
        return { tasks: newTasks };
      }
      return { tasks: [...state.tasks, task] };
    }),
}));
