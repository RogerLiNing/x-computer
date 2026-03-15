/**
 * 工作流引擎类型定义（简化 BPMN 风格）
 */

export type NodeType = 'start' | 'task' | 'exclusive' | 'parallel' | 'end';
export type TaskType = 'ai' | 'script' | 'http' | 'manual';

export interface FlowNode {
  id: string;
  type: NodeType;
  taskType?: TaskType;
  config?: Record<string, unknown>;
}

export interface FlowEdge {
  from: string;
  to: string;
  condition?: string; // 表达式如 price >= 1900，仅 exclusive 出边有效
}

export type TriggerType = 'timer' | 'event';

export interface TriggerConfig {
  type: TriggerType;
  cron?: string;
  in_minutes?: number;
  in_hours?: number;
  eventName?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  triggers?: TriggerConfig[];
}

export type InstanceStatus = 'running' | 'completed' | 'failed' | 'suspended';

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  userId: string;
  status: InstanceStatus;
  currentNodeIds: string[]; // 当前活动节点（并行时多个）
  variables: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  error?: string;
}
