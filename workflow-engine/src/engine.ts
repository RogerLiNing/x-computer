/**
 * 工作流执行引擎：状态机、变量、条件求值
 */

import type { WorkflowDefinition, WorkflowInstance, FlowNode, FlowEdge } from './types.js';

/** 安全表达式求值（仅支持简单比较与逻辑），变量从 variables 读取 */
export function evalCondition(condition: string, variables: Record<string, unknown>): boolean {
  if (!condition || condition.trim() === '') return true;
  const expr = condition.trim();
  if (expr === 'true') return true;
  if (expr === 'false') return false;

  try {
    // 支持：variable >= 100, variable < 50, price >= 1900, flag
    const parts = expr.split(/\s*(>=|<=|>|<|==|!=)\s*/).filter(Boolean);
    if (parts.length === 1) {
      const v = variables[parts[0]];
      return Boolean(v);
    }
    if (parts.length === 3) {
      const leftKey = parts[0].trim();
      const op = parts[1];
      const rightRaw = parts[2].trim();
      const left = variables[leftKey];
      let right: unknown = rightRaw;
      if (/^-?\d+\.?\d*$/.test(rightRaw)) right = Number(rightRaw);
      else if (rightRaw === 'true') right = true;
      else if (rightRaw === 'false') right = false;
      else if (rightRaw.startsWith('"') && rightRaw.endsWith('"')) right = rightRaw.slice(1, -1);

      switch (op) {
        case '>=':
          return Number(left) >= Number(right);
        case '<=':
          return Number(left) <= Number(right);
        case '>':
          return Number(left) > Number(right);
        case '<':
          return Number(left) < Number(right);
        case '==':
          return left == right;
        case '!=':
          return left != right;
        default:
          return false;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function findStartNode(def: WorkflowDefinition): FlowNode | null {
  return def.nodes.find((n) => n.type === 'start') ?? null;
}

function getEdgesFrom(def: WorkflowDefinition, nodeId: string): FlowEdge[] {
  return def.edges.filter((e) => e.from === nodeId);
}

function getNode(def: WorkflowDefinition, nodeId: string): FlowNode | undefined {
  return def.nodes.find((n) => n.id === nodeId);
}

/** 获取 exclusive 网关应走的出边（第一个条件为真的） */
export function selectExclusiveEdge(edges: FlowEdge[], variables: Record<string, unknown>): FlowEdge | null {
  for (const e of edges) {
    if (!e.condition || evalCondition(e.condition, variables)) return e;
  }
  return null;
}

/** 执行一步：从当前节点出发，沿边推进，直至遇到 task 或 end */
export function advance(
  def: WorkflowDefinition,
  currentNodeIds: string[],
  variables: Record<string, unknown>,
): { nextNodeIds: string[]; status: 'running' | 'completed' | 'waiting' } {
  let frontier = [...currentNodeIds];
  const visited = new Set<string>();

  while (frontier.length > 0) {
    const nextSet = new Set<string>();
    for (const nid of frontier) {
      if (visited.has(nid)) continue;
      visited.add(nid);
      const node = getNode(def, nid);
      if (!node) continue;

      const edges = getEdgesFrom(def, nid);

      if (node.type === 'end') return { nextNodeIds: [], status: 'completed' };

      if (node.type === 'exclusive') {
        const chosen = selectExclusiveEdge(edges, variables);
        if (chosen) nextSet.add(chosen.to);
        continue;
      }

      if (node.type === 'parallel') {
        // 并行 fork：沿所有出边推进；并行 join：多条入边时由 advance(currentNodeIds) 传入多节点，全部到达后继续
        for (const e of edges) nextSet.add(e.to);
        continue;
      }

      if (node.type === 'start' || node.type === 'task') {
        for (const e of edges) nextSet.add(e.to);
        continue;
      }
    }

    const nextIds = [...nextSet];
    if (nextIds.length === 0) return { nextNodeIds: [], status: 'completed' };

    const nextNodes = nextIds.map((id) => getNode(def, id)).filter(Boolean) as FlowNode[];
    const hasEnd = nextNodes.some((n) => n.type === 'end');
    const hasTask = nextNodes.some((n) => n.type === 'task');

    if (hasEnd && !hasTask) return { nextNodeIds: [], status: 'completed' };
    if (hasTask) return { nextNodeIds: nextIds, status: 'waiting' };

    frontier = nextIds;
  }

  return { nextNodeIds: [], status: 'completed' };
}

/** 新实例的起始节点 */
export function getInitialNodeIds(def: WorkflowDefinition): string[] {
  const start = findStartNode(def);
  if (!start) return [];
  const edges = getEdgesFrom(def, start.id);
  return edges.map((e) => e.to).filter(Boolean);
}
