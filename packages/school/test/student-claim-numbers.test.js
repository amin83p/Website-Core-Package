const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const studentModel = require('../MVC/models/school/studentModel');
const studentClaimNumberService = require('../MVC/services/school/studentClaimNumberService');

const ROOT = path.resolve(__dirname, '..', '..', '..');
function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('student model sanitizes claimNumbers with required number and primary flag', () => {
  const cleaned = studentModel.cleanClaimNumbers([
    { id: 'claim_1', number: ' WCB-123 ', label: 'Primary WCB', notes: 'note', isPrimary: true },
    { number: 'CLM-2', isPrimary: false }
  ]);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].number, 'WCB-123');
  assert.equal(cleaned[0].label, 'Primary WCB');
  assert.equal(cleaned[0].isPrimary, true);
  assert.equal(cleaned[1].number, 'CLM-2');
  assert.equal(cleaned[1].isPrimary, false);
});

test('student model rejects claimNumbers without number', () => {
  assert.throws(() => studentModel.cleanClaimNumbers([{ number: '' }]), /requires a number/i);
});

test('student routes expose claim-numbers API endpoints', () => {
  const routes = read('packages/school/MVC/routes/studentRoutes.js');
  assert.match(routes, /router\.get\('\/api\/:id\/claim-numbers'/);
  assert.match(routes, /ctrl\.getStudentClaimNumbersApi/);
  assert.match(routes, /router\.put\('\/api\/:id\/claim-numbers'/);
  assert.match(routes, /ctrl\.putStudentClaimNumbersApi/);
});

test('student controller resolves legacy studentIdAtFunder when claimNumbers empty', () => {
  const controller = read('packages/school/MVC/controllers/school/studentController.js');
  assert.match(controller, /function resolveClaimNumbersForApi\(/);
  assert.match(controller, /studentIdAtFunder/);
  assert.match(controller, /exports\.getStudentClaimNumbersApi/);
  assert.match(controller, /exports\.putStudentClaimNumbersApi/);
  assert.match(controller, /findClaimUsagesForStudent/);
  assert.match(controller, /backfillClaimNumberIdsForStudent/);
});

test('class enrollment period model sanitizes claimNumberId', () => {
  const modelSource = read('packages/school/MVC/models/school/classEnrollmentPeriodModel.js');
  assert.match(modelSource, /claimNumberId:\s*cleanId\(input\.claimNumberId/);
});

test('studentClaimNumberService detects claim usage for removed claim id', async () => {
  studentClaimNumberService.__setDependenciesForTest({
    schoolRepositories: {
      classEnrollmentPeriods: {
        findByStudentId: async () => ([
          {
            id: 'period_1',
            classId: 'class_1',
            studentId: 'student_1',
            claimNumberId: 'claim_1',
            claimNumber: 'WCB-9',
            status: 'active',
            startDate: '2026-01-01',
            endDate: ''
          }
        ])
      }
    },
    schoolDataService: {
      getDataById: async (_type, id) => {
        if (id === 'class_1') return { id: 'class_1', title: 'Math 101' };
        return null;
      }
    }
  });
  const blockers = await studentClaimNumberService.findClaimUsagesForStudent({
    studentId: 'student_1',
    removedClaims: [{ id: 'claim_1', number: 'WCB-9', label: 'Primary' }],
    reqUser: {}
  });
  studentClaimNumberService.__resetDependenciesForTest();
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].code, 'CLAIM_NUMBER_IN_USE');
  assert.equal(blockers[0].usages.length, 1);
  assert.equal(blockers[0].usages[0].classTitle, 'Math 101');
});

test('studentClaimNumberService backfills claimNumberId from legacy claim number', async () => {
  const updates = [];
  studentClaimNumberService.__setDependenciesForTest({
    schoolRepositories: {
      classEnrollmentPeriods: {
        findByStudentId: async () => ([
          { id: 'period_2', claimNumber: 'CLM-44', claimNumberId: '' }
        ]),
        update: async (periodId, patch) => {
          updates.push({ periodId, patch });
          return { id: periodId, ...patch };
        }
      }
    },
    schoolDataService: {
      getDataById: async () => ({
        id: 'student_2',
        claimNumbers: [{ id: 'claim_x', number: 'CLM-44', isPrimary: true }]
      })
    }
  });
  const result = await studentClaimNumberService.backfillClaimNumberIdsForStudent('student_2', {});
  studentClaimNumberService.__resetDependenciesForTest();
  assert.equal(result.updated, 1);
  assert.equal(updates[0].patch.claimNumberId, 'claim_x');
});

test('student form and rolling enrollment use shared claim UI and claimNumberId payloads', () => {
  const studentForm = read('packages/school/MVC/views/school/student/studentForm.ejs');
  const rolling = read('packages/school/MVC/views/school/class/rollingEnrollment.ejs');
  const manager = read('public/scripts/studentClaimNumbersManager.js');
  assert.match(studentForm, /studentClaimNumbersModal/);
  assert.match(studentForm, /studentClaimNumbersManager\.js/);
  assert.match(studentForm, /btnManageStudentClaimNumbers/);
  assert.match(studentForm, /hid_claimNumbers/);
  assert.match(studentForm, /persistMode:\s*isDraftStudent\s*\?\s*'local'\s*:\s*'api'/);
  assert.match(manager, /persistMode === 'local'/);
  assert.match(rolling, /studentClaimNumbersManager\.js/);
  assert.match(rolling, /readEnrollmentClaimPayload/);
  assert.match(rolling, /claimNumberId/);
  assert.match(manager, /htmlEscape\(id\)/);
});

test('school message UI wraps global showMessageModal', () => {
  const ui = read('public/scripts/schoolMessageUi.js');
  assert.match(ui, /showMessageModal/);
  assert.match(ui, /SchoolMessageUi/);
  assert.match(read('packages/school/MVC/views/school/student/studentForm.ejs'), /schoolMessageUi\.js/);
});
