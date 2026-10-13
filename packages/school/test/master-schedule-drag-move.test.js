'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('master schedule staging enables week-grid drag for vertical and horizontal timeline modes', () => {
  const staging = read('public/scripts/masterScheduleViewerStaging.js');
  assert.match(staging, /function isScheduleWeekGridDragMode\(mode\)/);
  assert.match(staging, /mode === 'verticalTimeline' \|\| mode === 'timeline'/);
  assert.match(staging, /enabled: weekGridDragEnabled/);
  assert.match(staging, /onMoveOutOfWeek/);
});

test('session calendar core exports cross-day move helpers', () => {
  const core = read('public/scripts/sessionCalendarCore.js');
  assert.match(core, /function resolveVerticalMoveContext\(/);
  assert.match(core, /function resolveTimelineMoveContext\(/);
  assert.match(core, /function isMoveContextWithinSourceWeek\(/);
  assert.match(core, /resolveTimelineMoveContext,/);
  assert.match(core, /layoutMode === 'timeline'/);
  assert.match(core, /resolveDayCellFromDaysRowX\(verticalRow, clientX, clientY\)/);
});
