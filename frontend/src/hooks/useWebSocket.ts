import { useEffect, useRef, useCallback } from 'react';
import { useDesktopStore } from '@/store/desktopStore';
import { useConnectionStore } from '@/store/connectionStore';
import { useConfigStore } from '@/store/configStore';
import { useTaskStore } from '@/store/taskStore';
import { useAiDocumentStore } from '@/store/aiDocumentStore';
import { buildComputerContext } from '@/utils/computerContext';
import { getUserId } from '@/utils/userId';

/**
 * WebSocket hook — connects frontend to backend in real-time.
 * Handles reconnection, event routing, and state synchronization.
 */

type WSMessage = {
  type: string;
  data: any;
};

// 生产环境走同域名，由 nginx 代理 /ws；开发环境 Vite proxy 代理到 :4000
const getWsUrl = () => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
};
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectDelay = useRef(RECONNECT_DELAY);
  const desktopStore = useDesktopStore;
  const connectionStore = useConnectionStore;
  const configStore = useConfigStore;
  const taskStore = useTaskStore;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to X-Computer server');
        reconnectDelay.current = RECONNECT_DELAY;
        const cs = connectionStore.getState();
        cs.setConnected(true);
        cs.setSendWs((msg) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        });
        // 连接后立即发送 auth 消息关联 userId
        ws.send(JSON.stringify({ type: 'auth', data: { userId: getUserId() } }));
        sendComputerContext();
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, scheduling reconnect...');
        connectionStore.getState().setConnected(false);
        connectionStore.getState().setSendWs(null);
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          handleMessage(msg);
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };
    } catch (err) {
      console.error('[WS] Failed to connect:', err);
      scheduleReconnect();
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = window.setTimeout(() => {
      reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay.current);
  }, [connect]);

  const handleMessage = useCallback((msg: WSMessage) => {
    const cs = connectionStore.getState();
    const cfg = configStore.getState();

    switch (msg.type) {
      case 'init':
        // Sync initial server state
        if (msg.data.mode) cfg.setExecutionMode(msg.data.mode);
        if (msg.data.tasks) taskStore.getState().syncTasks(msg.data.tasks);
        break;

      case 'task_event': {
        const event = msg.data;
        switch (event.type) {
          case 'status_change':
            taskStore.getState().upsertTask(event.taskId, event.data);
            break;
          case 'step_start':
            taskStore.getState().updateTaskStep(event.taskId, event.stepId, { status: 'running', ...event.data });
            break;
          case 'step_complete':
            taskStore.getState().updateTaskStep(event.taskId, event.stepId, { status: 'completed', ...event.data });
            break;
          case 'step_error':
            taskStore.getState().updateTaskStep(event.taskId, event.stepId, { status: 'failed', ...event.data });
            break;
          case 'approval_needed':
            taskStore.getState().upsertTask(event.taskId, { status: 'awaiting_approval' });
            taskStore.getState().addApproval(event.data);
            cs.addNotification({
              type: 'approval',
              title: '需要审批',
              message: `任务步骤 "${event.data.action}" 需要你的确认`,
              actionRequired: true,
              relatedTaskId: event.taskId,
            });
            break;
          case 'task_complete':
            taskStore.getState().upsertTask(event.taskId, {
              status: event.data.success ? 'completed' : 'failed',
              result: event.data,
            });
            cs.addNotification({
              type: event.data.success ? 'info' : 'error',
              title: event.data.success ? '任务完成' : '任务失败',
              message: event.data.success ? '任务已成功完成' : (event.data.error || '任务执行失败'),
              relatedTaskId: event.taskId,
            });
            break;
        }
        break;
      }

      case 'task_created':
        taskStore.getState().upsertTask(msg.data.id, msg.data);
        break;

      case 'mode_changed':
        cfg.setExecutionMode(msg.data.mode);
        break;

      case 'editor_stream':
        useAiDocumentStore.getState().appendContent(msg.data.windowId, msg.data.chunk ?? '');
        break;

      case 'editor_stream_end':
        useAiDocumentStore.getState().setStreaming(msg.data.windowId, false);
        break;

      case 'editor_stream_error':
        useAiDocumentStore.getState().setStreaming(msg.data.windowId, false);
        cs.addNotification({
          type: 'error',
          title: '编辑器助手',
          message: msg.data?.error ?? '生成失败',
        });
        break;

      case 'x_proactive_message':
        cs.addXProactiveMessage(msg.data);
        break;

      case 'heartbeat_notification':
        cs.addNotification({
          type: 'info',
          title: '🔔 X 主脑提醒',
          message: msg.data?.content ?? '您有一条新通知',
          actionRequired: false,
        });
        break;

      case 'app_channel':
        cs.notifyAppChannel(msg.data?.appId ?? '', msg.data?.message);
        break;

      case 'fs_result':
      case 'shell_result':
        // Handled via callback registration
        const cb = pendingCallbacks.get(msg.data._callbackId);
        if (cb) {
          cb(msg.data);
          pendingCallbacks.delete(msg.data._callbackId);
        }
        break;
    }
  }, []);

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const sendComputerContext = useCallback(() => {
    const ds = desktopStore.getState();
    const cs = connectionStore.getState();
    const cfg = configStore.getState();
    const ts = taskStore.getState();
    const ctx = buildComputerContext({
      windows: ds.windows,
      activeWindowId: ds.activeWindowId,
      executionMode: cfg.executionMode,
      tasks: ts.tasks,
      taskbarPinned: cfg.taskbarPinned,
      notifications: cs.notifications,
    });
    send({ type: 'set_computer_context', data: ctx });
  }, [send]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Push computer context to backend when desktop state changes (throttled) so AI perceives current state
  useEffect(() => {
    const CONTEXT_THROTTLE_MS = 1500;
    let throttleTimer: number | null = null;
    const unsub = desktopStore.subscribe(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      if (throttleTimer != null) return;
      throttleTimer = window.setTimeout(() => {
        throttleTimer = null;
        sendComputerContext();
      }, CONTEXT_THROTTLE_MS);
    });
    return () => {
      unsub();
      if (throttleTimer != null) clearTimeout(throttleTimer);
    };
  }, [sendComputerContext]);

  return { send, sendComputerContext, ws: wsRef };
}

// ── Callback registry for request-response patterns ────────

const pendingCallbacks = new Map<string, (data: any) => void>();
let callbackCounter = 0;

export function registerCallback(callback: (data: any) => void): string {
  const id = `cb-${++callbackCounter}-${Date.now()}`;
  pendingCallbacks.set(id, callback);
  return id;
}
