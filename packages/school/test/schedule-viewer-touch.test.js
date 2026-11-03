'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readMasterScheduleViewerJs() {
  return fs.readFileSync(path.join(root, 'public/scripts/masterScheduleViewer.js'), 'utf8');
}

test('master schedule viewer wires long-press session context menu', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /bindScheduleSessionContextMenuLongPress/);
  assert.match(source, /SCHEDULE_LONG_PRESS_MS/);
  assert.match(source, /openScheduleSessionContextMenuFromTarget/);
  assert.match(source, /scheduleLongPressSuppressContextMenuUntil/);
});

test('master schedule viewer disables hover tips on narrow or touch-only viewports', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /shouldUseScheduleHoverTips/);
  assert.match(source, /\(hover: none\)/);
  assert.match(source, /max-width: 767\.98px/);
});

test('month session chips show compact start-end range', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /function buildCalendarSessionChipHtml/);
  assert.match(source, /formatScheduleCompactClock\(event\?\.end\)/);
});

test('narrow viewport defaults hide empty days and uses compact grid sizing', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /SCHEDULE_MOBILE_DAY_WIDTH = 62/);
  assert.match(source, /SCHEDULE_MOBILE_TIME_GUTTER_WIDTH = 44/);
  assert.match(
    source,
    /readScheduleHideEmptyDays[\s\S]*stored === '0'[\s\S]*max-width: 767\.98px/
  );
  assert.match(source, /const autoFit = isVertical && !scheduleState\.verticalDayWidthUserAdjusted;/);
  assert.match(source, /schedule-week-grid-narrow/);
  assert.match(source, /function scheduleShouldFilterEmptyDays/);
  assert.match(source, /isScheduleNarrowViewport\(\)\) return true/);
});

test('master schedule long press uses touchstart for iOS context menu', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /addEventListener\('touchstart'/);
  assert.match(source, /passive: false/);
});

test('week grid session blocks render stacked start and end times', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /function buildScheduleEventTimeRangeHtml/);
  assert.match(source, /schedule-event-time-stacked/);
});
