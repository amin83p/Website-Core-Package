'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKIP_CALL_NAMES = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'new', 'typeof', 'await',
  'Number', 'String', 'Boolean', 'Math', 'Array', 'Object', 'Date', 'JSON', 'Set', 'Map',
  'Promise', 'Error', 'RegExp', 'console', 'document', 'window', 'global', 'fetch',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'SetTimeout', 'clearTimeout', 'deps'
]);

function findBareCoreCallsInStaging(stagingSource, coreSource) {
  const coreFns = new Set();
  for (const m of coreSource.matchAll(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)) {
    coreFns.add(m[1]);
  }

  const localFns = new Set();
  for (const m of stagingSource.matchAll(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)) {
    localFns.add(m[1]);
  }

  const start = stagingSource.indexOf('function installMasterScheduleStaging');
  const end = stagingSource.lastIndexOf('global.MasterScheduleViewerStaging');
  if (start < 0 || end < 0) return [];
  const body = stagingSource.slice(start, end);

  const suspects = new Map();
  for (const m of body.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)) {
    const name = m[1];
    if (SKIP_CALL_NAMES.has(name) || localFns.has(name) || !coreFns.has(name)) continue;
    const idx = m.index;
    const before = body.slice(Math.max(0, idx - 6), idx);
    if (before.endsWith('deps.')) continue;
    suspects.set(name, (suspects.get(name) || 0) + 1);
  }
  return [...suspects.keys()].sort();
}

module.exports = { findBareCoreCallsInStaging };

if (require.main === module) {
  const root = path.join(__dirname, '..', '..', 'public', 'scripts');
  const staging = fs.readFileSync(path.join(root, 'masterScheduleViewerStaging.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'masterScheduleViewer.js'), 'utf8');
  const bare = findBareCoreCallsInStaging(staging, core);
  if (bare.length) {
    console.log(bare.join('\n'));
    process.exitCode = 1;
  }
}
