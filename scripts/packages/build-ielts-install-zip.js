#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const builderPath = path.join(__dirname, 'build-package-install-zip.js');
const result = spawnSync(
  process.execPath,
  [builderPath, '--package-id', 'ielts', ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  }
);

if (result.error) {
  process.stderr.write(`${result.error.message || String(result.error)}\n`);
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
