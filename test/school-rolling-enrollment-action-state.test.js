const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('rolling enrollment mutation routes allow expired operation token fallback', () => {
  const source = read('packages/school/MVC/routes/classRoutes.js');

  assert.match(source, /const\s+rollingEnrollmentMutationActionState\s*=\s*{/);
  assert.match(source, /rollingEnrollmentMutationActionState[\s\S]*requireToken:\s*true/);
  assert.match(source, /rollingEnrollmentMutationActionState[\s\S]*keepActive:\s*true/);
  assert.match(source, /rollingEnrollmentMutationActionState[\s\S]*allowOperationTokenFallback:\s*true/);
  assert.match(source, /rollingEnrollmentMutationActionState[\s\S]*allowInactiveTokenFallback:\s*true/);

  [
    '/api/enrollment-periods/preview-create',
    '/api/enrollment-periods/create-with-transactions',
    '/api/enrollment-periods/:periodId/draft',
    '/api/enrollment-periods/:periodId/approve',
    '/api/enrollment-periods/:periodId/sync-academic-ledger',
    '/api/enrollment-periods/:periodId/edit',
    '/api/enrollment-periods/:periodId/remove',
    '/api/enrollment-periods/create',
    '/api/enrollment-periods/:periodId/close',
    '/api/enrollment-periods/:periodId/reopen',
    '/api/enrollment-periods/check-overlap',
    '/api/enrollment-periods/evaluate-reentry',
    '/api/:classId/cycles/close',
    '/api/:classId/cycles/create-next',
    '/api/:classId/cycles/preview-rollover',
    '/api/cycles/carry-forward',
    '/api/cycles/split-boundary'
  ].forEach((routePath) => {
    const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const routePattern = new RegExp(
      `router\\.post\\('${escaped}'[\\s\\S]*?trackActionState\\([^\\n]+rollingEnrollmentMutationActionState\\)`
    );
    assert.match(source, routePattern, `${routePath} should use rollingEnrollmentMutationActionState`);
  });
});
