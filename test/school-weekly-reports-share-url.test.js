const test = require('node:test');
const assert = require('node:assert/strict');

const shareUrl = require('../packages/school/public/scripts/weeklyReportsHubShareUrl');

test('stateToSearchParams omits empty fields and default sort keys', () => {
  const params = shareUrl.stateToSearchParams({
    section: 'weekly-reports',
    startDate: '2026-01-05',
    endDate: '2026-01-11',
    view: 'classes',
    viewMode: 'list'
  });
  assert.equal(params.get('section'), 'weekly-reports');
  assert.equal(params.get('startDate'), '2026-01-05');
  assert.equal(params.get('endDate'), '2026-01-11');
  assert.equal(params.get('view'), 'classes');
  assert.equal(params.get('listSort'), null);
  assert.equal(params.get('classListSort'), null);
  assert.equal(params.get('departmentId'), null);
});

test('buildWeeklyReportsShareState and searchParamsToState round-trip student tab with detail', () => {
  const filtersSnapshot = {
    startDate: '2026-02-02',
    endDate: '2026-02-08',
    departmentId: 'DEPT-1',
    programId: '',
    teacherPersonId: 'TEACH-9',
    classSelections: [{ id: 'CLS-A', name: 'Math A' }],
    studentSelections: [{ id: 'STU-1', name: 'Ada' }]
  };
  const viewState = {
    level: 'students',
    selectedClassId: 'CLS-Z',
    selectedClassName: 'Science Z',
    viewMode: 'board',
    listSort: { key: 'sessionCount', dir: 'desc' },
    classListSort: { key: 'teacherName', dir: 'asc' },
    studentDetailId: 'STU-42',
    studentDetailName: 'Grace'
  };
  const tab = { type: 'students', classId: 'CLS-Z', className: 'Science Z' };
  const built = shareUrl.buildWeeklyReportsShareState({
    filtersSnapshot: filtersSnapshot,
    viewState: viewState,
    tab: tab
  });
  const params = shareUrl.stateToSearchParams(built);
  const restored = shareUrl.searchParamsToState(params);

  assert.equal(restored.section, 'weekly-reports');
  assert.equal(restored.filtersSnapshot.startDate, '2026-02-02');
  assert.equal(restored.filtersSnapshot.departmentId, 'DEPT-1');
  assert.equal(restored.filtersSnapshot.classSelections.length, 1);
  assert.equal(restored.filtersSnapshot.classSelections[0].id, 'CLS-A');
  assert.equal(restored.filtersSnapshot.studentSelections[0].id, 'STU-1');
  assert.equal(restored.tab.type, 'students');
  assert.equal(restored.tab.classId, 'CLS-Z');
  assert.equal(restored.viewState.viewMode, 'board');
  assert.equal(restored.viewState.listSort.key, 'sessionCount');
  assert.equal(restored.viewState.listSort.dir, 'desc');
  assert.equal(restored.viewState.studentDetailId, 'STU-42');
  assert.equal(restored.viewState.studentDetailName, 'Grace');
});

test('buildShareUrl produces absolute path with query', () => {
  const state = shareUrl.buildWeeklyReportsShareState({
    filtersSnapshot: { startDate: '2026-03-01', endDate: '2026-03-07' },
    viewState: { viewMode: 'list' },
    tab: { type: 'classes' }
  });
  const url = shareUrl.buildShareUrl('https://school.example', '/school/report-hub', state);
  assert.ok(url.startsWith('https://school.example/school/report-hub?'));
  assert.ok(url.includes('section=weekly-reports'));
  assert.ok(url.includes('startDate=2026-03-01'));
});
