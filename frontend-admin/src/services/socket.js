import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    const token = localStorage.getItem('admin_token');
    // Connect to the SAME origin the admin app is served from — the host nginx
    // proxies /socket.io to the backend. A baked-in REACT_APP_SOCKET_URL=localhost
    // (stale .env) breaks the control channel: no live notifications, no Live
    // Monitor, and no team chat (chat:send never reaches the server). Same-origin
    // is always correct for this deployment (IP container or your-domain.com).
    const url = window.location.origin;
    socket = io(url, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000
    });

    socket.on('connect', () => console.log('[Socket] Connected:', socket.id));
    socket.on('disconnect', () => console.log('[Socket] Disconnected'));
    socket.on('connect_error', err => console.error('[Socket] Error:', err.message));
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function useSocketEvent(eventName, handler) {
  const s = getSocket();
  s.on(eventName, handler);
  return () => s.off(eventName, handler);
}