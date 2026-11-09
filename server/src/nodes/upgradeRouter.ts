import type http from 'node:http';
import type { Duplex } from 'node:stream';

export type UpgradeHandler = (request: http.IncomingMessage, socket: Duplex, head: Buffer) => void;

/**
 * One `upgrade` listener per HTTP server that hands each WebSocket handshake to the handler registered
 * for its path. With `ws` attached directly to the server, a second WebSocketServer on another path
 * would be rejected with 400 by the first; routing here avoids that.
 */
export function createUpgradeRouter(server: http.Server): { register(path: string, handler: UpgradeHandler): void } {
  const handlers = new Map<string, UpgradeHandler>();
  server.on('upgrade', (request, socket, head) => {
    const pathname = (() => { try { return new URL(request.url ?? '/', 'http://localhost').pathname; } catch { return ''; } })();
    const handler = handlers.get(pathname);
    if (!handler) { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    handler(request, socket, head);
  });
  return { register(path, handler) { handlers.set(path, handler); } };
}
