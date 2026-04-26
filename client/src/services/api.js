const DEFAULT_DEV_API_BASE = 'http://localhost:5000';
const DEFAULT_PROD_API_BASE = 'https://powerpulseproo.onrender.com';

function inferBackendBaseFromFrontendHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return null;

  if (/^localhost(:\d+)?$/.test(hostname) || /^127\.0\.0\.1(:\d+)?$/.test(hostname)) {
    return DEFAULT_DEV_API_BASE;
  }

  if (/^powerpulseproo(?:-[a-z0-9]+)?\.onrender\.com$/i.test(hostname)
    || /^powerpulsepro-api(?:-[a-z0-9]+)?\.onrender\.com$/i.test(hostname)) {
    return DEFAULT_PROD_API_BASE;
  }

  return null;
}

export function getApiBaseUrl() {
  const browserHostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const inferredApiBase = inferBackendBaseFromFrontendHost(browserHostname);

  const apiBase = import.meta.env.VITE_API_BASE_URL
    || inferredApiBase
    || (import.meta.env.DEV ? DEFAULT_DEV_API_BASE : DEFAULT_PROD_API_BASE);

  return apiBase.replace(/\/$/, '');
}

export function getApiUrl(path = '') {
  const normalizedPath = path
    ? (path.startsWith('/') ? path : `/${path}`)
    : '';

  return `${getApiBaseUrl()}/api${normalizedPath}`;
}