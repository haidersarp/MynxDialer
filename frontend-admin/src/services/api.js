import axios from 'axios';

const BASE = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({ baseURL: BASE });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('admin_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r.data,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.href = '/login';
    }
    return Promise.reject(err.response?.data || err);
  }
);

export const authAPI = {
  login: (u, p) => api.post('/auth/login', { username: u, password: p }),
  me: () => api.get('/auth/me'),
  changePassword: (cur, nw) => api.post('/auth/change-password', { current_password: cur, new_password: nw }),
  logout: () => api.post('/auth/logout')
};

export const agentsAPI = {
  list: () => api.get('/agents'),
  live: () => api.get('/agents/live'),
  get: id => api.get(`/agents/${id}`),
  create: data => api.post('/agents', data),
  update: (id, data) => api.put(`/agents/${id}`, data),
  delete: id => api.delete(`/agents/${id}`),
  hardDelete: id => api.delete(`/agents/${id}/permanent`),
  setStatus:     (id, status, pauseCode) => api.post(`/agents/${id}/status`, { status, pause_code_id: pauseCode }),
  forceLogout:   (id) => api.post(`/agents/${id}/force-logout`),
  loginCampaign: (id, campaignId) => api.post(`/agents/${id}/login-campaign`, { campaign_id: campaignId }),
  getCampaigns:  (id) => api.get(`/agents/${id}/campaigns`),
  setCampaigns:  (id, campaign_ids) => api.put(`/agents/${id}/campaigns`, { campaign_ids })
};

export const campaignsAPI = {
  list: () => api.get('/campaigns'),
  get: id => api.get(`/campaigns/${id}`),
  create: data => api.post('/campaigns', data),
  update: (id, data) => api.put(`/campaigns/${id}`, data),
  delete: id => api.delete(`/campaigns/${id}`),
  setStatus: (id, status) => api.post(`/campaigns/${id}/status`, { status }),
  dispositions: id => api.get(`/campaigns/${id}/dispositions`),
  hopperStats: id => api.get(`/campaigns/${id}/hopper`),
  hopperRefill: id => api.post(`/campaigns/${id}/hopper/refill`),
  hopperFlush: id => api.delete(`/campaigns/${id}/hopper`)
};

export const leadListsAPI = {
  list:           (params) => api.get('/lead-lists', { params }),
  get:            (id) => api.get(`/lead-lists/${id}`),
  update:         (id, data) => api.put(`/lead-lists/${id}`, data),
  delete:         (id) => api.delete(`/lead-lists/${id}`),
  download:       (id) => `${api.defaults.baseURL || '/api'}/lead-lists/${id}/download`,
  recycle:        (id, dispositions, delay_seconds = 0) => api.post(`/lead-lists/${id}/recycle`, { dispositions, delay_seconds }),
  campaignStats:  (campaign_id) => api.get('/lead-lists/campaign-stats', { params: { campaign_id } }),
  recycleCampaign:(campaign_id, dispositions, delay_seconds = 0) => api.post('/lead-lists/recycle-campaign', { campaign_id, dispositions, delay_seconds }),
  unlistedCount:  (campaign_id) => api.get('/lead-lists/unlisted/count', { params: { campaign_id } }),
  assignUnlisted: (campaign_id) => api.post('/lead-lists/unlisted/assign', { campaign_id }),
};

export const leadsAPI = {
  list: params => api.get('/leads', { params }),
  get: id => api.get(`/leads/${id}`),
  create: data => api.post('/leads', data),
  update: (id, data) => api.put(`/leads/${id}`, data),
  delete: id => api.delete(`/leads/${id}`),
  parseHeaders: (file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/leads/parse-headers', form);
  },
  import: (file, campaignId, opts = {}) => {
    const form = new FormData();
    if (file) form.append('file', file);
    form.append('campaign_id', campaignId);
    if (opts.temp_path)      form.append('temp_path',      opts.temp_path);
    if (opts.column_mapping) form.append('column_mapping', JSON.stringify(opts.column_mapping));
    if (opts.list_name)      form.append('list_name',      opts.list_name);
    if (opts.dial_order)     form.append('dial_order',     opts.dial_order);
    if (opts.dial_mode)      form.append('dial_mode',      opts.dial_mode);
    form.append('allow_duplicates', opts.allow_duplicates ? 'true' : 'false');
    return api.post('/leads/import', form);
  }
};

export const callsAPI = {
  list: params => api.get('/calls', { params }),
  active: () => api.get('/calls/active'),
  disposition: (id, data) => api.post(`/calls/${id}/disposition`, data),
  hangup: id => api.post(`/calls/${id}/hangup`),
  transfer: (id, ext) => api.post(`/calls/${id}/transfer`, { extension: ext }),
  monitor: (agentId, mode) => api.post('/calls/monitor', { agent_id: agentId, mode }),
  stopMonitor: (agentId) => api.post('/calls/monitor/stop', { agent_id: agentId })
};

export const cidAPI = {
  list: () => api.get('/cid'),
  get: id => api.get(`/cid/${id}`),
  create: data => api.post('/cid', data),
  update: (id, data) => api.put(`/cid/${id}`, data),
  delete: id => api.delete(`/cid/${id}`),
  addNumber: (id, data) => api.post(`/cid/${id}/numbers`, data),
  deleteNumber: (gid, nid) => api.delete(`/cid/${gid}/numbers/${nid}`)
};

export const reportsAPI = {
  summary: params => api.get('/reports/summary', { params }),
  agent: params => api.get('/reports/agent', { params }),
  campaign: params => api.get('/reports/campaign', { params }),
  calls: params => api.get('/reports/calls', { params })
};

export const adminAPI = {
  dispositions: params => api.get('/admin/dispositions', { params }),
  createDisposition: data => api.post('/admin/dispositions', data),
  updateDisposition: (id, data) => api.put(`/admin/dispositions/${id}`, data),
  deleteDisposition: id => api.delete(`/admin/dispositions/${id}`),
  pauseCodes: () => api.get('/admin/pause-codes'),
  createPauseCode: data => api.post('/admin/pause-codes', data),
  updatePauseCode: (id, data) => api.put(`/admin/pause-codes/${id}`, data),
  deletePauseCode: id => api.delete(`/admin/pause-codes/${id}`),
  dnc: params => api.get('/admin/dnc', { params }),
  addDNC: data => api.post('/admin/dnc', data),
  bulkDNC: phones => api.post('/admin/dnc/bulk', { phones }),
  deleteDNC: id => api.delete(`/admin/dnc/${id}`),
  sipTrunks: () => api.get('/admin/sip-trunks'),
  createTrunk: data => api.post('/admin/sip-trunks', data),
  updateTrunk: (id, data) => api.put(`/admin/sip-trunks/${id}`, data),
  deleteTrunk: id => api.delete(`/admin/sip-trunks/${id}`),
  testTrunk: id => api.post(`/admin/sip-trunks/${id}/test`),
  settings:       () => api.get('/admin/settings'),
  updateSettings: data => api.put('/admin/settings', data),
  sipProvider:    () => api.get('/admin/sip-provider'),
  applySipProvider: data => api.post('/admin/sip-provider/apply', data),
  sipConfig:      () => api.get('/sip/config')   // admin's own WebRTC creds (Live Monitor)
};

export default api;
