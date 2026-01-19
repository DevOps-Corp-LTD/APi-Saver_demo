import axios from 'axios';

const api = axios.create({
  baseURL: '',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// API functions
export const authApi = {
  login: (apiKey) => api.post('/api/v1/auth/login', { api_key: apiKey }),
  verify: () => api.get('/api/v1/auth/verify'),
  me: () => api.get('/api/v1/auth/me'),
  rotateKey: () => api.post('/api/v1/auth/rotate-key', { confirm: true }),
};

export const sourcesApi = {
  list: () => api.get('/api/v1/sources'),
  get: (id) => api.get(`/api/v1/sources/${id}`),
  create: (data) => api.post('/api/v1/sources', data),
  update: (id, data) => api.patch(`/api/v1/sources/${id}`, data),
  delete: (id) => api.delete(`/api/v1/sources/${id}`),
  test: (id) => api.post(`/api/v1/sources/${id}/test`),
};

export const cacheApi = {
  fetch: (data) => api.post('/api/v1/data', data),
  list: (params) => api.get('/api/v1/data/cache', { params }),
  stats: (params) => api.get('/api/v1/data/stats', { params }),
  analytics: (params) => api.get('/api/v1/data/cache/analytics', { params }),
  invalidate: (data) => api.delete('/api/v1/data/cache', { data }),
  purge: () => api.post('/api/v1/data/cache/purge', { confirm: true }),
  bulkUpdate: (entryIds, ttlSeconds) => api.patch('/api/v1/data/cache/bulk-update', {
    entry_ids: entryIds,
    ttl_seconds: ttlSeconds,
  }),
};

export const configApi = {
  list: () => api.get('/api/v1/config'),
  set: (key, value, isSecret = false) => api.post('/api/v1/config', { key, value, is_secret: isSecret }),
  setMultiple: (configs) => api.put('/api/v1/config', configs),
  delete: (key) => api.delete(`/api/v1/config/${key}`),
  getKillSwitch: () => api.get('/api/v1/config/kill-switch'),
  toggleKillSwitch: (enabled, sourceId = null) => {
    const body = { enabled };
    if (sourceId) {
      body.source_id = sourceId;
    }
    return api.post('/api/v1/config/kill-switch', body);
  },
};

export const auditApi = {
  list: (params) => api.get('/api/v1/audit', { params }),
  filters: () => api.get('/api/v1/audit/filters'),
  export: (params) => api.get('/api/v1/audit/export', { params, responseType: params?.format === 'csv' ? 'blob' : 'json' }),
  summary: (params) => api.get('/api/v1/audit/summary', { params }),
};

export const metricsApi = {
  get: () => api.get('/api/v1/metrics/json'),
};

export const oidcApi = {
  getConfig: () => api.get('/api/v1/oidc/config'),
  setConfig: (config) => api.put('/api/v1/oidc/config', config),
  deleteConfig: () => api.delete('/api/v1/oidc/config'),
  test: (issuer) => api.post('/api/v1/oidc/test', { issuer }),
  testConfig: (config) => api.post('/api/v1/oidc/test-config', config),
  getLoginUrl: (apiKey) => api.get('/api/v1/oidc/login-url', { 
    params: { api_key: apiKey },
    headers: { 'X-API-Key': apiKey }
  }),
};

export const usersApi = {
  list: (params) => api.get('/api/v1/auth/users', { params }),
  create: (data) => api.post('/api/v1/auth/users', data),
  update: (id, data) => api.patch(`/api/v1/auth/users/${id}`, data),
  delete: (id) => api.delete(`/api/v1/auth/users/${id}`),
  changePassword: (id, newPassword) => api.post(`/api/v1/auth/users/${id}/password`, { new_password: newPassword }),
};

export const rateLimitApi = {
  list: () => api.get('/api/v1/rate-limits'),
  get: (id) => api.get(`/api/v1/rate-limits/${id}`),
  create: (data) => api.post('/api/v1/rate-limits', data),
  update: (id, data) => api.patch(`/api/v1/rate-limits/${id}`, data),
  delete: (id) => api.delete(`/api/v1/rate-limits/${id}`),
  getStatus: (params) => api.get('/api/v1/rate-limits/status', { params }),
};

export const cachePolicyApi = {
  list: () => api.get('/api/v1/cache-policies'),
  get: (id) => api.get(`/api/v1/cache-policies/${id}`),
  upsert: (data) => api.put('/api/v1/cache-policies', data),
  delete: (id) => api.delete(`/api/v1/cache-policies/${id}`),
  getStats: () => api.get('/api/v1/cache-policies/stats'),
  cleanup: () => api.post('/api/v1/cache-policies/cleanup'),
};

export const storagePoolsApi = {
  list: () => api.get('/api/v1/storage-pools'),
  get: (id) => api.get(`/api/v1/storage-pools/${id}`),
  create: (data) => api.post('/api/v1/storage-pools', data),
  update: (id, data) => api.patch(`/api/v1/storage-pools/${id}`, data),
  delete: (id, params) => api.delete(`/api/v1/storage-pools/${id}`, { params }),
  getStats: (id) => api.get(`/api/v1/storage-pools/${id}/stats`),
  listCache: (id, params) => api.get(`/api/v1/storage-pools/${id}/cache`, { params }),
  purgeCache: (id, data) => api.post(`/api/v1/storage-pools/${id}/cache/purge`, data),
  getSources: (id) => api.get(`/api/v1/storage-pools/${id}/sources`),
};

export const costSavingsApi = {
  get: (timeRange = 'all') => api.get('/api/v1/cost-savings', { params: { time_range: timeRange } }),
  getBySource: (sourceId, timeRange = 'all') => api.get(`/api/v1/cost-savings/sources/${sourceId}`, { params: { time_range: timeRange } }),
  getTimeSeries: (granularity = 'day', timeRange = '30d', sourceId = null) => {
    const params = { granularity, time_range: timeRange };
    if (sourceId) params.source_id = sourceId;
    return api.get('/api/v1/cost-savings/time-series', { params });
  },
  export: (format = 'json', timeRange = 'all') => api.get('/api/v1/cost-savings/export', { 
    params: { format, time_range: timeRange },
    responseType: format === 'csv' ? 'blob' : 'json',
  }),
};

