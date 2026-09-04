const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const {
  createService,
  extractPreferences,
  sanitizeForAccess,
  mergePreferences,
  hasSavedPreferences,
  emptyPreferences
} = require('../MVC/services/school/scheduleViewerPreferencesService');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('extractPreferences normalizes dates, persons, and autoChangeDetector', () => {
  const prefs = extractPreferences({
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    activePersonId: 'P2',
    persons: [
      { id: 'P1', name: 'Alpha', selectedRole: 'teacher' },
      { id: 'P2', name: 'Beta' },
      { id: 'P1', name: 'Duplicate' }
    ],
    autoChangeDetector: false
  });

  assert.equal(prefs.startDate, '2026-09-01');
  assert.equal(prefs.endDate, '2026-09-07');
  assert.equal(prefs.activePersonId, 'P2');
  assert.equal(prefs.persons.length, 2);
  assert.equal(prefs.persons[0].id, 'P1');
  assert.equal(prefs.autoChangeDetector, false);
});

test('extractPreferences rejects invalid dates and defaults active person', () => {
  const prefs = extractPreferences({
    startDate: 'not-a-date',
    endDate: '2026-09-07',
    activePersonId: 'missing',
    persons: [{ id: 'P1', name: 'Alpha' }]
  });

  assert.equal(prefs.startDate, '');
  assert.equal(prefs.endDate, '2026-09-07');
  assert.equal(prefs.activePersonId, 'P1');
});

test('mergePreferences preserves existing values for partial updates', () => {
  const current = extractPreferences({
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    activePersonId: 'P1',
    persons: [{ id: 'P1', name: 'Alpha' }],
    autoChangeDetector: true
  });
  const merged = mergePreferences(current, { autoChangeDetector: false });

  assert.equal(merged.startDate, '2026-09-01');
  assert.equal(merged.endDate, '2026-09-07');
  assert.equal(merged.persons.length, 1);
  assert.equal(merged.autoChangeDetector, false);
});

test('sanitizeForAccess keeps only locked person for non-admin viewers', () => {
  const prefs = extractPreferences({
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    activePersonId: 'OTHER',
    persons: [
      { id: 'OTHER', name: 'Other Person' },
      { id: 'LOCKED', name: 'Locked Teacher', selectedRole: 'teacher' }
    ],
    autoChangeDetector: false
  });

  const sanitized = sanitizeForAccess(prefs, {
    canSelectAnyPerson: false,
    lockedPersonId: 'LOCKED',
    lockedPersonName: 'Locked Teacher'
  });

  assert.equal(sanitized.persons.length, 1);
  assert.equal(sanitized.persons[0].id, 'LOCKED');
  assert.equal(sanitized.activePersonId, 'LOCKED');
  assert.equal(sanitized.autoChangeDetector, false);
});

test('hasSavedPreferences detects meaningful workspace state', () => {
  assert.equal(hasSavedPreferences(emptyPreferences()), false);
  assert.equal(hasSavedPreferences({ startDate: '2026-09-01', endDate: '2026-09-07' }), true);
  assert.equal(hasSavedPreferences({ persons: [{ id: 'P1', name: 'Alpha' }] }), true);
});

test('savePreferences writes merged blob through userSettingsService', async () => {
  const writes = [];
  const service = createService({
    userSettingsService: {
      async getSettings() {
        return {
          schoolScheduleViewer: {
            startDate: '2026-08-01',
            endDate: '2026-08-07',
            persons: [{ id: 'P1', name: 'Alpha' }],
            autoChangeDetector: true
          }
        };
      },
      async setSettings(userId, settings, actor) {
        writes.push({ userId, settings, actor });
        return settings;
      }
    }
  });

  const saved = await service.savePreferences(
    'USER-1',
    {
      startDate: '2026-09-01',
      endDate: '2026-09-07',
      persons: [{ id: 'P2', name: 'Beta', selectedRole: 'teacher' }],
      activePersonId: 'P2'
    },
    { id: 'USER-1' },
    {
      access: {
        canSelectAnyPerson: true,
        lockedPersonId: '',
        lockedPersonName: ''
      }
    }
  );

  assert.equal(saved.activePersonId, 'P2');
  assert.equal(saved.persons.length, 1);
  assert.equal(saved.persons[0].id, 'P2');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].settings.schoolScheduleViewer.startDate, '2026-09-01');
});

test('schedule routes expose viewer-preferences endpoints', () => {
  const routeSource = read('MVC/routes/scheduleRoutes.js');
  assert.match(routeSource, /\/api\/viewer-preferences/);
  assert.match(routeSource, /getScheduleViewerPreferences/);
  assert.match(routeSource, /saveScheduleViewerPreferences/);
});

test('personSchedule wires workspace save and user-settings restore', () => {
  const source = read('MVC/views/school/schedule/personSchedule.ejs');

  assert.match(source, /initialScheduleViewerPrefs/);
  assert.match(source, /data-schedule-save-workspace/);
  assert.match(source, /saveScheduleWorkspace/);
  assert.match(source, /schedulePersonTabs.*addEventListener\('click'[\s\S]*data-schedule-save-workspace/);
  assert.match(source, /initializeScheduleViewer/);
  assert.match(source, /loadAllSavedSchedulePersons/);
  assert.match(source, /SCHEDULE_VIEWER_PREFS_API/);
  assert.match(source, /persistScheduleViewerPreferencesPartial/);

  assert.doesNotMatch(source, /buildScheduleSaveDraftsButtonHtml/);
  assert.doesNotMatch(source, /data-schedule-save-drafts/);
  assert.doesNotMatch(source, /SCHEDULE_AUTO_CHANGE_DETECTOR_KEY/);
});
