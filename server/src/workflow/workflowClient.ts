/**
 * 工作流引擎 HTTP 客户端
 */

const BASE_URL = process.env.WORKFLOW_ENGINE_URL ?? 'http://localhost:4001';

async function request<T>(
  method: string,
  path: string,
  options?: { userId?: string; body?: unknown },
): Promise<T> {
  const url = `${BASE_URL}/api${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options?.userId) headers['X-User-Id'] = options.userId;

  const res = await fetch(url, {
    method,
    headers,
    body: options?.body != null ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }

  if (!res.ok) {
    const err = (data as { error?: string })?.error ?? res.statusText;
    throw new Error(`workflow-engine: ${err}`);
  }
  return data as T;
}

export async function workflowDeploy(userId: string, definition: Record<string, unknown>): Promise<{ ok: boolean; definitionId: string }> {
  return request('POST', '/deploy', { userId, body: definition });
}

export async function workflowList(userId: string): Promise<{ definitions: Array<Record<string, unknown>> }> {
  return request('GET', '/definitions', { userId });
}

export async function workflowDelete(userId: string, definitionId: string): Promise<{ ok: boolean }> {
  return request('DELETE', `/definitions/${encodeURIComponent(definitionId)}`, { userId });
}

export async function workflowStart(userId: string, definitionId: string): Promise<{ instanceId: string }> {
  return request('POST', '/start', { userId, body: { definitionId } });
}

export async function workflowListInstances(userId: string, definitionId?: string): Promise<{
  instances: Array<{
    id: string;
    definitionId: string;
    status: string;
    currentNodeIds: string[];
    variables: Record<string, unknown>;
    createdAt: number;
  }>;
}> {
  const path = definitionId ? `/instances?definitionId=${encodeURIComponent(definitionId)}` : '/instances';
  return request('GET', path, { userId });
}

export async function workflowGetInstance(userId: string, instanceId: string): Promise<Record<string, unknown>> {
  return request('GET', `/instances/${encodeURIComponent(instanceId)}`, { userId });
}

export async function workflowGetVariables(userId: string, instanceId: string): Promise<Record<string, unknown>> {
  return request('GET', `/instances/${encodeURIComponent(instanceId)}/variables`, { userId });
}

export async function workflowSetVariables(
  userId: string,
  instanceId: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return request('POST', `/instances/${encodeURIComponent(instanceId)}/variables`, { userId, body: variables });
}

export async function workflowFireEvent(userId: string, eventName: string): Promise<{ started: number } | null> {
  try {
    return await request('POST', '/signal', { body: { userId, eventName } });
  } catch {
    return null;
  }
}

export async function workflowSignal(
  userId: string,
  instanceId: string,
  payload?: { nodeId?: string; variables?: Record<string, unknown> },
): Promise<{ ok: boolean }> {
  return request('POST', `/instances/${encodeURIComponent(instanceId)}/signal`, { userId, body: payload ?? {} });
}
