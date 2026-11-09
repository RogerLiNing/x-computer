import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { NODE_WS_PATH, parseNodeMessage, type NodeChatMessage, type NodeMetrics, type NodeToServerMessage, type NodeTaskAssignment, type NodeToolDef, type ServerToNodeMessage } from '../../../shared/src/nodeProtocol.js';
import { serverLogger } from '../observability/ServerLogger.js';
import type { NodeRecord, NodeRegistry } from './NodeRegistry.js';

export interface ModelProxyRequest { userId: string; nodeId: string; taskId?: string; messages: NodeChatMessage[]; tools: NodeToolDef[]; onChunk: (delta: string) => void; signal: AbortSignal }
export interface ModelProxyResult { content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }

export interface NodeGatewayEvents {
  onProgress(node: NodeRecord, progress: Extract<NodeToServerMessage, { type: 'task/progress' }>['progress']): void | Promise<void>;
  onResult(node: NodeRecord, result: Extract<NodeToServerMessage, { type: 'task/result' }>['result']): void | Promise<void>;
  onQuestion(node: NodeRecord, question: Extract<NodeToServerMessage, { type: 'task/question' }>): void | Promise<void>;
  onOnline?(node: NodeRecord): void | Promise<void>;
  onOffline?(node: NodeRecord): void | Promise<void>;
}

export interface NodeGatewayOptions {
  registry: NodeRegistry;
  /** Runs one model call on behalf of the node's owner; the gateway streams the chunks back. */
  callModel: (request: ModelProxyRequest) => Promise<ModelProxyResult>;
  events: NodeGatewayEvents;
  heartbeatIntervalMs?: number;
  /** A node silent for this long is dropped. */
  staleAfterMs?: number;
}

interface Connection { node: NodeRecord; ws: WebSocket; lastSeenAt: number; modelCalls: Map<string, AbortController> }

export interface ExecStream { onOutput(stream: 'stdout' | 'stderr', data: string): void }

const DEFAULT_HEARTBEAT_MS = 15_000;
const MAX_PAYLOAD = 4 * 1024 * 1024;

/**
 * Accepts node agents over WebSocket, authenticates them against the registry, keeps one connection
 * per node, proxies their model requests to the owner's models, and relays task traffic.
 */
export class NodeGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  private readonly connections = new Map<string, Connection>();
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly execStreams = new Map<string, ExecStream & { resolve: (exit: { exitCode: number | null; timedOut?: boolean }) => void }>();
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private sweeper?: NodeJS.Timeout;

  constructor(private readonly options: NodeGatewayOptions) {
    this.heartbeatMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this.staleMs = options.staleAfterMs ?? this.heartbeatMs * 4;
    this.wss.on('connection', (ws, request) => void this.accept(ws, request));
  }

  /** Call with the upgrade router: `router.register(NODE_WS_PATH, gateway.handleUpgrade)`. */
  readonly handleUpgrade = (request: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    this.wss.handleUpgrade(request, socket, head, (ws) => this.wss.emit('connection', ws, request));
  };

  get path(): string { return NODE_WS_PATH; }

  start(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), this.heartbeatMs);
    this.sweeper.unref();
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
    for (const connection of this.connections.values()) connection.ws.close(1001, 'Server shutting down');
    this.wss.close();
  }

  isOnline(nodeId: string): boolean {
    return this.connections.get(nodeId)?.ws.readyState === WebSocket.OPEN;
  }

  onlineNodeIds(): string[] {
    return [...this.connections.keys()].filter((id) => this.isOnline(id));
  }

  send(nodeId: string, message: ServerToNodeMessage): boolean {
    const connection = this.connections.get(nodeId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) return false;
    connection.ws.send(JSON.stringify(message));
    return true;
  }

  assignTask(nodeId: string, task: NodeTaskAssignment): boolean {
    return this.send(nodeId, { type: 'task/assign', task });
  }

  /** Runs a command on the node and streams output; resolves with the exit status. */
  exec(nodeId: string, command: string, stream: ExecStream, options: { cwd?: string; timeoutMs?: number } = {}): Promise<{ exitCode: number | null; timedOut?: boolean }> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timeoutMs = options.timeoutMs ?? 120_000;
      const timer = setTimeout(() => { this.execStreams.delete(id); this.send(nodeId, { type: 'exec/kill', id }); reject(new Error('节点命令超时，已发送终止')); }, timeoutMs + 5_000);
      this.execStreams.set(id, { ...stream, resolve: (exit) => { clearTimeout(timer); this.execStreams.delete(id); resolve(exit); } });
      if (!this.send(nodeId, { type: 'exec/run', id, command, cwd: options.cwd, timeoutMs })) { clearTimeout(timer); this.execStreams.delete(id); reject(new Error('节点不在线')); }
    });
  }

  /** Request/response helper for fs operations. */
  request<T>(nodeId: string, message: ServerToNodeMessage & { id: string }, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(message.id); reject(new Error('节点没有在限定时间内响应')); }, timeoutMs);
      this.pending.set(message.id, { resolve: (value) => resolve(value as T), reject, timer });
      if (!this.send(nodeId, message)) { clearTimeout(timer); this.pending.delete(message.id); reject(new Error('节点不在线')); }
    });
  }

  private async accept(ws: WebSocket, request: http.IncomingMessage): Promise<void> {
    const nodeId = request.headers['x-node-id'];
    const nodeKey = request.headers['x-node-key'];
    const node = typeof nodeId === 'string' && typeof nodeKey === 'string' ? await this.options.registry.authenticate(nodeId, nodeKey) : undefined;
    if (!node) { ws.close(1008, 'Node authentication failed'); return; }
    const previous = this.connections.get(node.id);
    if (previous) { previous.ws.close(1000, 'Replaced by a newer connection'); }
    const connection: Connection = { node, ws, lastSeenAt: Date.now(), modelCalls: new Map() };
    this.connections.set(node.id, connection);
    ws.on('message', (raw) => void this.handle(connection, raw));
    ws.on('close', () => {
      for (const controller of connection.modelCalls.values()) controller.abort();
      if (this.connections.get(node.id) === connection) {
        this.connections.delete(node.id);
        void this.options.events.onOffline?.(node);
      }
    });
    ws.on('error', (error) => serverLogger.warn('nodes', `节点 ${node.name} 连接出错`, error.message));
    ws.send(JSON.stringify({ type: 'welcome', nodeId: node.id, serverTime: Date.now(), heartbeatIntervalMs: this.heartbeatMs } satisfies ServerToNodeMessage));
    await this.options.registry.touch(node.id, {});
    void this.options.events.onOnline?.(node);
  }

  private async handle(connection: Connection, raw: unknown): Promise<void> {
    const message = parseNodeMessage(typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : String(raw)) as NodeToServerMessage | undefined;
    if (!message) return;
    connection.lastSeenAt = Date.now();
    const { node } = connection;
    try {
      switch (message.type) {
        case 'hello':
          await this.options.registry.touch(node.id, { specs: message.specs, labels: message.labels });
          return;
        case 'heartbeat':
          await this.options.registry.touch(node.id, { metrics: message.metrics as NodeMetrics });
          return;
        case 'model/request':
          await this.proxyModel(connection, message);
          return;
        case 'task/progress':
          await this.options.events.onProgress(node, message.progress);
          return;
        case 'task/result':
          await this.options.events.onResult(node, message.result);
          return;
        case 'task/question':
          await this.options.events.onQuestion(node, message);
          return;
        case 'exec/output':
          this.execStreams.get(message.id)?.onOutput(message.stream, message.data);
          return;
        case 'exec/exit':
          this.execStreams.get(message.id)?.resolve({ exitCode: message.exitCode, timedOut: message.timedOut });
          return;
        case 'fs/result': {
          const waiter = this.pending.get(message.id);
          if (!waiter) return;
          clearTimeout(waiter.timer);
          this.pending.delete(message.id);
          if (message.ok) waiter.resolve(message.data); else waiter.reject(new Error(message.error ?? '节点文件操作失败'));
          return;
        }
        case 'error':
          serverLogger.warn('nodes', `节点 ${node.name} 报错`, message.message);
          return;
      }
    } catch (error: unknown) {
      serverLogger.warn('nodes', `处理节点 ${node.name} 消息失败`, error instanceof Error ? error.message : String(error));
    }
  }

  private async proxyModel(connection: Connection, message: Extract<NodeToServerMessage, { type: 'model/request' }>): Promise<void> {
    const controller = new AbortController();
    connection.modelCalls.set(message.id, controller);
    try {
      const result = await this.options.callModel({
        userId: connection.node.userId, nodeId: connection.node.id, taskId: message.taskId,
        messages: message.messages, tools: message.tools, signal: controller.signal,
        onChunk: (delta) => { if (delta) this.send(connection.node.id, { type: 'model/chunk', id: message.id, delta }); },
      });
      this.send(connection.node.id, { type: 'model/done', id: message.id, content: result.content, toolCalls: result.toolCalls });
    } catch (error: unknown) {
      this.send(connection.node.id, { type: 'model/error', id: message.id, message: error instanceof Error ? error.message : String(error) });
    } finally {
      connection.modelCalls.delete(message.id);
    }
  }

  private sweep(): void {
    const cutoff = Date.now() - this.staleMs;
    for (const connection of this.connections.values()) {
      if (connection.lastSeenAt < cutoff) connection.ws.close(1001, 'Heartbeat lost');
    }
  }
}
