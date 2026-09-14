const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSessionCalendarCore() {
  const scriptPath = path.join(__dirname, '../public/scripts/sessionCalendarCore.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.SessionCalendarCore;
}

test('formatHours is exported for enrollment calendar modal', () => {
  const core = loadSessionCalendarCore();
  assert.equal(typeof core.formatHours, 'function');
  assert.equal(core.formatHours(1), '1 Hr');
  assert.equal(core.formatHours(2), '2 Hrs');
});

test('buildWeekBlocks pads partial weeks with inRange flags', () => {
  const core = loadSessionCalendarCore();
  const blocks = core.buildWeekBlocks({ startDate: '2026-01-13', endDate: '2026-01-16' });
  assert.equal(blocks.length, 1);
  const week = blocks[0];
  assert.equal(week.days.length, 7);
  assert.equal(week.days[0].inRange, false);
  assert.equal(week.days[1].date, '2026-01-13');
  assert.equal(week.days[1].inRange, true);
  assert.equal(week.days[4].inRange, true);
});

test('filterWeekDaysForDisplay keeps out-of-range padding when hiding empty days', () => {
  const core = loadSessionCalendarCore();
  const days = [
    { date: '2026-01-12', inRange: false },
    { date: '2026-01-13', inRange: true },
    { date: '2026-01-14', inRange: true },
    { date: '2026-01-15', inRange: true }
  ];
  const eventsByDate = {
    '2026-01-13': [{ sessionId: 'A' }],
    '2026-01-14': [],
    '2026-01-15': [{ sessionId: 'B' }]
  };
  const filtered = core.filterWeekDaysForDisplay(days, eventsByDate, true);
  assert.deepEqual(filtered.map((row) => row.date), ['2026-01-12', '2026-01-13', '2026-01-15']);
});

test('formatWeekLabelHtml includes month week, ISO week, and date range', () => {
  const core = loadSessionCalendarCore();
  const text = core.formatWeekLabel('2026-08-17', '2026-08-23');
  assert.match(text, /August Week Three/);
  assert.match(text, /Year Week 34/);
  assert.match(text, /2026-08-17 – 2026-08-23/);
  const html = core.formatWeekLabelHtml('2026-08-17', '2026-08-23');
  assert.match(html, /session-cal-week-label-primary/);
  assert.match(html, /session-cal-week-label-year/);
  assert.match(html, /session-cal-week-label-dates/);
});

test('formatClockTimeRange uses compact same-period range labels', () => {
  const core = loadSessionCalendarCore();
  assert.equal(core.formatClockTimeRange('09:00', '10:30'), '9 – 10:30 AM');
  assert.equal(core.formatClockTimeRange('11:30', '13:00'), '11:30 AM – 1 PM');
  assert.match(core.formatDayHeaderHtml('2026-08-17', 'vertical'), /session-cal-day-header-weekday/);
});

test('renderVerticalWeekGrid gives solo sessions full width when other overlaps exist same day', () => {
  const core = loadSessionCalendarCore();
  const container = {
    style: { setProperty() {} },
    dataset: {},
    innerHTML: ''
  };
  const eventsByDate = {
    '2026-09-08': [
      { sessionId: 'OVERLAP_A', date: '2026-09-08', start: '09:00', end: '10:00' },
      { sessionId: 'OVERLAP_B', date: '2026-09-08', start: '09:00', end: '12:00' },
      { sessionId: 'SOLO_C', date: '2026-09-08', start: '12:30', end: '15:30' }
    ]
  };
  const ok = core.renderVerticalWeekGrid(eventsByDate, container, null, {
    viewRange: { startDate: '2026-09-08', endDate: '2026-09-08' },
    dayWidth: 200,
    enableTimeHover: false,
    buildPositionedBlockHtml: (ev) => `<span data-test-session="${ev.sessionId}"></span>`
  });
  assert.equal(ok, true);
  const positionedChunks = container.innerHTML.split('session-cal-positioned-vertical').slice(1);
  const overlapA = positionedChunks.find((chunk) => chunk.includes('data-test-session="OVERLAP_A"'));
  const overlapB = positionedChunks.find((chunk) => chunk.includes('data-test-session="OVERLAP_B"'));
  const soloC = positionedChunks.find((chunk) => chunk.includes('data-test-session="SOLO_C"'));
  assert.ok(overlapA);
  assert.ok(overlapB);
  assert.ok(soloC);
  assert.match(overlapA, /width:calc\(50% - 4px\)/);
  assert.match(overlapB, /width:calc\(50% - 4px\)/);
  assert.match(soloC, /width:calc\(100% - 4px\)/);
});

test('renderVerticalWeekGrid uses custom block builder callback', () => {
  const core = loadSessionCalendarCore();
  const container = {
    style: { setProperty() {} },
    dataset: {},
    innerHTML: ''
  };
  const eventsByDate = {
    '2026-01-15': [{ sessionId: 'SES_1', date: '2026-01-15', start: '09:00', end: '10:00' }]
  };
  let builderCalled = false;
  const ok = core.renderVerticalWeekGrid(eventsByDate, container, null, {
    viewRange: { startDate: '2026-01-15', endDate: '2026-01-15' },
    dayWidth: 200,
    enableTimeHover: false,
    buildPositionedBlockHtml: (ev) => {
      builderCalled = true;
      return `<span data-test-session="${ev.sessionId}">custom</span>`;
    }
  });
  assert.equal(ok, true);
  assert.equal(builderCalled, true);
  assert.match(container.innerHTML, /data-test-session="SES_1"/);
  assert.match(container.innerHTML, /session-cal-time-gutter/);
});
