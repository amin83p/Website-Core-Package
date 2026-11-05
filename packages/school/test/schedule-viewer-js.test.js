const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..', '..');
const {
  readPersonScheduleAdminBundle,
  readPersonScheduleSelfBundle,
  readPersonScheduleAdminView,
  readPersonScheduleSelfView,
  readPackageFile
} = require('./helpers/scheduleViewerSource');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function readMasterScheduleViewerJs() {
  return [
    read('public/scripts/masterScheduleViewer.js'),
    read('public/scripts/masterScheduleViewerStaging.js')
  ].join('\n');
}

test('personSchedule links external master schedule viewer scripts and JSON bootstrap', () => {
  const adminView = readPersonScheduleAdminBundle();
  const selfView = readPersonScheduleSelfBundle();
  assert.match(adminView, /id="masterScheduleViewerConfig"/);
  assert.match(selfView, /id="masterScheduleViewerConfig"/);
  assert.match(adminView, /type="application\/json"/);
  assert.match(adminView, /masterScheduleViewerClientConfig/);
  assert.match(readPersonScheduleAdminView(), /sectionsPageClass:\s*'schedule-viewer-page'/);
  assert.match(readPersonScheduleSelfView(), /sectionsPageClass:\s*'schedule-viewer-page'/);
  assert.match(adminView, /href="\/styles\/schedule-viewer\.css"/);
  assert.match(adminView, /src="\/scripts\/masterScheduleViewer\.js"/);
  assert.match(adminView, /masterScheduleViewerStaging\.js/);
  assert.doesNotMatch(selfView, /masterScheduleViewerStaging\.js/);
  assert.doesNotMatch(adminView, /^<script>\s*document\.addEventListener/m);
  assert.doesNotMatch(adminView, /document\.addEventListener\('DOMContentLoaded'/);
});

test('masterScheduleViewer.js reads bootstrap config and avoids inline secrets', () => {
  const core = read('public/scripts/masterScheduleViewer.js');
  assert.match(core, /readMasterScheduleViewerConfig/);
  assert.match(core, /getElementById\('masterScheduleViewerConfig'\)/);
  assert.doesNotMatch(core, /masterScheduleViewerClientConfig/);
  assert.match(core, /MasterScheduleViewerStaging\.install/);
});

test('masterScheduleViewerStaging.js exports install hook', () => {
  const staging = read('public/scripts/masterScheduleViewerStaging.js');
  assert.match(staging, /MasterScheduleViewerStaging/);
  assert.match(staging, /function installMasterScheduleStaging/);
  assert.match(staging, /bindScheduleDragCreate/);
});

test('master schedule viewer modules pass syntax check', () => {
  const { execSync } = require('node:child_process');
  const corePath = path.join(root, 'public/scripts/masterScheduleViewer.js');
  const stagingPath = path.join(root, 'public/scripts/masterScheduleViewerStaging.js');
  execSync(`node --check "${corePath}"`, { stdio: 'pipe' });
  execSync(`node --check "${stagingPath}"`, { stdio: 'pipe' });
});

test('masterScheduleViewerStaging uses core helpers via deps only', () => {
  const { findBareCoreCallsInStaging } = require('./helpers/findStagingBareCoreCalls');
  const staging = read('public/scripts/masterScheduleViewerStaging.js');
  const core = read('public/scripts/masterScheduleViewer.js');
  const bare = findBareCoreCallsInStaging(staging, core);
  assert.deepEqual(
    bare,
    [],
    `staging must reference core functions through deps; bare calls: ${bare.join(', ')}`
  );
});

test('schedule controller builds whitelisted client config', () => {
  const controller = read('MVC/controllers/school/scheduleController.js');
  assert.match(controller, /personScheduleAdmin/);
  assert.match(controller, /personScheduleSelf/);
  assert.match(controller, /buildMasterScheduleViewerClientConfig/);
  assert.match(controller, /masterScheduleViewerClientConfig/);
  const helper = read('MVC/services/school/masterScheduleViewerClientConfig.js');
  assert.match(helper, /canSelectAnyPerson/);
  assert.match(helper, /initialScheduleViewerPrefs/);
  assert.match(helper, /scheduleViewerPreferencesService\.extractPreferences/);
  assert.doesNotMatch(helper, /req\.user/);
});

test('schedule events expose co-teacher card metadata and viewer wires badges', () => {
  const controller = read('MVC/controllers/school/scheduleController.js');
  assert.match(controller, /hasCoTeachers:\s*sessionCoTeachers\.length\s*>\s*0/);
  assert.match(controller, /viewerIsSessionCoTeacher:\s*Boolean\(coTeacherEntry\)/);
  assert.match(controller, /viewerCoTeacherPaid:/);

  const viewer = readMasterScheduleViewerJs();
  assert.match(viewer, /function buildScheduleCoTeacherBadgesHtml/);
  assert.match(viewer, /bi-people-fill/);
  assert.match(viewer, /buildScheduleCoTeacherBadgesHtml\(ev/);
  assert.match(viewer, /Your co-teacher pay/);
  assert.match(viewer, /function applyClassSessionCoTeacherChangesInView/);
  assert.match(viewer, /function patchClassSessionCoTeachersInState/);
  assert.match(viewer, /function applyScheduleSessionChangesInView/);
  assert.match(viewer, /function removeClassSessionsAcrossLoadedPersons/);
  assert.match(viewer, /function upsertClassSessionEventsInState/);
  assert.match(viewer, /SCHEDULE_REFRESH_SESSIONS_API/);

  const styles = read('public/styles/schedule-viewer.css');
  assert.match(styles, /\.schedule-co-teacher-badges/);
});

test('master schedule viewer templates expose core DOM hooks', () => {
  const adminView = readPersonScheduleAdminBundle();
  const selfView = readPersonScheduleSelfBundle();
  const calendarShell = read('MVC/views/school/schedule/partials/personScheduleCalendarShell.ejs');
  const filterPartials = read('MVC/views/school/schedule/partials/personScheduleStartDateWithShortcuts.ejs')
    + read('MVC/views/school/schedule/partials/personScheduleDateRangeShortcuts.ejs');
  assert.match(filterPartials, /'sch_startDate'/);
  assert.match(filterPartials, /'btn_scheduleDateShortcuts'/);
  assert.match(filterPartials, /'scheduleDateRangeMenu'/);
  const adminOnlyIds = ['sch_endDate', 'btn_loadSchedule'];
  adminOnlyIds.forEach((id) => {
    assert.match(adminView, new RegExp(`id="${id}"`));
  });
  const sharedIds = ['scheduleContainer', 'scheduleSessionContextMenu'];
  sharedIds.forEach((id) => {
    assert.match(adminView, new RegExp(`id="${id}"`));
    if (id === 'scheduleContainer') {
      assert.match(readPersonScheduleSelfView(), /personScheduleCalendarShell/);
      assert.match(calendarShell, new RegExp(`id="${id}"`));
    } else {
      assert.match(selfView, new RegExp(`id="${id}"`));
    }
  });
  assert.match(adminView, /scheduleAdminWeekRail/);
  assert.match(readPersonScheduleSelfView(), /personScheduleIncludeAdminRail:\s*false/);
});

test('personSchedule includes master schedule person note script', () => {
  const adminView = readPersonScheduleAdminBundle();
  const selfView = readPersonScheduleSelfBundle();
  assert.match(adminView, /data-schedule-admin-action="person-schedule-note"/);
  assert.match(adminView, /masterSchedulePersonNote\.js/);
  assert.doesNotMatch(selfView, /masterSchedulePersonNote\.js/);
});

test('Master Schedule Viewer uses date range menu instead of collapsible quick ranges', () => {
  const adminView = readPersonScheduleAdminBundle();
  const selfView = readPersonScheduleSelfBundle();
  const core = read('public/scripts/masterScheduleViewer.js');
  const shortcutsPartial = readPackageFile('MVC/views/school/schedule/partials/personScheduleDateRangeShortcuts.ejs');
  const startShortcutsPartial = readPackageFile('MVC/views/school/schedule/partials/personScheduleStartDateWithShortcuts.ejs');
  const rangeTokens = ['day', 'week', 'm0-first', 'm0-second', 'm0-full', 'm-1-first', 'm-1-full', 'm1-full'];

  for (const view of [adminView, selfView]) {
    assert.doesNotMatch(view, /scheduleFilterCollapse/);
    assert.doesNotMatch(view, /personScheduleQuickRangeChips/);
    assert.match(view, /personScheduleStartDateWithShortcuts/);
    assert.match(view, /personScheduleDateRangeShortcuts/);
  }
  assert.match(startShortcutsPartial, /'btn_scheduleDateShortcuts'/);
  assert.match(shortcutsPartial, /'scheduleDateRangeMenu'/);
  for (const token of rangeTokens) {
    assert.match(shortcutsPartial, new RegExp(`range: '${token}'`));
  }
  assert.match(shortcutsPartial, /Current Month/);
  assert.match(shortcutsPartial, /Previous Month/);
  assert.match(shortcutsPartial, /Next Month/);
  const shortcutsJs = read('public/scripts/schoolDateRangeShortcuts.js');
  assert.match(adminView, /schoolDateRangeShortcuts\.js/);
  assert.match(shortcutsJs, /normalizeRangeToken/);
  assert.match(shortcutsJs, /bindDateRangeShortcuts/);
  assert.match(shortcutsJs, /datesFromRangeToken/);
  assert.match(shortcutsJs, /confirmBeforeApply/);
  assert.match(shortcutsJs, /buildDateRangeShortcutConfirmHtml/);
  assert.match(core, /SchoolDateRangeShortcuts/);
  assert.match(core, /bindScheduleDateRangeShortcuts/);
  assert.match(core, /confirmBeforeApply/);
  assert.match(core, /Load schedule for this range/);
  assert.match(core, /applyScheduleRange/);
  assert.doesNotMatch(core, /function resolveScheduleRangeDates/);
  assert.doesNotMatch(core, /function normalizeScheduleRangeToken/);

  assert.match(adminView, /schedule-filter-load-primary/);
  assert.match(adminView, /schedule-filter-reset-btn/);
  assert.match(adminView, /id="btn_resetScheduleFilters"/);
  assert.match(adminView, /id="btn_loadAllSchedules"/);
  assert.match(core, /syncScheduleLoadAllButtonVisibility/);
  assert.doesNotMatch(core, /hasCasesOnly/);
  assert.doesNotMatch(core, /buildScheduleHasCasesFilterHtml/);
  assert.doesNotMatch(core, /params\.set\('hasCases'/);

  assert.match(shortcutsJs, /pointerdown', onOutside/);
  assert.match(shortcutsJs, /addEventListener\('contextmenu', onDateContextMenu\)/);
  assert.doesNotMatch(core, /scheduleFilterCollapse/);
});
