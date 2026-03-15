import { useEffect, useRef, useCallback } from 'react';
import { useDesktopStore } from '@/store/desktopStore';
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
  const store = useDesktopStore;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to X-Computer server');
        reconnectDelay.current = RECONNECT_DELAY;
        const s = store.getState();
        s.setConnected(true);
        s.setSendWs((msg) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        });
        // 连接后立即发送 auth 消息关联 userId
        ws.send(JSON.stringify({ type: 'auth', data: { userId: getUserId() } }));
        sendComputerContext();
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, scheduling reconnect...');
        store.getState().setConnected(false);
        store.getState().setSendWs(null);
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
    const s = store.getState();

    switch (msg.type) {
      case 'init':
        // Sync initial server state
        if (msg.data.mode) s.setExecutionMode(msg.data.mode);
        if (msg.data.tasks) s.syncTasks(msg.data.tasks);
        break;

      case 'task_event': {
        const event = msg.data;
        switch (event.type) {
          case 'status_change':
            s.upsertTask(event.taskId, event.data);
            break;
          case 'step_start':
            s.updateTaskStep(event.taskId, event.stepId, { status: 'running', ...event.data });
            break;
          case 'step_complete':
            s.updateTaskStep(event.taskId, event.stepId, { status: 'completed', ...event.data });
            break;
          case 'step_error':
            s.updateTaskStep(event.taskId, event.stepId, { status: 'failed', ...event.data });
            break;
          case 'approval_needed':
            s.upsertTask(event.taskId, { status: 'awaiting_approval' });
            s.addApproval(event.data);
            s.addNotification({
              type: 'approval',
              title: '需要审批',
              message: `任务步骤 "${event.data.action}" 需要你的确认`,
              actionRequired: true,
              relatedTaskId: event.taskId,
            });
            break;
          case 'task_complete':
            s.upsertTask(event.taskId, {
              status: event.data.success ? 'completed' : 'failed',
              result: event.data,
            });
            s.addNotification({
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
        s.upsertTask(msg.data.id, msg.data);
        break;

      case 'mode_changed':
        s.setExecutionMode(msg.data.mode);
        break;

      case 'editor_stream':
        useAiDocumentStore.getState().appendContent(msg.data.windowId, msg.data.chunk ?? '');
        break;

      case 'editor_stream_end':
        useAiDocumentStore.getState().setStreaming(msg.data.windowId, false);
        break;

      case 'editor_stream_error':
        useAiDocumentStore.getState().setStreaming(msg.data.windowId, false);
        s.addNotification({
          type: 'error',
          title: '编辑器助手',
          message: msg.data?.error ?? '生成失败',
        });
        break;

      case 'x_proactive_message':
        s.addXProactiveMessage(msg.data);
        break;

      case 'app_channel':
        s.notifyAppChannel(msg.data?.appId ?? '', msg.data?.message);
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
    const s = store.getState();
    const ctx = buildComputerContext({
      windows: s.windows,
      activeWindowId: s.activeWindowId,
      executionMode: s.executionMode,
      tasks: s.tasks,
      taskbarPinned: s.taskbarPinned,
      notifications: s.notifications,
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
    const unsub = store.subscribe(() => {
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
