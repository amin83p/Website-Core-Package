'use strict';

const assert = require('assert');
const test = require('node:test');
const {
  normalizePublicSiteUrl,
  resolvePublicSiteUrl,
  resolveRequestOrigin
} = require('../MVC/services/appPublicUrlService');
const settingService = require('../MVC/services/settingService');

test('normalizePublicSiteUrl accepts empty', () => {
  assert.deepEqual(normalizePublicSiteUrl(''), { url: '', error: null });
  assert.deepEqual(normalizePublicSiteUrl('   '), { url: '', error: null });
});

test('normalizePublicSiteUrl stores origin only', () => {
  const result = normalizePublicSiteUrl('https://school.example.com/school/foo?x=1');
  assert.equal(result.error, null);
  assert.equal(result.url, 'https://school.example.com');
});

test('normalizePublicSiteUrl rejects invalid URLs', () => {
  const result = normalizePublicSiteUrl('not a url !!!');
  assert.ok(result.error);
  assert.equal(result.url, '');
});

test('resolveRequestOrigin uses forwarded headers', () => {
  const req = {
    protocol: 'http',
    get(name) {
      if (name === 'x-forwarded-proto') return 'https';
      if (name === 'x-forwarded-host') return 'app.example.com';
      return '';
    }
  };
  assert.equal(resolveRequestOrigin(req), 'https://app.example.com');
});

test('resolvePublicSiteUrl prefers configured setting over request', () => {
  const originalGet = settingService.get;
  settingService.get = () => ({
    app: { publicSiteUrl: 'https://configured.example' }
  });
  try {
    const req = {
      protocol: 'http',
      get(name) {
        if (name === 'host') return 'localhost:3000';
        return '';
      }
    };
    assert.equal(resolvePublicSiteUrl({ req }), 'https://configured.example');
  } finally {
    settingService.get = originalGet;
  }
});

test('resolvePublicSiteUrl falls back to request when setting empty', () => {
  const originalGet = settingService.get;
  settingService.get = () => ({
    app: { publicSiteUrl: '' }
  });
  try {
    const req = {
      protocol: 'https',
      get(name) {
        if (name === 'host') return 'localhost:3000';
        return '';
      }
    };
    assert.equal(resolvePublicSiteUrl({ req }), 'https://localhost:3000');
  } finally {
    settingService.get = originalGet;
  }
});
