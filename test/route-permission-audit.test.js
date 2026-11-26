'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  runRoutePermissionAudit,
  auditDeleteDataWithoutUser
} = require('../scripts/security/audit-route-permissions');

const repoRoot = path.join(__dirname, '..');

test('core MVC routes pass route permission audit', () => {
  const report = runRoutePermissionAudit(repoRoot, {
    enforceCore: true,
    enforcePackages: false
  });
  assert.equal(report.coreFindings.length, 0, () => {
    const lines = report.coreFindings.map((row) => `${row.method} ${row.routePath} — ${row.file}`);
    return `Unallowlisted core route gaps:\n${lines.join('\n')}`;
  });
});

test('package routes pass route permission audit (allowlisted exceptions)', () => {
  const report = runRoutePermissionAudit(repoRoot, {
    enforceCore: true,
    enforcePackages: true
  });
  assert.equal(report.packageFindings.length, 0, () => {
    const lines = report.packageFindings.slice(0, 25).map((row) => `${row.method} ${row.routePath} — ${row.file}`);
    const extra = report.packageFindings.length > 25
      ? `\n... and ${report.packageFindings.length - 25} more`
      : '';
    return `Unallowlisted package route gaps:\n${lines.join('\n')}${extra}`;
  });
});

test('sensitive controllers pass deleteData(user) audit', () => {
  const findings = auditDeleteDataWithoutUser(repoRoot);
  assert.equal(findings.length, 0, () => findings.map((row) => `${row.file}: ${row.snippet}`).join('\n'));
});