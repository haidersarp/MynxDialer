import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    const token = localStorage.getItem('agent_token');
    // Connect to the SAME origin the agent app is served from — the agent nginx
    // proxies /socket.io to the backend. A baked-in REACT_APP_SOCKET_URL=localhost
    // (stale .env) breaks the control channel: no presence, no calls, no live
    // dialing, no hangup/dispo. Same-origin is always correct for this deployment.
    const url = window.location.origin;
    socket = io(url, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 20,
      reconnectionDelay: 2000
    });
    socket.on('connect', () => console.log('[Socket] Agent connected'));
    socket.on('disconnect', () => console.log('[Socket] Agent disconnected'));
    socket.on('connect_error', e => console.error('[Socket] Error:', e.message));
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}

export default getSocket;
