import axios from 'axios';

const BASE = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({ baseURL: BASE });

// Separate storage keys from the agent/admin apps so a trainee session can
// never be confused with (or inherit) an agent session on a shared machine.
export const TOKEN_KEY = 'trainee_token';
export const USER_KEY  = 'trainee_user';

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r.data,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export const login       = (username, password) => api.post('/auth/login', { username, password });
export const getSipConfig = ()                  => api.get('/sip/config');

export const getAgents    = ()        => api.get('/trainee/agents');
export const getContext   = (agentId) => api.get(`/trainee/agents/${agentId}/context`);
export const startListen  = (agentId) => api.post('/trainee/listen', { agent_id: agentId });
export const stopListen   = (agentId) => api.post('/trainee/listen/stop', { agent_id: agentId });

export const getNotes   = ()          => api.get('/trainee/notes');
export const addNote    = (payload)   => api.post('/trainee/notes', payload);
export const editNote   = (id, note)  => api.put(`/trainee/notes/${id}`, { note });
export const deleteNote = (id)        => api.delete(`/trainee/notes/${id}`);

export default api;
