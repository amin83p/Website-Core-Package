function clean(value = '') {
  return String(value || '').trim();
}

function enabledFromEnv(value = '') {
  return /^(1|true|yes|on)$/i.test(clean(value));
}

function normalizeDomain(value = '') {
  return clean(value).replace(/^@+/, '').toLowerCase();
}

function normalizeAuthorityTenant(value = '') {
  const token = clean(value);
  return token || 'organizations';
}

function isMultiTenantAuthority(value = '') {
  const token = clean(value).toLowerCase();
  return token === 'common' || token === 'organizations' || token === 'consumers';
}

function normalizeRedirectUri(value = '') {
  const token = clean(value);
  if (!token) return '';
  try {
    const parsed = new URL(token);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    parsed.hash = '';
    parsed.search = '';
    let pathname = parsed.pathname || '';
    if (pathname.length > 1) {
      pathname = pathname.replace(/\/+$/g, '');
    }
    parsed.pathname = pathname || '/';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

const MICROSOFT_CALLBACK_SUFFIX = '/auth/microsoft/callback';

const PUBLIC_SITE_ENV_KEYS = [
  'MICROSOFT_REDIRECT_URIS',
  'MICROSOFT_REDIRECT_URI',
  'PUBLIC_APP_URL',
  'WEBSITE_BASE_URL',
  'APP_URL',
  'BASE_URL'
];

function parsePublicSiteOrigin(entry = '') {
  const token = clean(entry);
  if (!token) return '';
  try {
    const parsed = new URL(token.includes('://') ? token : `https://${token}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return '';
  }
}

function collectImplicitRedirectUrisFromPublicSiteEnv(env = process.env) {
  const implicit = [];
  PUBLIC_SITE_ENV_KEYS.slice(2).forEach((key) => {
    const raw = clean(env[key]);
    if (!raw) return;
    raw.split(/[\n,]+/).forEach((entry) => {
      const origin = parsePublicSiteOrigin(entry);
      if (!origin) return;
      implicit.push(`${origin}${MICROSOFT_CALLBACK_SUFFIX}`);
    });
  });
  return implicit;
}

function parseRedirectUrisFromEnv(env = process.env) {
  const pluralRaw = clean(env.MICROSOFT_REDIRECT_URIS);
  const sources = pluralRaw
    ? pluralRaw.split(/[\n,]+/)
    : [clean(env.MICROSOFT_REDIRECT_URI)];
  sources.push(...collectImplicitRedirectUrisFromPublicSiteEnv(env));
  const seen = new Set();
  const redirectUris = [];
  sources.forEach((entry) => {
    const normalized = normalizeRedirectUri(entry);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    redirectUris.push(normalized);
  });
  return redirectUris;
}

function getMicrosoftAuthConfig(env = process.env) {
  const source = env && typeof env === 'object' ? env : process.env;
  const tenantId = clean(source.MICROSOFT_TENANT_ID);
  const authorityTenant = normalizeAuthorityTenant(source.MICROSOFT_AUTHORITY_TENANT || tenantId || 'organizations');
  const clientId = clean(source.MICROSOFT_CLIENT_ID);
  const clientSecret = clean(source.MICROSOFT_CLIENT_SECRET);
  const redirectUris = parseRedirectUrisFromEnv(source);
  const redirectUri = redirectUris[0] || '';
  const allowedDomain = normalizeDomain(source.MICROSOFT_ALLOWED_DOMAIN || 'equilibrium.ab.ca');
  const enabled = enabledFromEnv(source.MICROSOFT_AUTH_ENABLED);
  const enforceTenant = enabledFromEnv(source.MICROSOFT_ENFORCE_TENANT) && Boolean(tenantId);

  return {
    enabled,
    tenantId,
    authorityTenant,
    enforceTenant,
    multiTenantAuthority: isMultiTenantAuthority(authorityTenant),
    clientId,
    clientSecret,
    redirectUri,
    redirectUris,
    allowedDomain,
    authority: `https://login.microsoftonline.com/${authorityTenant}`,
    scopes: ['openid', 'profile', 'email']
  };
}

function validateMicrosoftAuthConfig(config = getMicrosoftAuthConfig()) {
  if (!config.enabled) return { ok: false, reason: 'disabled' };

  const missing = [];
  if (!config.clientId) missing.push('MICROSOFT_CLIENT_ID');
  if (!config.clientSecret) missing.push('MICROSOFT_CLIENT_SECRET');
  if (!Array.isArray(config.redirectUris) || config.redirectUris.length === 0) {
    missing.push('MICROSOFT_REDIRECT_URIS or MICROSOFT_REDIRECT_URI');
  }
  if (!config.allowedDomain) missing.push('MICROSOFT_ALLOWED_DOMAIN');

  if (missing.length > 0) {
    return { ok: false, reason: 'missing_config', missing };
  }

  return { ok: true };
}

module.exports = {
  getMicrosoftAuthConfig,
  validateMicrosoftAuthConfig,
  parseRedirectUrisFromEnv,
  normalizeRedirectUri,
  collectImplicitRedirectUrisFromPublicSiteEnv,
  MICROSOFT_CALLBACK_SUFFIX
};
