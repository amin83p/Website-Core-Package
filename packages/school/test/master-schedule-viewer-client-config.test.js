'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMasterScheduleViewerClientConfig } = require('../MVC/services/school/masterScheduleViewerClientConfig');

test('buildMasterScheduleViewerClientConfig whitelists capability flags and sanitized prefs', () => {
  const config = buildMasterScheduleViewerClientConfig({
    scheduleCapabilities: {
      canSelectAnyPerson: true,
      canDragCreateSessions: true,
      canLoadAllSchedules: true
    },
    viewerScheduleAccess: {
      availableRoles: [{ key: 'teacher', label: 'Teacher' }],
      selectedRole: 'teacher'
    },
    initialScheduleViewerPrefs: {
      startDate: '2026-09-01',
      endDate: '2026-09-07',
      autoChangeDetector: false
    }
  });

  assert.equal(config.canSelectAnyPerson, true);
  assert.equal(config.canDragCreateSessions, true);
  assert.equal(config.initialScheduleViewerPrefs.startDate, '2026-09-01');
  assert.equal(config.initialScheduleViewerPrefs.autoChangeDetector, false);
  assert.equal(config.api.viewerPreferences, '/school/schedules/api/viewer-preferences');
  assert.equal(config.constants.commitTimeoutMs, 120000);
  assert.ok(config.initialScheduleRoles.length >= 1);
});
