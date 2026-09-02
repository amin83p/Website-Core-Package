const test = require('node:test');
const assert = require('node:assert/strict');

const activityService = require('../MVC/services/school/activityService');

test('matchesEligiblePersonQuery supports multi-token name search', () => {
  const haystack = activityService.buildEligiblePersonSearchHaystack({
    person: {
      id: 'PER-001',
      preferredName: 'Elahe',
      firstName: 'Elahe',
      lastName: 'Ghorbanchian'
    },
    row: { personId: 'PER-001', personName: 'Elahe Ghorbanchian', id: 'TEACH-001' },
    role: 'teacher',
    displayName: 'Elahe'
  });

  assert.equal(activityService.matchesEligiblePersonQuery(haystack, 'elahe ghorbanchian'), true);
  assert.equal(activityService.matchesEligiblePersonQuery(haystack, 'ghorbanchian'), true);
  assert.equal(activityService.matchesEligiblePersonQuery(haystack, 'elahe'), true);
  assert.equal(activityService.matchesEligiblePersonQuery(haystack, 'missing name'), false);
});
