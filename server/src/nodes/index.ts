import { callLLMWithToolsStream, type ChatMessage } from '../chat/chatService.js';
import type { AppDatabase } from '../db/database.js';
import { resolveLLMCredentials } from '../llm/credentialResolver.js';
import { isVirtualModel, resolveAutoRoute, routeVirtualModel } from '../llm/virtualModel.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { NotificationService } from '../services/NotificationService.js';
import { withModelBudget } from '../subscription/modelBudget.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { broadcastToUser } from '../wsBroadcast.js';
import { NodeGateway, type ModelProxyRequest, type ModelProxyResult } from './NodeGateway.js';
import { NodeRegistry } from './NodeRegistry.js';
import { NodeTaskService, type NodeTask } from './NodeTaskService.js';

export { NodeGateway } from './NodeGateway.js';
export { NodeRegistry } from './NodeRegistry.js';
export { NodeTaskService } from './NodeTaskService.js';
export type { NodeTask } from './NodeTaskService.js';
export { createUpgradeRouter } from './upgradeRouter.js';

export interface NodeRuntime { registry: NodeRegistry; gateway: NodeGateway; tasks: NodeTaskService }

/** The node borrows the owner's brain: credentials, auto routing and budget are all the owner's. */
async function callOwnerModel(db: AppDatabase, subscriptionService: SubscriptionService | undefined, request: ModelProxyRequest): Promise<ModelProxyResult> {
  let config = await resolveLLMCredentials(request.userId, db, subscriptionService);
  if (!config?.providerId || !config.modelId) throw new Error('节点所属用户尚未配置可用模型');
  if (isVirtualModel(config.modelId)) {
    let userConfig: unknown;
    try { const raw = await db.getConfig(request.userId, 'llm_config'); userConfig = raw ? JSON.parse(raw) : undefined; } catch { userConfig = undefined; }
    const route = resolveAutoRoute(userConfig);
    if (!route) throw new Error('选择了 auto 模型但未配置 autoRoute');
    const lastUser = [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    const decision = routeVirtualModel({ toolCount: request.tools.length, hasImages: false, promptText: request.messages.map((message) => message.content).join('\n'), lastUserMessage: lastUser }, route);
    config = await resolveLLMCredentials(request.userId, db, subscriptionService, decision.model);
    if (!config) throw new Error('自动路由选中的模型没有可用凭证');
  }
  const run = () => callLLMWithToolsStream({ messages: request.messages as ChatMessage[], providerId: config!.providerId, modelId: config!.modelId, baseUrl: config!.baseUrl, apiKey: config!.apiKey, apiType: config!.apiType, signal: request.signal }, request.tools, request.onChunk);
  const result = subscriptionService ? await withModelBudget({ service: subscriptionService, userId: request.userId, runId: request.taskId ?? `node:${request.nodeId}`, signal: request.signal }, run) : await run();
  return { content: result.content, toolCalls: result.toolCalls };
}

async function notifyOwner(task: NodeTask, event: 'completed' | 'failed' | 'question'): Promise<void> {
  const title = event === 'completed' ? `节点「${task.nodeName}」完成了任务` : event === 'failed' ? `节点「${task.nodeName}」的任务失败` : `节点「${task.nodeName}」需要你回答`;
  const body = event === 'question' ? task.question?.question ?? '' : [task.goal.slice(0, 120), (task.result?.content ?? task.result?.error ?? '').slice(0, 1200)].filter(Boolean).join('\n');
  await NotificationService.notify({ userId: task.userId, type: event === 'completed' ? 'success' : event === 'failed' ? 'error' : 'warning', title, body, link: `app:node-task:${task.id}` });
}

export function createNodeRuntime(db: AppDatabase, subscriptionService?: SubscriptionService): NodeRuntime {
  const registry = new NodeRegistry(db);
  let tasks: NodeTaskService;
  const gateway = new NodeGateway({
    registry,
    callModel: (request) => callOwnerModel(db, subscriptionService, request),
    events: {
      onProgress: (node, progress) => tasks.onProgress(node, progress),
      onResult: (node, result) => tasks.onResult(node, result),
      onQuestion: (node, question) => tasks.onQuestion(node, question),
      onOnline: async (node) => { broadcastToUser(node.userId, { type: 'node_online', data: { id: node.id } }); await tasks.flushQueued(node); },
      onOffline: (node) => { broadcastToUser(node.userId, { type: 'node_offline', data: { id: node.id } }); },
    },
  });
  tasks = new NodeTaskService({ db, registry, gateway, notify: notifyOwner, broadcast: broadcastToUser });
  gateway.start();
  serverLogger.info('nodes', '节点网关已就绪', gateway.path);
  return { registry, gateway, tasks };
}
