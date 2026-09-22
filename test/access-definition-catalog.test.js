'use strict';

const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VALIDATOR = path.join(ROOT, 'scripts/design_docs/validate-access-catalog.mjs');

test('access-definition-catalog.json paths resolve', () => {
  const result = spawnSync(process.execPath, [VALIDATOR], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (result.status !== 0) {
    throw new Error(output || `validator exited with ${result.status}`);
  }
});
