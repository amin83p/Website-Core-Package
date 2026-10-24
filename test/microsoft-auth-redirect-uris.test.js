'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRedirectUrisFromEnv,
  normalizeRedirectUri,
  getMicrosoftAuthConfig,
  validateMicrosoftAuthConfig
} = require('../config/microsoftAuth');
const microsoftAuthService = require('../MVC/services/microsoftAuthService');

function mockReq({ host = 'app.example.com', proto = 'https' } = {}) {
  return {
    protocol: proto,
    get(name) {
      const key = String(name || '').toLowerCase();
      if (key === 'host') return host;
      if (key === 'x-forwarded-host') return '';
      if (key === 'x-forwarded-proto') return proto;
      return '';
    }
  };
}

test('parseRedirectUrisFromEnv reads comma-separated MICROSOFT_REDIRECT_URIS', () => {
  const uris = parseRedirectUrisFromEnv({
    MICROSOFT_REDIRECT_URIS: 'https://a.example/auth/microsoft/callback, https://b.example/auth/microsoft/callback/'
  });
  assert.deepEqual(uris, [
    'https://a.example/auth/microsoft/callback',
    'https://b.example/auth/microsoft/callback'
  ]);
});

test('parseRedirectUrisFromEnv falls back to MICROSOFT_REDIRECT_URI', () => {
  const uris = parseRedirectUrisFromEnv({
    MICROSOFT_REDIRECT_URI: 'https://legacy.example/auth/microsoft/callback'
  });
  assert.deepEqual(uris, ['https://legacy.example/auth/microsoft/callback']);
});

test('getMicrosoftAuthConfig exposes redirectUris and redirectUri', () => {
  const prevPlural = process.env.MICROSOFT_REDIRECT_URIS;
  const prevSingle = process.env.MICROSOFT_REDIRECT_URI;
  process.env.MICROSOFT_REDIRECT_URIS = 'https://one.example/auth/microsoft/callback,https://two.example/auth/microsoft/callback';
  delete process.env.MICROSOFT_REDIRECT_URI;
  try {
    const config = getMicrosoftAuthConfig();
    assert.equal(config.redirectUri, 'https://one.example/auth/microsoft/callback');
    assert.equal(config.redirectUris.length, 2);
  } finally {
    if (prevPlural === undefined) delete process.env.MICROSOFT_REDIRECT_URIS;
    else process.env.MICROSOFT_REDIRECT_URIS = prevPlural;
    if (prevSingle === undefined) delete process.env.MICROSOFT_REDIRECT_URI;
    else process.env.MICROSOFT_REDIRECT_URI = prevSingle;
  }
});

test('validateMicrosoftAuthConfig requires at least one redirect URI when enabled', () => {
  const validation = validateMicrosoftAuthConfig({
    enabled: true,
    clientId: 'id',
    clientSecret: 'secret',
    redirectUris: [],
    allowedDomain: 'example.com'
  });
  assert.equal(validation.ok, false);
  assert.match(validation.missing.join(' '), /MICROSOFT_REDIRECT_URIS/);
});

test('resolveRedirectUriForRequest picks allowlisted callback for request host', () => {
  const config = {
    redirectUris: [
      'https://equalizer.up.railway.app/auth/microsoft/callback',
      'https://school.example.com/auth/microsoft/callback'
    ]
  };
  const req = mockReq({ host: 'school.example.com' });
  const uri = microsoftAuthService.resolveRedirectUriForRequest(req, config);
  assert.equal(uri, 'https://school.example.com/auth/microsoft/callback');
});

test('resolveRedirectUriForRequest rejects hosts not in allowlist', () => {
  const config = {
    redirectUris: ['https://equalizer.up.railway.app/auth/microsoft/callback']
  };
  const req = mockReq({ host: 'unknown.example.com' });
  assert.throws(
    () => microsoftAuthService.resolveRedirectUriForRequest(req, config),
    (error) => error.code === 'REDIRECT_URI_NOT_ALLOWED'
  );
});

test('normalizeRedirectUri strips trailing slash from path', () => {
  assert.equal(
    normalizeRedirectUri('https://app.example/auth/microsoft/callback/'),
    'https://app.example/auth/microsoft/callback'
  );
});
