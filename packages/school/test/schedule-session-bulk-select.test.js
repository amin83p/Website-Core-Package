const test = require('node:test');
const assert = require('node:assert/strict');

const { readMasterScheduleViewerJs, readPersonScheduleView, readPackageFile } = require('./helpers/scheduleViewerSource');

function timeToMinutes(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Mirrors collectMatchingSessionsForBulkSelect filtering (saved path). */
function collectMatchingSessionsFixture(anchorEvent, events, { selectionMode = 'count', stopDate, maxCount }) {
  const anchorDate = String(anchorEvent.date || '').trim();
  const classId = String(anchorEvent.classId || '').trim();
  const anchorStartMin = timeToMinutes(anchorEvent.start);
  const anchorEndMin = timeToMinutes(anchorEvent.end);
  const mode = selectionMode === 'date' ? 'date' : 'count';
  if (!anchorDate || !classId || anchorEndMin <= anchorStartMin) return [];
  if (mode === 'date' && !stopDate) return [];
  if (mode === 'count' && !(maxCount >= 1)) return [];
  const candidates = events
    .filter((ev) => String(ev.classId || '').trim() === classId)
    .filter((ev) => {
      const date = String(ev.date || '').trim();
      if (!date || date < anchorDate) return false;
      if (mode === 'date' && date > stopDate) return false;
      const startMin = timeToMinutes(ev.start);
      return startMin >= anchorStartMin && startMin <= anchorEndMin;
    })
    .sort((a, b) => {
      const dateCmp = String(a.date).localeCompare(String(b.date));
      if (dateCmp !== 0) return dateCmp;
      return timeToMinutes(a.start) - timeToMinutes(b.start);
    });
  if (mode === 'count') return candidates.slice(0, maxCount);
  return candidates;
}

function unionIsoDateRangeFixture(current, extraStart, extraEnd) {
  const curStart = String(current?.startDate || '').trim();
  const curEnd = String(current?.endDate || '').trim();
  const extStart = String(extraStart || '').trim();
  const extEnd = String(extraEnd || '').trim();
  if (!curStart || !curEnd) {
    if (!extStart || !extEnd) return { startDate: '', endDate: '', changed: false };
    return { startDate: extStart, endDate: extEnd, changed: true };
  }
  let startDate = curStart;
  let endDate = curEnd;
  if (extStart && extStart < startDate) startDate = extStart;
  if (extEnd && extEnd > endDate) endDate = extEnd;
  const changed = startDate !== curStart || endDate !== curEnd;
  return { startDate, endDate, changed };
}

test('person schedule includes bulk select modal and saved context Select action', () => {
  const view = readPersonScheduleView();
  assert.match(view, /id="scheduleSessionBulkSelectModal"/);
  assert.match(view, /id="scheduleSessionBulkSelectStopDate"/);
  assert.match(view, /id="scheduleSessionBulkSelectCount"/);
  assert.match(view, /id="btn_scheduleSessionBulkSelectApply"/);
  assert.match(view, /id="btn_scheduleSessionContextSelect"/);
  assert.match(view, /name="scheduleSessionBulkSelectMode"/);
  assert.match(view, /scheduleSessionBulkSelectModeCount/);
  assert.match(view, /scheduleSessionBulkSelectModeDate/);
});

test('draft context menu includes bulk Select action', () => {
  const draftMenu = readPackageFile('MVC/views/school/partials/scheduleDraftSessionContextMenu.ejs');
  assert.match(draftMenu, /id="btn_scheduleDraftContextSelect"/);
});

test('master schedule viewer wires bulk select helpers and staging dep', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /function collectMatchingSessionsForBulkSelect/);
  assert.match(source, /function applyBulkSessionSelection/);
  assert.match(source, /function openScheduleSessionBulkSelectModal/);
  assert.match(source, /openScheduleSessionBulkSelectModal/);
  assert.match(source, /btn_scheduleSessionContextSelect/);
  assert.match(source, /btn_scheduleDraftContextSelect/);
  assert.match(source, /bindScheduleSessionBulkSelectModal/);
  assert.match(source, /readBulkSelectModalSelectionMode/);
  assert.match(source, /selectionMode/);
});

test('bulk select apply expands view range without clearing selection via dedicated helpers', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /function unionIsoDateRange/);
  assert.match(source, /function dateExtentsFromEvents/);
  assert.match(source, /function ensureScheduleViewRangeForBulkSelect/);
  assert.match(source, /function reloadActiveScheduleForViewRange/);
  assert.match(source, /ensureScheduleViewRangeForBulkSelect/);
  assert.match(source, /reloadActiveScheduleForViewRange/);
  assert.match(source, /await ensureScheduleViewRangeForBulkSelect/);
  assert.doesNotMatch(source, /clearLoadedSchedules\(\)[\s\S]{0,120}ensureScheduleViewRangeForBulkSelect/);
  assert.match(source, /focusScheduleTimelineOnFirstStagedSession\(firstMatchDate\)/);
});

test('unionIsoDateRange widens start and end when extras exceed current range', () => {
  const current = { startDate: '2026-06-01', endDate: '2026-06-07' };
  const union = unionIsoDateRangeFixture(current, '2026-05-20', '2026-07-15');
  assert.equal(union.changed, true);
  assert.equal(union.startDate, '2026-05-20');
  assert.equal(union.endDate, '2026-07-15');
  const inside = unionIsoDateRangeFixture(current, '2026-06-02', '2026-06-05');
  assert.equal(inside.changed, false);
  assert.equal(inside.startDate, '2026-06-01');
  assert.equal(inside.endDate, '2026-06-07');
});

test('bulk select matching respects date range, time window, class, and count cap', () => {
  const anchor = { date: '2026-06-01', start: '09:00', end: '10:00', classId: 'C1' };
  const events = [
    { date: '2026-05-31', start: '09:15', classId: 'C1', sessionId: 'before' },
    { date: '2026-06-01', start: '08:55', classId: 'C1', sessionId: 'early' },
    { date: '2026-06-01', start: '09:15', classId: 'C1', sessionId: 'anchor-day' },
    { date: '2026-06-01', start: '09:15', classId: 'C2', sessionId: 'other-class' },
    { date: '2026-06-08', start: '09:30', classId: 'C1', sessionId: 'week2' },
    { date: '2026-06-15', start: '10:05', classId: 'C1', sessionId: 'after-window' },
    { date: '2026-07-01', start: '09:00', classId: 'C1', sessionId: 'past-stop' }
  ];
  const matches = collectMatchingSessionsFixture(anchor, events, {
    selectionMode: 'date',
    stopDate: '2026-06-30',
    maxCount: 0
  });
  const ids = matches.map((ev) => ev.sessionId);
  assert.deepEqual(ids, ['anchor-day', 'week2']);
});

test('bulk select matching includes anchor first and honors maxCount', () => {
  const anchor = { date: '2026-06-01', start: '09:00', end: '10:00', classId: 'C1' };
  const events = [
    { date: '2026-06-01', start: '09:00', classId: 'C1', sessionId: 'a' },
    { date: '2026-06-02', start: '09:30', classId: 'C1', sessionId: 'b' },
    { date: '2026-06-03', start: '09:45', classId: 'C1', sessionId: 'c' }
  ];
  const matches = collectMatchingSessionsFixture(anchor, events, {
    selectionMode: 'count',
    maxCount: 2
  });
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((ev) => ev.sessionId), ['a', 'b']);
});
