const DEFAULT_DEV_API_BASE = 'http://localhost:5000';
const DEFAULT_PROD_API_BASE = 'https://powerpulseproo-api.onrender.com';

export function getApiBaseUrl() {
  const apiBase = import.meta.env.VITE_API_BASE_URL
    || (import.meta.env.DEV ? DEFAULT_DEV_API_BASE : DEFAULT_PROD_API_BASE);

  return apiBase.replace(/\/$/, '');
}

export function getApiUrl(path = '') {
  const normalizedPath = path
    ? (path.startsWith('/') ? path : `/${path}`)
    : '';

  return `${getApiBaseUrl()}/api${normalizedPath}`;
}