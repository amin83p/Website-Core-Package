'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const {
  resolveCacheControl,
  isVersionedRequest,
  createStaticAssetMiddleware,
  LONG_CACHE_SECONDS,
  UPLOAD_CACHE_SECONDS
} = require('../MVC/middleware/staticAssetMiddleware');
const { buildStaticAssetUrl } = require('../MVC/utils/staticAssetUrl');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('buildStaticAssetUrl appends build version query when available', () => {
  assert.equal(buildStaticAssetUrl('/scripts/main.js', 'abc123'), '/scripts/main.js?v=abc123');
  assert.equal(buildStaticAssetUrl('/scripts/main.js?foo=1', 'abc123'), '/scripts/main.js?foo=1&v=abc123');
  assert.equal(buildStaticAssetUrl('/scripts/main.js', ''), '/scripts/main.js');
  assert.equal(buildStaticAssetUrl('/scripts/main.js', 'not-a-hash'), '/scripts/main.js');
});

test('resolveCacheControl uses long immutable cache for versioned static assets in production', () => {
  const req = { path: '/scripts/main.js', query: { v: 'abc123' } };
  const cacheControl = resolveCacheControl(req, {
    isProduction: true,
    buildVersionShort: 'abc123'
  });
  assert.equal(cacheControl, `public, max-age=${LONG_CACHE_SECONDS}, immutable`);
});

test('resolveCacheControl keeps short revalidation for unversioned static assets in production', () => {
  const req = { path: '/scripts/main.js', query: {} };
  const cacheControl = resolveCacheControl(req, { isProduction: true });
  assert.match(cacheControl, /must-revalidate/);
  assert.doesNotMatch(cacheControl, /immutable/);
});

test('resolveCacheControl uses no-cache outside production', () => {
  const req = { path: '/scripts/main.js', query: { v: 'abc123' } };
  assert.equal(resolveCacheControl(req, { isProduction: false }), 'no-cache');
});

test('resolveCacheControl uses upload profile for user uploads', () => {
  const req = { path: '/uploads/org/logo.png', query: {} };
  const cacheControl = resolveCacheControl(req, {
    isProduction: true,
    cacheProfile: 'upload'
  });
  assert.equal(cacheControl, `public, max-age=${UPLOAD_CACHE_SECONDS}, must-revalidate`);
});

test('isVersionedRequest accepts matching build hash and generic hex cache-bust tokens', () => {
  assert.equal(isVersionedRequest({ query: { v: 'abc123' } }, 'abc123'), true);
  assert.equal(isVersionedRequest({ query: { v: 'fedcba' } }, 'abc123'), true);
  assert.equal(isVersionedRequest({ query: { v: 'bad' } }, 'abc123'), false);
  assert.equal(isVersionedRequest({ query: {} }, 'abc123'), false);
});

test('app wires compression and static asset middleware', () => {
  const appSource = read('app.js');
  assert.match(appSource, /require\('compression'\)/);
  assert.match(appSource, /app\.use\(compression\(/);
  assert.match(appSource, /staticAssetMiddleware/);
  assert.match(appSource, /createAppStaticMiddleware/);
  assert.match(appSource, /staticFactory:\s*\(rootPath\)\s*=>\s*createAppStaticMiddleware\(rootPath\)/);
  assert.ok(appSource.indexOf("app.use(createAppStaticMiddleware(path.join(__dirname, 'public')))") < appSource.indexOf('app.use(cookieParser'));
  assert.ok(appSource.indexOf('app.use(packageAssetRuntimeRouter)') < appSource.indexOf('app.use(cookieParser'));
  assert.match(appSource, /rolling:\s*sessionStore \? false : true/);
  assert.match(appSource, /REQUEST_PATH_TIMING/);
  assert.match(appSource, /createRequestPathTimingMiddleware\('authenticated-html'\)/);
  assert.ok(appSource.indexOf('resave: false') < appSource.indexOf('rolling: sessionStore ? false : true'));
  assert.ok(appSource.indexOf('saveUninitialized: false') < appSource.indexOf('rolling: sessionStore ? false : true'));
});

test('layout uses versioned static asset URLs when helper is available', () => {
  const layout = read('MVC/views/layouts/layout.ejs');
  assert.match(layout, /staticAssetUrl\('/);
});

test('static asset middleware serves files with cache and vary headers', async () => {
  const publicRoot = path.join(ROOT_DIR, 'public');
  const middleware = createStaticAssetMiddleware(publicRoot, {
    isProduction: true,
    getBuildVersionShort: () => 'abc123'
  });

  const server = http.createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end('not found');
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/scripts/main.js?v=abc123`);
    assert.equal(response.status, 200);
    assert.match(String(response.headers.get('cache-control') || ''), /immutable/);
    assert.equal(response.headers.get('vary'), 'Accept-Encoding');
  } finally {
    server.close();
  }
});
