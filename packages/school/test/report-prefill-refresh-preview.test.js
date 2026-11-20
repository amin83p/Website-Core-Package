const test = require('node:test');
const assert = require('node:assert/strict');

const reportPrefillRefreshPreviewService = require('../MVC/services/school/reportPrefillRefreshPreviewService');
const reportInstanceLivePrefillResetService = require('../MVC/services/school/reportInstanceLivePrefillResetService');
const reportIntegrityService = require('../MVC/services/school/reportIntegrityService');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const reportService = require('../MVC/services/school/reportService');

const previewTemplate = {
  id: 'TPL_PRE_1',
  version: 1,
  schema: {
    fields: [
      {
        id: 'title_field',
        label: 'Title',
        type: 'text',
        prefillKey: 'report_title',
        valueMode: 'manual'
      }
    ]
  }
};

const assignment = {
  id: 'ASG_P1',
  reportScope: 'class',
  classId: 'CLS1'
};

test('prefill preview diffs live merge ignoring renderCache', async (t) => {
  const instance = {
    id: 'RINS_PRE_1',
    studentId: '',
    teacherId: 'T1',
    status: 'draft',
    answers: {},
    prefillSnapshot: { report_title: 'Saved title' },
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' },
    renderCache: {
      templateId: 'TPL_PRE_1',
      templateVersion: 1,
      capturedAt: '2025-01-02T00:00:00.000Z',
      mergedAnswers: { title_field: 'Cached wrong' }
    }
  };

  const origBuild = reportService.buildPrefillSnapshot;
  reportService.buildPrefillSnapshot = async () => ({ report_title: 'Fresh title' });

  t.after(() => {
    reportService.buildPrefillSnapshot = origBuild;
  });

  const preview = await reportPrefillRefreshPreviewService.buildPrefillRefreshPreview({
    instance,
    template: previewTemplate,
    assignment,
    reqUser: { id: 'u1' }
  });

  assert.ok(Array.isArray(preview.changes));
  const row = preview.changes.find((c) => c.prefillKey === 'report_title');
  assert.ok(row, 'expected a change for report_title');
  const sub = row.fields[0];
  assert.equal(sub.currentValue, 'Cached wrong');
  assert.equal(sub.newValue, 'Fresh title');
});

test('prefill preview diffs frozen renderCache display vs live refreshed merge', async (t) => {
  const template = {
    id: 'TPL_PRE_2',
    version: 1,
    schema: {
      fields: [
        {
          id: 'punctuality_label',
          label: 'Punctuality',
          type: 'text',
          prefillKey: 'student_punctuality_span_label',
          valueMode: 'manual'
        }
      ]
    }
  };
  const assignment = { id: 'ASG_P2', reportScope: 'each_student', classId: 'CLS1' };
  const instance = {
    id: 'RINS_PRE_2',
    studentId: 'STU1',
    teacherId: 'T1',
    status: 'draft',
    answers: {},
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' },
    prefillSnapshot: { student_punctuality_span_label: '90% (live)' },
    renderCache: {
      templateId: 'TPL_PRE_2',
      templateVersion: 1,
      capturedAt: '2025-01-02T00:00:00.000Z',
      mergedAnswers: { punctuality_label: '80% (stale cache)' }
    }
  };

  const origBuild = reportService.buildPrefillSnapshot;
  reportService.buildPrefillSnapshot = async () => ({ student_punctuality_span_label: '90% (live)' });

  t.after(() => {
    reportService.buildPrefillSnapshot = origBuild;
  });

  const preview = await reportPrefillRefreshPreviewService.buildPrefillRefreshPreview({
    instance,
    template,
    assignment,
    reqUser: { id: 'u1' }
  });

  const row = preview.changes.find((c) => c.prefillKey === 'student_punctuality_span_label');
  assert.ok(row, 'expected display vs refreshed diff for punctuality');
  const sub = row.fields[0];
  assert.equal(sub.currentValue, '80% (stale cache)');
  assert.equal(sub.newValue, '90% (live)');
});

test('prefill preview suggests prefill-linked manual fields when answers were overridden (derivedOverrides)', async (t) => {
  const template = {
    id: 'TPL_OVR',
    version: 1,
    schema: {
      fields: [
        {
          id: 'listening',
          label: 'Listening',
          type: 'number',
          prefillKey: 'student_gradebook_skill_listening_avg_percent',
          valueMode: 'manual'
        },
        {
          id: 'speaking',
          label: 'Speaking',
          type: 'number',
          prefillKey: 'student_gradebook_skill_speaking_avg_percent',
          valueMode: 'manual'
        },
        {
          id: 'attendance',
          label: 'Attendance',
          type: 'number',
          prefillKey: 'student_attendance_span_percent',
          valueMode: 'manual'
        }
      ]
    }
  };
  const assignment = { id: 'ASG_OVR', reportScope: 'each_student', classId: 'CLS1' };
  const instance = {
    id: 'RINS_OVR',
    studentId: 'STU1',
    teacherId: 'T1',
    status: 'draft',
    answers: { listening: 10, speaking: 15, attendance: 25 },
    derivedOverrides: { listening: true, speaking: true, attendance: true },
    audit: { firstSavedAt: '2026-01-01T00:00:00.000Z' },
    renderCache: {
      templateId: 'TPL_OVR',
      templateVersion: 1,
      capturedAt: '2026-01-02T00:00:00.000Z',
      mergedAnswers: { listening: 10, speaking: 15, attendance: 25 }
    },
    prefillSnapshot: {
      student_gradebook_skill_listening_avg_percent: 0,
      student_gradebook_skill_speaking_avg_percent: 85.7,
      student_attendance_span_percent: 60.07
    }
  };

  const origBuild = reportService.buildPrefillSnapshot;
  reportService.buildPrefillSnapshot = async () => ({
    student_gradebook_skill_listening_avg_percent: 0,
    student_gradebook_skill_speaking_avg_percent: 85.7,
    student_attendance_span_percent: 60.07
  });

  t.after(() => {
    reportService.buildPrefillSnapshot = origBuild;
  });

  const preview = await reportPrefillRefreshPreviewService.buildPrefillRefreshPreview({
    instance,
    template,
    assignment,
    reqUser: { id: 'u1' }
  });

  const listen = preview.changes.find((c) => c.prefillKey === 'student_gradebook_skill_listening_avg_percent');
  const speak = preview.changes.find((c) => c.prefillKey === 'student_gradebook_skill_speaking_avg_percent');
  const attend = preview.changes.find((c) => c.prefillKey === 'student_attendance_span_percent');
  assert.ok(listen, 'listening override should appear when prefill differs from saved answer');
  assert.ok(speak, 'speaking override should appear when prefill differs from saved answer');
  assert.ok(attend, 'attendance override should appear when prefill differs from saved answer');
  assert.equal(listen.fields[0].currentValue, 10);
  assert.equal(listen.fields[0].newValue, 0);
  assert.equal(speak.fields[0].currentValue, 15);
  assert.equal(speak.fields[0].newValue, 85.7);
  assert.equal(attend.fields[0].currentValue, 25);
  assert.equal(attend.fields[0].newValue, 60.07);
});

test('prefill preview collapses each-student attendance mirror keys into one row', async (t) => {
  const template = {
    id: 'TPL_ATT_MIRROR',
    version: 1,
    snapshotKeys: ['student_attendance_span_percent', 'class_attendance_present'],
    placeholderMap: { Attendance: '{{class_attendance_present}}' },
    schema: {
      fields: [
        {
          id: 'Attendance',
          label: 'Attendance',
          type: 'number',
          prefillKey: 'student_attendance_span_percent',
          valueMode: 'manual'
        }
      ]
    }
  };
  const assignment = { id: 'ASG_MIRROR', reportScope: 'each_student', classId: 'CLS1' };
  const instance = {
    id: 'RINS_MIRROR',
    studentId: 'STU1',
    teacherId: 'T1',
    status: 'draft',
    answers: { Attendance: 25 },
    derivedOverrides: { Attendance: true },
    audit: { firstSavedAt: '2026-01-01T00:00:00.000Z' },
    renderCache: {
      templateId: 'TPL_ATT_MIRROR',
      templateVersion: 1,
      capturedAt: '2026-01-02T00:00:00.000Z',
      mergedAnswers: { Attendance: 25 }
    },
    prefillSnapshot: {
      student_attendance_span_percent: 60.07,
      class_attendance_present: 60.07
    }
  };

  const origBuild = reportService.buildPrefillSnapshot;
  reportService.buildPrefillSnapshot = async () => ({
    student_attendance_span_percent: 60.07,
    class_attendance_present: 60.07
  });

  t.after(() => {
    reportService.buildPrefillSnapshot = origBuild;
  });

  const preview = await reportPrefillRefreshPreviewService.buildPrefillRefreshPreview({
    instance,
    template,
    assignment,
    reqUser: { id: 'u1' }
  });

  const attendanceRows = preview.changes.filter((c) => (
    c.prefillKey === 'student_attendance_span_percent'
    || c.prefillKey === 'class_attendance_present'
  ));
  assert.equal(attendanceRows.length, 1);
  assert.equal(attendanceRows[0].prefillKey, 'student_attendance_span_percent');
  assert.ok((attendanceRows[0].mirrorKeys || []).includes('class_attendance_present'));
});

test('prefill preview shows punctuality when live prefill differs from manual override', async (t) => {
  const template = {
    id: 'TPL_PUNC',
    version: 1,
    schema: {
      fields: [
        {
          id: 'Punctuality',
          label: 'Punctuality For Class',
          type: 'number',
          prefillKey: 'student_punctuality_span_percent',
          valueMode: 'manual'
        }
      ]
    }
  };
  const assignment = { id: 'ASG_PUNC', reportScope: 'each_student', classId: 'CLS1' };
  const instance = {
    id: 'RINS_PUNC',
    studentId: 'STU1',
    teacherId: 'T1',
    status: 'draft',
    answers: { Punctuality: 20 },
    derivedOverrides: { Punctuality: true },
    prefillSnapshot: { student_punctuality_span_percent: 20 }
  };

  const origBuild = reportService.buildPrefillSnapshot;
  reportService.buildPrefillSnapshot = async () => ({ student_punctuality_span_percent: 0 });

  t.after(() => {
    reportService.buildPrefillSnapshot = origBuild;
  });

  const preview = await reportPrefillRefreshPreviewService.buildPrefillRefreshPreview({
    instance,
    template,
    assignment,
    reqUser: { id: 'u1' }
  });

  const row = preview.changes.find((c) => c.prefillKey === 'student_punctuality_span_percent');
  assert.ok(row, 'punctuality should appear when live prefill differs from saved answer');
  assert.equal(row.fields[0].currentValue, 20);
  assert.equal(row.fields[0].newValue, 0);
});

test('prefill preview recalculates calculated fields for refreshed side when matrix uses frozen cache', async (t) => {
  const template = {
    id: 'TPL_PRE_3',
    version: 1,
    schema: {
      fields: [
        {
          id: 'Punctuality',
          label: 'Punctuality',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: {
            enabled: true,
            expression: 'prefill.student_punctuality_span_percent',
            onError: 'keep_last'
          }
        }
      ]
    }
  };
  const assignment = { id: 'ASG_P3', reportScope: 'each_student', classId: 'CLS1' };
  const instance = {
    id: 'RINS_PRE_3',
    studentId: 'STU1',
    teacherId: 'T1',
    status: 'draft',
    answers: {},
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' },
    prefillSnapshot: { student_punctuality_span_percent: 100 },
    renderCache: {
      templateId: 'TPL_PRE_3',
      templateVersion: 1,
      capturedAt: '2025-01-02T00:00:00.000Z',
      mergedAnswers: { Punctuality: 100 }
    }
  };

  const origBuild = reportService.buildPrefillSnapshot;
  reportService.buildPrefillSnapshot = async () => ({ student_punctuality_span_percent: 75 });

  t.after(() => {
    reportService.buildPrefillSnapshot = origBuild;
  });

  const preview = await reportPrefillRefreshPreviewService.buildPrefillRefreshPreview({
    instance,
    template,
    assignment,
    reqUser: { id: 'u1' }
  });

  const row = preview.changes.find((item) => item.prefillKey === '__field__Punctuality');
  assert.ok(row, 'expected calculated punctuality diff when cache is frozen');
  assert.equal(row.expressionDriven, true);
  const sub = row.fields[0];
  assert.equal(sub.currentValue, 100);
  assert.equal(sub.newValue, 75);
});

function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Object.entries(originals).forEach(([key, value]) => {
        target[key] = value;
      });
    });
}

test('prefill preview shows semi-monthly calculated report date with ISO storage', async (t) => {
  const template = {
    id: 'TPL_PRE_DATE',
    version: 1,
    schema: {
      fields: [
        {
          id: 'report_date',
          label: 'Report Date',
          type: 'date',
          valueMode: 'calculated',
          calculationRule: {
            enabled: true,
            expression: 'formatSemiMonthlyDueDate(prefill.report_period_due_date, "dd/mm/yyyy")',
            onError: 'keep_last'
          }
        }
      ]
    }
  };
  const assignment = {
    id: 'ASG_PRE_DATE',
    reportScope: 'each_student',
    classId: 'CLS1',
    reportDueDate: '2026-10-29'
  };
  const instance = {
    id: 'RINS_PRE_DATE',
    studentId: 'STU1',
    teacherId: 'T1',
    status: 'draft',
    answers: { report_date: '2026-10-29' },
    prefillSnapshot: { report_period_due_date: '2026-10-29' },
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' },
    renderCache: {
      templateId: 'TPL_PRE_DATE',
      templateVersion: 1,
      mergedAnswers: { report_date: '2026-10-29' }
    }
  };

  const origBuild = reportService.buildPrefillSnapshot;
  reportService.buildPrefillSnapshot = async () => ({ report_period_due_date: '2026-10-29' });

  t.after(() => {
    reportService.buildPrefillSnapshot = origBuild;
  });

  const preview = await reportPrefillRefreshPreviewService.buildPrefillRefreshPreview({
    instance,
    template,
    assignment,
    reqUser: { id: 'u1' }
  });

  const row = preview.changes.find((item) => item.prefillKey === '__field__report_date');
  assert.ok(row, 'expected calculated report date drift when frozen cache holds assignment due');
  assert.equal(row.fields[0].newValue, '2026-10-31');
  assert.equal(row.fields[0].currentValue, '2026-10-29');
});

test('prefill preview detects shared calculated report_date drift on assignment sharedAnswers', async (t) => {
  const template = {
    id: 'TPL_SHARED_DATE',
    version: 1,
    schema: {
      fields: [{
        id: 'report_date',
        type: 'date',
        sharedAcrossStudents: true,
        valueMode: 'calculated',
        calculationRule: {
          enabled: true,
          expression: 'formatSemiMonthlyDueDate(prefill.report_period_due_date, "dd/mm/yyyy")',
          onError: 'keep_last'
        }
      }]
    }
  };
  const assignment = {
    id: 'ASG_SHARED_DATE',
    reportScope: 'each_student',
    classId: 'CLS1',
    reportDueDate: '2026-10-29',
    sharedAnswers: { report_date: '2026-10-29' }
  };
  const instance = {
    id: 'RINS_SHARED_DATE',
    studentId: 'STU1',
    teacherId: 'T1',
    status: 'draft',
    answers: {},
    prefillSnapshot: { report_period_due_date: '2026-10-29' },
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' }
  };

  const origBuild = reportService.buildPrefillSnapshot;
  reportService.buildPrefillSnapshot = async () => ({ report_period_due_date: '2026-10-29' });

  t.after(() => {
    reportService.buildPrefillSnapshot = origBuild;
  });

  const preview = await reportPrefillRefreshPreviewService.buildPrefillRefreshPreview({
    instance,
    template,
    assignment,
    reqUser: { id: 'u1' }
  });

  const row = preview.changes.find((item) => item.prefillKey === '__field__report_date');
  assert.ok(row, 'expected shared calculated drift vs assignment sharedAnswers');
  assert.equal(row.fields[0].newValue, '2026-10-31');
});

test('resetInstanceFromLivePrefill rejects locked instances', async () => {
  await withPatched(reportIntegrityService, {
    getEditableInstanceOrThrow: async () => {
      const error = new Error('This report is locked and cannot be edited.');
      error.statusCode = 403;
      throw error;
    }
  }, async () => {
    await assert.rejects(
      () => reportInstanceLivePrefillResetService.resetInstanceFromLivePrefill({
        instanceId: 'RINS_LOCKED',
        reqUser: { id: 'u1' }
      }),
      (err) => err.statusCode === 403
    );
  });
});

test('resetInstanceFromLivePrefill updates draft instance from live prefill merge', async () => {
  const instance = {
    id: 'RINS_RESET_1',
    templateId: 'TPL_PRE_1',
    assignmentId: 'ASG_P1',
    studentId: 'STU-1',
    teacherId: 'T1',
    status: 'draft',
    answers: { title_field: 'Stale answer' },
    prefillSnapshot: { report_title: 'Saved title' },
    audit: {}
  };
  const updates = [];
  await withPatched(reportIntegrityService, {
    getEditableInstanceOrThrow: async () => instance
  }, async () => {
    await withPatched(schoolDataService, {
      getDataById: async (entityType, id) => {
        if (entityType === 'reportTemplates') {
          return previewTemplate;
        }
        if (entityType === 'reportAssignments') {
          return assignment;
        }
        return null;
      },
      updateData: async (entityType, id, payload) => {
        updates.push({ entityType, id, payload });
        return payload;
      }
    }, async () => {
      const origBuild = reportService.buildPrefillSnapshot;
      reportService.buildPrefillSnapshot = async () => ({ report_title: 'Fresh title' });
      try {
        const result = await reportInstanceLivePrefillResetService.resetInstanceFromLivePrefill({
          instanceId: instance.id,
          reqUser: { id: 'u1' }
        });
        assert.equal(result.status, 'success');
        assert.equal(updates.length, 1);
        assert.equal(updates[0].payload.answers.title_field, 'Fresh title');
        assert.equal(updates[0].payload.prefillSnapshot.report_title, 'Fresh title');
        assert.ok(updates[0].payload.audit.prefillRefreshedAt);
      } finally {
        reportService.buildPrefillSnapshot = origBuild;
      }
    });
  });
});

test('resetInstanceFromLivePrefill refreshes private fields only on student-targeted assignments', async () => {
  const studentTemplate = {
    id: 'TPL_SHARED_1',
    version: 1,
    schema: {
      fields: [
        {
          id: 'shared_title',
          label: 'Class title',
          type: 'text',
          sharedAcrossStudents: true,
          prefillKey: 'report_title',
          valueMode: 'manual'
        },
        {
          id: 'student_hours',
          label: 'Hours',
          type: 'text',
          prefillKey: 'attendance_hours',
          valueMode: 'manual'
        }
      ]
    }
  };
  const studentAssignment = {
    id: 'ASG_STU',
    reportScope: 'each_student',
    sharedAnswers: { shared_title: 'Shared unchanged' }
  };
  const instance = {
    id: 'RINS_RESET_SHARED',
    templateId: studentTemplate.id,
    assignmentId: studentAssignment.id,
    studentId: 'STU-1',
    teacherId: 'T1',
    status: 'draft',
    answers: { student_hours: 'Old hours' },
    prefillSnapshot: { report_title: 'Old shared snapshot', attendance_hours: 'Old hours snap' },
    audit: {}
  };
  const updates = [];
  await withPatched(reportIntegrityService, {
    getEditableInstanceOrThrow: async () => instance
  }, async () => {
    await withPatched(schoolDataService, {
      getDataById: async (entityType) => {
        if (entityType === 'reportTemplates') return studentTemplate;
        if (entityType === 'reportAssignments') return studentAssignment;
        return null;
      },
      updateData: async (entityType, id, payload) => {
        updates.push({ entityType, id, payload });
        return payload;
      }
    }, async () => {
      const origBuild = reportService.buildPrefillSnapshot;
      reportService.buildPrefillSnapshot = async () => ({
        report_title: 'Fresh shared title',
        attendance_hours: 'Fresh hours'
      });
      try {
        await reportInstanceLivePrefillResetService.resetInstanceFromLivePrefill({
          instanceId: instance.id,
          reqUser: { id: 'u1' }
        });
        assert.equal(updates.length, 1);
        assert.equal(updates[0].entityType, 'reportInstances');
        assert.equal(updates[0].payload.answers.shared_title, undefined);
        assert.equal(updates[0].payload.answers.student_hours, 'Fresh hours');
        assert.equal(updates[0].payload.prefillSnapshot.report_title, 'Old shared snapshot');
        assert.equal(updates[0].payload.prefillSnapshot.attendance_hours, 'Fresh hours');
        assert.equal(studentAssignment.sharedAnswers.shared_title, 'Shared unchanged');
      } finally {
        reportService.buildPrefillSnapshot = origBuild;
      }
    });
  });
});

test('prefill preview surfaces docx-only snapshot keys without form fields', async (t) => {
  const template = {
    id: 'TPL_CLAIM',
    version: 1,
    snapshotKeys: ['enrollment_claim_number'],
    schema: { fields: [] }
  };
  const instance = {
    id: 'RINS_CLAIM',
    studentId: 'PER-1',
    teacherId: 'T1',
    status: 'draft',
    answers: {},
    prefillSnapshot: { enrollment_claim_number: '' }
  };
  const origBuild = reportService.buildPrefillSnapshot;
  reportService.buildPrefillSnapshot = async () => ({
    enrollment_claim_number: 'WCB-12345',
    student_id_at_funder: 'WCB-12345'
  });
  t.after(() => {
    reportService.buildPrefillSnapshot = origBuild;
  });
  const preview = await reportPrefillRefreshPreviewService.buildPrefillRefreshPreview({
    instance,
    template,
    assignment: { id: 'ASG_C', classId: 'CLS-1', reportStartDate: '2026-10-16', reportDueDate: '2026-10-29' },
    reqUser: { id: 'u1' }
  });
  const row = preview.changes.find((c) => c.prefillKey === 'enrollment_claim_number');
  assert.ok(row, 'expected enrollment_claim_number in preview');
  assert.equal(row.fields[0].newValue, 'WCB-12345');
});
