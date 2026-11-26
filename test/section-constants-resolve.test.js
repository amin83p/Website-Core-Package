'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { auditSectionConstants } = require('../scripts/security/audit-section-constants');

const repoRoot = path.join(__dirname, '..');

test('SECTIONS constants resolve in sections catalog', () => {
  const report = auditSectionConstants(repoRoot);
  assert.equal(report.mismatches.length, 0, () => {
    return report.mismatches
      .map((row) => `[${row.source}] ${row.token} — ${row.reason}`)
      .join('\n');
  });
});