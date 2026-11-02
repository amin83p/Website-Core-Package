'use strict';

const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '../..');
const runner = path.join(__dirname, 'esbuild-track-activity-browser.mjs');

try {
  execSync(`node "${runner}"`, { cwd: root, stdio: 'inherit', shell: true });
} catch (err) {
  console.error('Failed to build trackActivityCore.browser.js:', err.message || err);
  process.exitCode = 1;
}
