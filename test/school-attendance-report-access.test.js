'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const attendanceAccessService = require('../packages/school/MVC/services/school/attendanceAccessService');
const schoolAdminAccessService = require('../packages/school/MVC/services/school/schoolAdminAccessService');

describe('student attendance report access', () => {
  it('grants generate and export to super admin without scopeId on evaluations', async () => {
    const original = schoolAdminAccessService.isSuperAdmin;
    schoolAdminAccessService.isSuperAdmin = () => true;
    try {
      const access = await attendanceAccessService.buildAttendanceReportAccess(
        { id: 'TEST_SUPER', activeOrgId: 'org_test' },
        '127.0.0.1'
      );
      assert.equal(access.canOpenReport, true);
      assert.equal(access.canGenerateReport, true);
      assert.equal(access.canExportReport, true);
    } finally {
      schoolAdminAccessService.isSuperAdmin = original;
    }
  });

  it('attendanceOperationPolicyService source documents SAR Family A admin bypass', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../packages/school/MVC/services/school/attendanceOperationPolicyService.js'),
      'utf8'
    );
    assert.match(source, /SCHOOL_ATTENDANCE_REPORT/);
    assert.match(source, /isAdminForRequestAsync/);
  });

  it('selected_students ephemeral rows require targetStudentIds on target row', () => {
    const reportAssignmentModel = require('../packages/school/MVC/models/school/reportAssignmentModel');
    const base = {
      orgId: 'org_test',
      classId: 'class_test',
      templateId: 'tpl_test',
      reportScope: 'selected_students',
      targetStudentIds: ['student_person_1'],
      teacherIds: ['teacher_1'],
      targetRows: [{
        targetType: 'date',
        sessionDate: '2026-01-01',
        dueDate: '2026-01-01',
        reportStartDate: '2026-01-01',
        reportDueDate: '2026-01-31',
        taskStartTime: '09:00',
        taskEndTime: '10:00',
        teacherId: 'teacher_1',
        status: 'active',
        targetStudentIds: ['student_person_1']
      }]
    };
    assert.doesNotThrow(() => reportAssignmentModel.sanitizeAssignment(base));
    const withoutRowStudents = { ...base, targetRows: [{ ...base.targetRows[0], targetStudentIds: undefined }] };
    assert.throws(
      () => reportAssignmentModel.sanitizeAssignment(withoutRowStudents),
      /Select at least one student for each target row/
    );
  });
});
