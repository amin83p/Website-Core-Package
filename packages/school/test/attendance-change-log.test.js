const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const attendanceChangeLogService = require('../MVC/services/school/attendanceChangeLogService');
const attendanceChangeLogModel = require('../MVC/models/school/attendanceChangeLogModel');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('normalizeLoggedStatus treats empty as unmarked', () => {
  assert.equal(attendanceChangeLogService.normalizeLoggedStatus(''), '');
  assert.equal(attendanceChangeLogService.normalizeLoggedStatus(null), '');
  assert.equal(attendanceChangeLogService.normalizeLoggedStatus('present'), 'present');
});

test('diffRosterAttendanceStatusChanges detects status changes only', () => {
  const before = [{ personId: '101', attendance: '' }, { personId: '102', attendance: 'present' }];
  const after = [{ personId: '101', attendance: 'present' }, { personId: '102', attendance: 'present' }];
  const changes = attendanceChangeLogService.diffRosterAttendanceStatusChanges(before, after);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], { personId: '101', fromStatus: '', toStatus: 'present' });

  const noOp = attendanceChangeLogService.diffRosterAttendanceStatusChanges(after, after);
  assert.equal(noOp.length, 0);
});

test('diffRosterAttendanceStatusChanges handles present to absent', () => {
  const before = [{ personId: '55', attendance: 'present' }];
  const after = [{ personId: '55', attendance: 'absent' }];
  const changes = attendanceChangeLogService.diffRosterAttendanceStatusChanges(before, after);
  assert.deepEqual(changes, [{ personId: '55', fromStatus: 'present', toStatus: 'absent' }]);
});

test('appendChanges writes expected shape through repository', async () => {
  const originalCreate = require('../MVC/repositories/school').attendanceChangeLogs.create;
  const created = [];
  require('../MVC/repositories/school').attendanceChangeLogs.create = async (payload) => {
    const rows = Array.isArray(payload) ? payload : [payload];
    created.push(...rows);
    return rows;
  };

  try {
    const rows = await attendanceChangeLogService.appendChanges({
      orgId: '900000',
      classId: 'CLS-1',
      sessionId: 'SES-1',
      sessionDate: '2026-08-27',
      source: 'matrix_cell',
      changes: [{ personId: '146788', fromStatus: '', toStatus: 'present' }],
      reqUser: { id: '728610', username: 'teacher@school.ca', displayName: 'Jane Teacher' }
    });
    assert.equal(rows.length, 1);
    assert.equal(created.length, 1);
    const row = created[0];
    assert.equal(row.orgId, '900000');
    assert.equal(row.classId, 'CLS-1');
    assert.equal(row.sessionId, 'SES-1');
    assert.equal(row.sessionDate, '2026-08-27');
    assert.equal(row.studentPersonId, '146788');
    assert.equal(row.source, 'matrix_cell');
    assert.equal(row.fromStatus, '');
    assert.equal(row.toStatus, 'present');
    assert.equal(row.changedBy.userId, '728610');
    assert.equal(row.changedBy.username, 'teacher@school.ca');
    assert.equal(row.changedBy.displayName, 'Jane Teacher');
    assert.ok(row.changedAt);
  } finally {
    require('../MVC/repositories/school').attendanceChangeLogs.create = originalCreate;
  }
});

test('appendChanges skips no-op status changes', async () => {
  const originalCreate = require('../MVC/repositories/school').attendanceChangeLogs.create;
  let createCalls = 0;
  require('../MVC/repositories/school').attendanceChangeLogs.create = async () => {
    createCalls += 1;
    return [];
  };

  try {
    const rows = await attendanceChangeLogService.appendChanges({
      orgId: '900000',
      classId: 'CLS-1',
      sessionId: 'SES-1',
      sessionDate: '2026-08-27',
      source: 'session_save',
      changes: [{ personId: '1', fromStatus: 'present', toStatus: 'present' }],
      reqUser: { id: '1', username: 'u' }
    });
    assert.equal(rows.length, 0);
    assert.equal(createCalls, 0);
  } finally {
    require('../MVC/repositories/school').attendanceChangeLogs.create = originalCreate;
  }
});

test('attendance change log model sanitizes append-only payload', () => {
  const sanitized = attendanceChangeLogModel.sanitizeLogInput({
    orgId: '900000',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    sessionDate: '2026-08-27',
    studentPersonId: '146788',
    source: 'matrix_cell',
    changedBy: { userId: '728610', username: 'teacher@school.ca', displayName: 'Jane Teacher' },
    fromStatus: '',
    toStatus: 'present'
  });
  assert.equal(sanitized.source, 'matrix_cell');
  assert.equal(sanitized.fromStatus, '');
  assert.equal(sanitized.toStatus, 'present');
});

test('attendance controller wires matrix cell save to change log append', () => {
  const source = read('packages/school/MVC/controllers/school/attendanceController.js');
  assert.match(source, /attendanceChangeLogService\.appendChanges/);
  assert.match(source, /source:\s*'matrix_cell'/);
  assert.match(source, /async function getAttendanceChangeLog/);
  assert.match(source, /async function queryAttendanceChangeLogs/);
});

test('class controller wires saveSession roster save to change log append', () => {
  const source = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(source, /pendingAttendanceChangeLog/);
  assert.match(source, /attendanceChangeLogService\.diffRosterAttendanceStatusChanges/);
  assert.match(source, /source:\s*'session_save'/);
});

test('attendance routes expose change-log read endpoints', () => {
  const source = read('packages/school/MVC/routes/attendanceRoutes.js');
  assert.match(source, /router\.get\('\/api\/change-log'/);
  assert.match(source, /ctrl\.getAttendanceChangeLog/);
  assert.match(source, /router\.post\('\/api\/change-log\/query'/);
  assert.match(source, /ctrl\.queryAttendanceChangeLogs/);
});

test('attendance matrix view includes history toggle and modal', () => {
  const source = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(source, /btn_attendanceMatrixHistory/);
  assert.match(source, /attendance-history-mode-on/);
  assert.match(source, /attendanceCellHistoryModal/);
  assert.match(source, /openAttendanceCellHistory/);
  assert.match(source, /\/api\/change-log\/query/);
});
