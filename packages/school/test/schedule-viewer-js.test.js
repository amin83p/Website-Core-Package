const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..', '..');

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
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /id="masterScheduleViewerConfig"/);
  assert.match(view, /type="application\/json"/);
  assert.match(view, /masterScheduleViewerClientConfig/);
  assert.match(view, /href="\/styles\/schedule-viewer\.css"/);
  assert.match(view, /src="\/scripts\/masterScheduleViewer\.js"/);
  assert.match(view, /if \(canDragCreateSessions\) \{ %>\s*<script src="\/scripts\/masterScheduleViewerStaging\.js"><\/script>/);
  assert.doesNotMatch(view, /^<script>\s*document\.addEventListener/m);
  assert.doesNotMatch(view, /document\.addEventListener\('DOMContentLoaded'/);
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
  assert.match(controller, /buildMasterScheduleViewerClientConfig/);
  assert.match(controller, /masterScheduleViewerClientConfig/);
  const helper = read('MVC/services/school/masterScheduleViewerClientConfig.js');
  assert.match(helper, /canSelectAnyPerson/);
  assert.match(helper, /initialScheduleViewerPrefs/);
  assert.match(helper, /scheduleViewerPreferencesService\.extractPreferences/);
  assert.doesNotMatch(helper, /req\.user/);
});
