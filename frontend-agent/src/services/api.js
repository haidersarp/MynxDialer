import axios from 'axios';

const BASE = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({ baseURL: BASE });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('agent_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r.data,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('agent_token');
      localStorage.removeItem('agent_user');
      window.location.reload();
    }
    return Promise.reject(err.response?.data || err);
  }
);

export const authAPI = {
  login: (u, p) => api.post('/auth/login', { username: u, password: p }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout')
};

export const agentAPI = {
  setStatus: (id, status, pauseCode, campaignId, note) => api.post(`/agents/${id}/status`, { status, pause_code_id: pauseCode, campaign_id: campaignId, pause_note: note || null }),
  loginCampaign: (id, campaignId) => api.post(`/agents/${id}/login-campaign`, { campaign_id: campaignId }),
  audioCheck:   (id) => api.post(`/agents/${id}/audio-check`)
};

export const sipAPI = {
  getConfig: () => api.get('/sip/config')
};

export const campaignsAPI = {
  list: () => api.get('/campaigns')
};

export const leadsAPI = {
  get: id => api.get(`/leads/${id}`),
  update: (id, data) => api.put(`/leads/${id}`, data),
  // Look up leads by phone (account-scoped on the backend) — used to show the
  // lead sheet when an agent manually dials a number that's in the lead data.
  search: phone => api.get('/leads', { params: { search: phone, limit: 5 } })
};

export const callsAPI = {
  // Active (ringing/answered) calls for this account — used to recover the lead
  // for a call whose 'call:assigned' socket event was missed during a reconnect.
  active: () => api.get('/calls/active'),
  // Log an agent's manual dial as a call record so it can be dispositioned.
  manual: (data) => api.post('/calls/manual', data),
  disposition: (id, data) => api.post(`/calls/${id}/disposition`, data),
  hangup: id => api.post(`/calls/${id}/hangup`),
  hold: (id, hold) => api.post(`/calls/${id}/hold`, { hold }),
  transfer: (id, ext) => api.post(`/calls/${id}/transfer`, { extension: ext }),
  park: id => api.post(`/calls/${id}/park`)
};

export const adminAPI = {
  pauseCodes: () => api.get('/admin/pause-codes'),
  dispositions: (campaignId) => api.get('/admin/dispositions', { params: campaignId ? { campaign_id: campaignId } : {} })
};

export const callbacksAPI = {
  list:      (params) => api.get('/callbacks', { params }),
  count:     () => api.get('/callbacks/count'),
  setStatus: (id, status) => api.put(`/callbacks/${id}/status`, { status })
};

export const bookedAPI = {
  // The agent's own booked leads (sales/appointments) for a period.
  mine: (period) => api.get('/appointments/mine', { params: { period } })
};

export default api;
