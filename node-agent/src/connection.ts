import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { NODE_PROTOCOL_VERSION, NODE_WS_PATH, parseNodeMessage, type NodeChatMessage, type NodeMetrics, type NodeSpecs, type NodeToServerMessage, type NodeToolDef, type ServerToNodeMessage } from '../../shared/src/nodeProtocol.js';
import { websocketUrl } from './config.js';

export interface ModelReply { content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }

export interface ConnectionOptions {
  serverUrl: string;
  nodeId: string;
  nodeKey: string;
  specs: NodeSpecs;
  labels: string[];
  collectMetrics: () => Promise<NodeMetrics>;
  onMessage: (message: ServerToNodeMessage) => void;
  log?: (line: string) => void;
  /** Backoff bounds for reconnects. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * The node's one link to X: connects outbound, says hello, heartbeats, reconnects with backoff, and
 * correlates model requests with their streamed replies.
 */
export class NodeConnection {
  private ws?: WebSocket;
  private closed = false;
  private backoff: number;
  private heartbeat?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly models = new Map<string, { resolve: (reply: ModelReply) => void; reject: (error: Error) => void; onChunk?: (delta: string) => void; timer: NodeJS.Timeout }>();
  private readonly log: (line: string) => void;

  constructor(private readonly options: ConnectionOptions) {
    this.backoff = options.minBackoffMs ?? 1_000;
    this.log = options.log ?? (() => {});
  }

  get connected(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

  start(): void {
    this.closed = false;
    this.open();
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.ws?.close(1000, 'Node stopping');
    for (const waiter of this.models.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('连接已关闭')); }
    this.models.clear();
  }

  send(message: NodeToServerMessage): boolean {
    if (!this.connected) return false;
    this.ws!.send(JSON.stringify(message));
    return true;
  }

  /** Asks X to run a model call on the owner's behalf; resolves with the final content and tool calls. */
  requestModel(messages: NodeChatMessage[], tools: NodeToolDef[], options: { taskId?: string; onChunk?: (delta: string) => void; timeoutMs?: number } = {}): Promise<ModelReply> {
    return new Promise<ModelReply>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { this.models.delete(id); reject(new Error('模型请求超时')); }, options.timeoutMs ?? 300_000);
      this.models.set(id, { resolve, reject, onChunk: options.onChunk, timer });
      if (!this.send({ type: 'model/request', id, taskId: options.taskId, messages, tools })) { clearTimeout(timer); this.models.delete(id); reject(new Error('当前未连接到 X')); }
    });
  }

  private open(): void {
    if (this.closed) return;
    const url = websocketUrl(this.options.serverUrl, NODE_WS_PATH);
    const ws = new WebSocket(url, { headers: { 'x-node-id': this.options.nodeId, 'x-node-key': this.options.nodeKey } });
    this.ws = ws;
    ws.on('open', () => {
      this.backoff = this.options.minBackoffMs ?? 1_000;
      this.log(`已连接 ${url}`);
      this.send({ type: 'hello', version: NODE_PROTOCOL_VERSION, specs: this.options.specs, labels: this.options.labels });
      this.startHeartbeat();
    });
    ws.on('message', (raw) => {
      const message = parseNodeMessage(raw.toString()) as ServerToNodeMessage | undefined;
      if (!message) return;
      if (message.type === 'welcome') { this.log(`X 已接受节点 ${message.nodeId}`); return; }
      if (message.type === 'model/chunk' || message.type === 'model/done' || message.type === 'model/error') { this.settleModel(message); return; }
      this.options.onMessage(message);
    });
    ws.on('close', (code, reason) => {
      this.stopHeartbeat();
      for (const waiter of this.models.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('连接中断，模型请求未完成')); }
      this.models.clear();
      if (code === 1008) { this.log(`X 拒绝了节点身份（${reason.toString() || code}），停止重连；请重新注册`); this.closed = true; return; }
      this.log(`连接关闭（${code}），${Math.round(this.backoff / 1000)} 秒后重连`);
      this.scheduleReconnect();
    });
    ws.on('error', (error) => { this.log(`连接错误：${error.message}`); });
  }

  private settleModel(message: Extract<ServerToNodeMessage, { type: 'model/chunk' | 'model/done' | 'model/error' }>): void {
    const waiter = this.models.get(message.id);
    if (!waiter) return;
    if (message.type === 'model/chunk') { waiter.onChunk?.(message.delta); return; }
    clearTimeout(waiter.timer);
    this.models.delete(message.id);
    if (message.type === 'model/done') waiter.resolve({ content: message.content, toolCalls: message.toolCalls });
    else waiter.reject(new Error(message.message));
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.reconnectTimer = setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(this.options.maxBackoffMs ?? 60_000, this.backoff * 2);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const tick = async () => { try { this.send({ type: 'heartbeat', metrics: await this.options.collectMetrics() }); } catch { /* metrics are best effort */ } };
    void tick();
    this.heartbeat = setInterval(() => void tick(), 15_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}
