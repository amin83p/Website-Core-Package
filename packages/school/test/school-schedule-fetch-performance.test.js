'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('person schedule build uses scoped identity fetches and class hydration helpers', () => {
  const controller = read('MVC/controllers/school/scheduleController.js');
  assert.match(controller, /runWithConcurrency/);
  assert.match(controller, /hydrateClassMapForScheduleCandidates/);
  assert.match(controller, /resolveClassSessionsForScheduleScan/);
  assert.match(controller, /readEmbeddedClassSessions/);
  assert.match(controller, /personId__eq: normalizedPersonIdInput/);
  assert.match(controller, /personId__eq: normalizedPersonId/);
  assert.doesNotMatch(controller, /fetchAllData\('classes', \{\}, reqUser, accessContext\),\s*\n\s*schoolRepositories\.reportAssignments/);
});

test('person schedule API supports request capability cache, status cache, and minimal enrichment', () => {
  const controller = read('MVC/controllers/school/scheduleController.js');
  const access = read('MVC/services/school/scheduleAccessService.js');
  assert.match(controller, /resolveScheduleCapabilitiesForRequest/);
  assert.match(controller, /getScheduleClientStatusMetaForRequest/);
  assert.match(controller, /enrichment.*minimal/);
  assert.match(controller, /createPersonScheduleBuildTimer/);
  assert.match(controller, /SCHEDULE_PERSON_BUILD_TIMING/);
  assert.match(access, /precomputedCapabilities/);
});

test('merge link expansion reuses embedded class sessions when classMap is populated', () => {
  const controller = read('MVC/controllers/school/scheduleController.js');
  assert.match(controller, /expandScheduleCandidateClassIdsForMergeLinks\([\s\S]*classMap/);
  assert.match(controller, /resolveClassSessionsForScheduleScan\(classId, classDef/);
});

test('runWithConcurrency preserves result order', async () => {
  const { runWithConcurrency } = require('../MVC/controllers/school/scheduleController');
  const input = [1, 2, 3, 4, 5];
  const results = await runWithConcurrency(input, 2, async (value) => value * 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});
