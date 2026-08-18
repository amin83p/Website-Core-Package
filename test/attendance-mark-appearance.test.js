const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../packages/school/MVC/services/school/attendanceMarkAppearanceService');

test('default late mark uses pure yellow', () => {
  const late = service.DEFAULT_MARKS.find((row) => row.key === 'late');
  assert.equal(late.color, '#FFFF00');
});

test('resolvePolicy returns all fixed mark keys', () => {
  const resolved = service.resolvePolicy(service.DEFAULT_POLICY);
  assert.equal(resolved.marks.length, service.MARK_KEYS.length);
  assert.deepEqual(resolved.marks.map((row) => row.key), service.MARK_KEYS);
});

test('validatePolicyMarks rejects invalid hex colors', () => {
  const invalid = service.DEFAULT_MARKS.map((row) => ({
    ...row,
    color: row.key === 'present' ? 'red' : row.color
  }));
  const result = service.validatePolicyMarks(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /valid hex color/i);
});

test('validatePolicyMarks rejects unknown icons', () => {
  const invalid = service.DEFAULT_MARKS.map((row) => ({
    ...row,
    icon: row.key === 'present' ? 'not-a-real-bootstrap-icon' : row.icon
  }));
  const result = service.validatePolicyMarks(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /icon is not allowed/i);
});

test('normalizePolicyFromForm accepts customized labels and colors', () => {
  const customized = service.DEFAULT_MARKS.map((row) => {
    if (row.key === 'present') {
      return { ...row, label: 'On site', color: '#00AA00', icon: 'check-circle' };
    }
    return { ...row };
  });
  const normalized = service.normalizePolicyFromForm({ marks: customized });
  const present = normalized.marks.find((row) => row.key === 'present');
  assert.equal(present.label, 'On site');
  assert.equal(present.color, '#00AA00');
  assert.equal(present.icon, 'check-circle');
});

test('buildCssVariableMap exposes CSS custom properties', () => {
  const map = service.buildCssVariableMap(service.DEFAULT_POLICY);
  assert.equal(map['--att-mark-late'], '#FFFF00');
  assert.equal(map['--att-mark-timing-excuse-ring'], '#198754');
});

test('buildLegendEntries includes all display marks', () => {
  const entries = service.buildLegendEntries(service.DEFAULT_POLICY);
  const keys = entries.map((row) => row.key);
  assert.ok(keys.includes('not_applicable'));
  assert.ok(keys.includes('unmarked'));
  assert.ok(keys.includes('late_excused'));
  assert.ok(keys.includes('early_leave_excused'));
});
