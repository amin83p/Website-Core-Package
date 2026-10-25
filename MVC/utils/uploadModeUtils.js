function clean(value) {
  return String(value || '').trim();
}

function getUploadMode() {
  const token = clean(process.env.UPLOAD_MODE).toLowerCase();
  if (token === 'railway_proxy') return 'railway_proxy';
  return 'local';
}

function isRailwayProxyMode() {
  return getUploadMode() === 'railway_proxy';
}

function getGatewayBaseUrl() {
  return clean(process.env.RAILWAY_GATEWAY_BASE_URL).replace(/\/+$/, '');
}

function isBrowserUnsafeGatewayBaseUrl(baseUrl = '') {
  const { isPrivateOrLocalHost } = require('./networkHostUtils');
  const token = clean(baseUrl);
  if (!token) return true;
  try {
    const parsed = new URL(token);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    return isPrivateOrLocalHost(parsed.hostname);
  } catch (_) {
    return true;
  }
}

function getGatewayTimeoutMs() {
  const raw = Number.parseInt(String(process.env.FILE_GATEWAY_TIMEOUT_MS || '').trim(), 10);
  if (!Number.isFinite(raw) || raw <= 0) return 25000;
  return raw;
}

module.exports = {
  getUploadMode,
  isRailwayProxyMode,
  getGatewayBaseUrl,
  getGatewayTimeoutMs,
  isBrowserUnsafeGatewayBaseUrl
};
