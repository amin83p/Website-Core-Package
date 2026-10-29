'use strict';

/**
 * Readiness checks for railway_proxy upload mode.
 * Does not mutate data. Exits 0 when checks pass or mode is local.
 */

const fs = require('fs');
const path = require('path');
const { loadEnvFileIntoProcessEnv } = require('../../MVC/utils/envFileUtils');

const envPath = path.join(__dirname, '../../.env');
try {
  const result = loadEnvFileIntoProcessEnv(envPath, { fsModule: fs });
  if (result.loaded > 0) {
    console.log(`[smoke-upload-remote] loaded ${result.loaded} variable(s) from .env`);
  } else if (!fs.existsSync(envPath)) {
    console.warn('[smoke-upload-remote] no .env file at project root — using process environment only');
  }
} catch (error) {
  console.warn(`[smoke-upload-remote] unable to load .env: ${error.message}`);
}

const uploadStoragePolicy = require('../../MVC/services/uploadStoragePolicyService');

function fail(message) {
  console.error(`[smoke-upload-remote] ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`[smoke-upload-remote] ${message}`);
}

const backend = uploadStoragePolicy.getStorageBackend();
ok(`storage backend: ${backend}`);

if (backend === 'local') {
  ok('local mode — skipping remote gateway checks');
  ok('hint: set UPLOAD_MODE=railway_proxy in .env or the shell to validate gateway readiness');
  process.exit(0);
}

try {
  uploadStoragePolicy.assertStorageReadyForOperation();
  ok('storage policy validation passed');
} catch (error) {
  fail(error.message || String(error));
}

if (backend === 'railway_gateway') {
  const base = String(process.env.RAILWAY_GATEWAY_BASE_URL || '').trim();
  const key = String(process.env.FILE_GATEWAY_SHARED_KEY || '').trim();
  if (!base) fail('RAILWAY_GATEWAY_BASE_URL is missing');
  if (!key) fail('FILE_GATEWAY_SHARED_KEY is missing');
  ok('gateway env vars present');
}

ok('readiness complete — run manual matrix in docs/upload-remote-smoke-matrix.md');
