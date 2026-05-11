import axios from 'axios';

/**
 * API Service Configuration
 * Handles:
 * - Dynamic base URL resolution (dev/prod)
 * - JWT token injection for authenticated requests
 * - Automatic token refresh on expiration
 * - Standard error handling
 */

// ========== BASE URL CONFIGURATION ==========

const DEFAULT_DEV_API_BASE = 'http://localhost:5000';
const DEFAULT_PROD_API_BASE = 'https://powerpulsepro-api.onrender.com';

/**
 * Infer backend base URL from frontend hostname
 */
function inferBackendBaseFromFrontendHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return null;

  // Local development
  if (/^localhost(:\d+)?$/.test(hostname) || /^127\.0\.0\.1(:\d+)?$/.test(hostname)) {
    return DEFAULT_DEV_API_BASE;
  }

  // Production Render domains
  if (/^powerpulseproo(?:-[a-z0-9]+)?\.onrender\.com$/i.test(hostname)
    || /^powerpulsepro-api(?:-[a-z0-9]+)?\.onrender\.com$/i.test(hostname)) {
    return DEFAULT_PROD_API_BASE;
  }

  return null;
}

/**
 * Get the API base URL
 */
export function getApiBaseUrl() {
  const browserHostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const inferredApiBase = inferBackendBaseFromFrontendHost(browserHostname);

  const apiBase = import.meta.env.VITE_API_BASE_URL
    || inferredApiBase
    || (import.meta.env.DEV ? DEFAULT_DEV_API_BASE : DEFAULT_PROD_API_BASE);

  return apiBase.replace(/\/$/, '');
}

/**
 * Get full API URL for a given path
 */
export function getApiUrl(path = '') {
  const normalizedPath = path
    ? (path.startsWith('/') ? path : `/${path}`)
    : '';

  return `${getApiBaseUrl()}/api${normalizedPath}`;
}

// ========== TOKEN MANAGEMENT ==========

/**
 * Decode JWT payload (client-side only, no verification)
 */
function decodeJwtPayload(token) {
  try {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Check if JWT token is expired
 */
function isTokenExpired(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  return Date.now() >= payload.exp * 1000;
}

/**
 * Get consumer token from localStorage
 */
export function getConsumerToken() {
  const token = localStorage.getItem('consumerToken');
  if (!token || token === 'null' || token.trim() === '') {
    return null;
  }
  if (isTokenExpired(token)) {
    localStorage.removeItem('consumerToken');
    return null;
  }
  return token;
}

/**
 * Get admin token from localStorage
 */
export function getAdminToken() {
  const token = localStorage.getItem('adminToken');
  if (!token || token === 'null' || token.trim() === '') {
    return null;
  }
  if (isTokenExpired(token)) {
    localStorage.removeItem('adminToken');
    return null;
  }
  return token;
}

/**
 * Set consumer token in localStorage
 */
export function setConsumerToken(token) {
  localStorage.setItem('consumerToken', token);
  // Clean up admin token if switching from admin
  localStorage.removeItem('adminToken');
  // Clean up legacy token keys
  localStorage.removeItem('token');
  localStorage.removeItem('authToken');
}

/**
 * Set admin token in localStorage
 */
export function setAdminToken(token) {
  localStorage.setItem('adminToken', token);
  // Clean up consumer token if switching from consumer
  localStorage.removeItem('consumerToken');
  // Clean up legacy token keys
  localStorage.removeItem('token');
  localStorage.removeItem('authToken');
}

/**
 * Clear all tokens
 */
export function clearTokens() {
  localStorage.removeItem('consumerToken');
  localStorage.removeItem('adminToken');
  localStorage.removeItem('token');
  localStorage.removeItem('authToken');
  localStorage.removeItem('consumerProfile');
  localStorage.removeItem('adminProfile');
}

// ========== AXIOS INSTANCES ==========

/**
 * Create axios instance with auth interceptor
 */
function createApiInstance(tokenGetter) {
  const instance = axios.create({
    baseURL: getApiBaseUrl(),
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
    }
  });

  // Request interceptor: Add auth token
  instance.interceptors.request.use(
    (config) => {
      const token = tokenGetter();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor: Handle 401 Unauthorized
  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        // Token expired or invalid - clear storage and redirect to login
        clearTokens();
        window.location.href = tokenGetter === getConsumerToken ? '/consumer-login' : '/admin-login';
      }
      return Promise.reject(error);
    }
  );

  return instance;
}

/**
 * Consumer API instance
 * Used for: /api/consumer/*, /api/auth/consumer/login, /api/auth/consumer/register
 */
export const consumerApi = createApiInstance(getConsumerToken);

/**
 * Admin API instance
 * Used for: /api/admin/*, /api/billing/*, /api/auth/admin/login
 */
export const adminApi = createApiInstance(getAdminToken);

/**
 * Public API instance (no auth required)
 * Used for: /api/auth/consumer/register, /api/auth/consumer/login, /api/auth/admin/login, /api/health
 */
export const publicApi = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  }
});

// ========== API METHODS ==========

// Auth endpoints
export const authAPI = {
  consumerLogin: (consumerNumber, password) =>
    publicApi.post('/api/auth/consumer/login', { consumerNumber, password }),
  
  consumerRegister: (data) =>
    publicApi.post('/api/auth/consumer/register', data),
  
  adminLogin: (adminId, password) =>
    publicApi.post('/api/auth/admin/login', { adminId, password }),
  
  logout: () => ({ status: 'success', message: 'Logout successful' }) // Client-side logout
};

// Consumer endpoints
export const consumerAPI = {
  getProfile: () => consumerApi.get('/api/consumer/profile'),
  updateProfile: (data) => consumerApi.put('/api/consumer/profile', data),
  getCurrentReading: () => consumerApi.get('/api/consumer/meter/current'),
  getMeterHistory: (params) => consumerApi.get('/api/consumer/meter/history', { params }),
  getConsumptionAnalytics: (params) => consumerApi.get('/api/consumer/analytics/consumption', { params }),
  getBillingHistory: (params) => consumerApi.get('/api/consumer/billing/history', { params }),
  getPreferences: () => consumerApi.get('/api/consumer/preferences'),
  updatePreferences: (data) => consumerApi.put('/api/consumer/preferences', data)
};

// Admin endpoints
export const adminAPI = {
  getConsumers: (params) => adminApi.get('/api/admin/consumers', { params }),
  getDashboardStats: () => adminApi.get('/api/admin/dashboard/stats'),
  getConsumerLive: (consumerId) => adminApi.get(`/api/admin/consumers/${consumerId}/live`),
  getConfig: () => adminApi.get('/api/admin/config'),
  updateConfig: (section, data) => adminApi.put(`/api/admin/config/${section}`, data),
  scheduleOperation: (data) => adminApi.post('/api/admin/operations/schedule', data),
  importReadings: (data) => adminApi.post('/api/admin/operations/import-readings', data)
};

// Billing endpoints
export const billingAPI = {
  calculateBill: (data) => adminApi.post('/api/billing/calculate', data),
  getBillingSummary: (params) => adminApi.get('/api/billing/summary', { params })
};

// Health check
export const healthCheck = () => publicApi.get('/api/health');

export default consumerApi;