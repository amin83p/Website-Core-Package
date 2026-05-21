const crypto = require('crypto');
const msal = require('@azure/msal-node');
const { getMicrosoftAuthConfig, validateMicrosoftAuthConfig } = require('../../config/microsoftAuth');

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

async function createAuthorizationUrl(req) {
  requireSession(req);
  const config = requireConfig();
  const client = getClient(config);

  const codeVerifier = randomToken(64);
  const state = randomToken(32);
  const nonce = randomToken(32);

  req.session.microsoftAuth = {
    state,
    nonce,
    codeVerifier,
    createdAt: Date.now()
  };
  await saveSession(req);

  return client.getAuthCodeUrl({
    scopes: config.scopes,
    redirectUri: config.redirectUri,
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

  const client = getClient(config);
  const result = await client.acquireTokenByCode({
    code,
    scopes: config.scopes,
    redirectUri: config.redirectUri,
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
  getConfig: getMicrosoftAuthConfig
};
