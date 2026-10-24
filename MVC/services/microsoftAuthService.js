const crypto = require('crypto');
const msal = require('@azure/msal-node');
const {
  getMicrosoftAuthConfig,
  validateMicrosoftAuthConfig,
  normalizeRedirectUri
} = require('../../config/microsoftAuth');
const { resolveRequestOrigin } = require('./appPublicUrlService');

const MICROSOFT_CALLBACK_PATH = '/auth/microsoft/callback';

const STATE_TTL_MS = 10 * 60 * 1000;

let cachedClient = null;
let cachedClientKey = '';

class MicrosoftAuthError extends Error {
  constructor(message, { statusCode = 400, code = 'MICROSOFT_AUTH_ERROR' } = {}) {
    super(message);
    this.name = 'MicrosoftAuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  return base64Url(crypto.randomBytes(bytes));
}

function sha256Base64Url(value) {
  return base64Url(crypto.createHash('sha256').update(value).digest());
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function requireSession(req) {
  if (!req.session) {
    throw new MicrosoftAuthError('Login session is not available. Please try again.', {
      statusCode: 500,
      code: 'SESSION_UNAVAILABLE'
    });
  }
}

function requireConfig() {
  const config = getMicrosoftAuthConfig();
  const validation = validateMicrosoftAuthConfig(config);
  if (!validation.ok) {
    const message = validation.reason === 'disabled'
      ? 'Microsoft login is not enabled.'
      : `Microsoft login is not configured. Missing: ${(validation.missing || []).join(', ')}`;
    throw new MicrosoftAuthError(message, {
      statusCode: validation.reason === 'disabled' ? 404 : 500,
      code: validation.reason === 'disabled' ? 'MICROSOFT_AUTH_DISABLED' : 'MICROSOFT_AUTH_NOT_CONFIGURED'
    });
  }
  return config;
}

function getClient(config = requireConfig()) {
  const key = [
    config.authorityTenant,
    config.clientId,
    config.clientSecret ? 'secret-set' : 'secret-empty',
    config.authority
  ].join('|');

  if (cachedClient && cachedClientKey === key) return cachedClient;

  cachedClient = new msal.ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      authority: config.authority,
      clientSecret: config.clientSecret
    }
  });
  cachedClientKey = key;
  return cachedClient;
}

function pickEmailFromClaims(claims = {}, account = {}) {
  return normalizeEmail(
    claims.preferred_username ||
    claims.email ||
    claims.upn ||
    account.username ||
    ''
  );
}

function isAllowedDomain(email = '', allowedDomain = '') {
  const normalizedEmail = normalizeEmail(email);
  const domain = String(allowedDomain || '').trim().replace(/^@+/, '').toLowerCase();
  return Boolean(normalizedEmail && domain && normalizedEmail.endsWith(`@${domain}`));
}

async function saveSession(req) {
  if (!req.session || typeof req.session.save !== 'function') return;
  await new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function buildCallbackUriFromRequest(req) {
  const origin = resolveRequestOrigin(req);
  if (!origin) return '';
  return normalizeRedirectUri(`${origin}${MICROSOFT_CALLBACK_PATH}`);
}

function pickAllowlistedRedirectUri(candidate = '', allowlist = []) {
  const normalizedCandidate = normalizeRedirectUri(candidate);
  if (!normalizedCandidate) return '';
  const list = Array.isArray(allowlist) ? allowlist : [];
  if (list.includes(normalizedCandidate)) return normalizedCandidate;
  try {
    const candidateUrl = new URL(normalizedCandidate);
    const match = list.find((entry) => {
      try {
        const allowed = new URL(entry);
        return allowed.origin === candidateUrl.origin
          && allowed.pathname === candidateUrl.pathname;
      } catch (_) {
        return false;
      }
    });
    return match || '';
  } catch (_) {
    return '';
  }
}

function resolveRedirectUriForRequest(req, config = requireConfig()) {
  const allowlist = Array.isArray(config.redirectUris) ? config.redirectUris : [];
  if (!allowlist.length) {
    throw new MicrosoftAuthError('Microsoft login is not configured. Missing: MICROSOFT_REDIRECT_URIS or MICROSOFT_REDIRECT_URI', {
      statusCode: 500,
      code: 'MICROSOFT_AUTH_NOT_CONFIGURED'
    });
  }
  const fromRequest = buildCallbackUriFromRequest(req);
  const redirectUri = pickAllowlistedRedirectUri(fromRequest, allowlist);
  if (!redirectUri) {
    const host = cleanHostFromRequest(req);
    throw new MicrosoftAuthError(
      host
        ? `Microsoft login is not configured for ${host}. Add its callback URL to MICROSOFT_REDIRECT_URIS.`
        : 'Microsoft login could not determine the callback URL for this request.',
      { statusCode: 400, code: 'REDIRECT_URI_NOT_ALLOWED' }
    );
  }
  return redirectUri;
}

function cleanHostFromRequest(req) {
  return String(req?.get?.('x-forwarded-host') || req?.get?.('host') || '').trim();
}

function assertCallbackMatchesStoredRedirect(req, storedRedirectUri = '') {
  const stored = normalizeRedirectUri(storedRedirectUri);
  if (!stored) {
    throw new MicrosoftAuthError('Microsoft login validation failed. Please try again.', {
      statusCode: 400,
      code: 'REDIRECT_URI_MISSING'
    });
  }
  const fromRequest = buildCallbackUriFromRequest(req);
  const requestMatch = pickAllowlistedRedirectUri(fromRequest, [stored]);
  if (!requestMatch) {
    throw new MicrosoftAuthError('Microsoft login returned on an unexpected domain. Start sign-in again from the same site.', {
      statusCode: 400,
      code: 'REDIRECT_URI_MISMATCH'
    });
  }
}

async function createAuthorizationUrl(req) {
  requireSession(req);
  const config = requireConfig();
  const client = getClient(config);
  const redirectUri = resolveRedirectUriForRequest(req, config);

  const codeVerifier = randomToken(64);
  const state = randomToken(32);
  const nonce = randomToken(32);

  req.session.microsoftAuth = {
    state,
    nonce,
    codeVerifier,
    redirectUri,
    createdAt: Date.now()
  };
  await saveSession(req);

  return client.getAuthCodeUrl({
    scopes: config.scopes,
    redirectUri,
    state,
    nonce,
    prompt: 'select_account',
    codeChallenge: sha256Base64Url(codeVerifier),
    codeChallengeMethod: 'S256'
  });
}

async function handleCallback(req) {
  requireSession(req);
  const config = requireConfig();

  if (req.query?.error) {
    throw new MicrosoftAuthError(
      String(req.query.error_description || req.query.error || 'Microsoft login was cancelled.'),
      { statusCode: 400, code: 'MICROSOFT_AUTH_CANCELLED' }
    );
  }

  const code = String(req.query?.code || '').trim();
  const returnedState = String(req.query?.state || '').trim();
  const stored = req.session.microsoftAuth || {};

  delete req.session.microsoftAuth;

  if (!code) {
    throw new MicrosoftAuthError('Microsoft did not return an authorization code.', {
      statusCode: 400,
      code: 'MISSING_CODE'
    });
  }

  if (!stored.state || !returnedState || stored.state !== returnedState) {
    throw new MicrosoftAuthError('Microsoft login validation failed. Please try again.', {
      statusCode: 400,
      code: 'STATE_MISMATCH'
    });
  }

  if (!stored.createdAt || Date.now() - Number(stored.createdAt) > STATE_TTL_MS) {
    throw new MicrosoftAuthError('Microsoft login request expired. Please try again.', {
      statusCode: 400,
      code: 'STATE_EXPIRED'
    });
  }

  const redirectUri = normalizeRedirectUri(stored.redirectUri) || normalizeRedirectUri(config.redirectUri);
  if (!redirectUri) {
    throw new MicrosoftAuthError('Microsoft login validation failed. Please try again.', {
      statusCode: 400,
      code: 'REDIRECT_URI_MISSING'
    });
  }
  assertCallbackMatchesStoredRedirect(req, redirectUri);

  const client = getClient(config);
  const result = await client.acquireTokenByCode({
    code,
    scopes: config.scopes,
    redirectUri,
    codeVerifier: stored.codeVerifier
  });

  const claims = result?.idTokenClaims || {};
  const account = result?.account || {};

  if (stored.nonce && claims.nonce && claims.nonce !== stored.nonce) {
    throw new MicrosoftAuthError('Microsoft login nonce validation failed. Please try again.', {
      statusCode: 400,
      code: 'NONCE_MISMATCH'
    });
  }

  if (config.enforceTenant && config.tenantId && claims.tid && String(claims.tid).toLowerCase() !== String(config.tenantId).toLowerCase()) {
    throw new MicrosoftAuthError('This Microsoft account belongs to a different tenant.', {
      statusCode: 403,
      code: 'TENANT_NOT_ALLOWED'
    });
  }

  const email = pickEmailFromClaims(claims, account);
  if (!email) {
    throw new MicrosoftAuthError('Microsoft did not return an email for this account.', {
      statusCode: 403,
      code: 'EMAIL_MISSING'
    });
  }

  if (!isAllowedDomain(email, config.allowedDomain)) {
    throw new MicrosoftAuthError(`Only @${config.allowedDomain} Microsoft accounts can sign in.`, {
      statusCode: 403,
      code: 'DOMAIN_NOT_ALLOWED'
    });
  }

  await saveSession(req);

  return {
    email,
    tenantId: claims.tid || '',
    objectId: claims.oid || '',
    name: claims.name || '',
    username: account.username || email,
    claims
  };
}

function isEnabled() {
  const config = getMicrosoftAuthConfig();
  return Boolean(config.enabled && validateMicrosoftAuthConfig(config).ok);
}

module.exports = {
  MicrosoftAuthError,
  createAuthorizationUrl,
  handleCallback,
  isEnabled,
  getConfig: getMicrosoftAuthConfig,
  buildCallbackUriFromRequest,
  resolveRedirectUriForRequest,
  pickAllowlistedRedirectUri,
  MICROSOFT_CALLBACK_PATH
};
