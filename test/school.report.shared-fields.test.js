/**
 * Report "shared across students" merge and partition (each_student scope).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PizZip = require('pizzip');

const reportService = require('../packages/school/MVC/services/school/reportService');
const reportDocxRenderService = require('../packages/school/MVC/services/school/reportDocxRenderService');
const { normalizePrefillKey } = require('../packages/school/MVC/services/school/reportPrefillKeyUtils');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolIdentityLookupService = require('../packages/school/MVC/services/school/schoolIdentityLookupService');
const sessionStatusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');
const attendanceMatrixPolicyModel = require('../packages/school/MVC/models/school/attendanceMatrixPolicyModel');
const classEnrollmentReadService = require('../packages/school/MVC/services/school/classEnrollmentReadService');
const { requireCoreModule } = require('../packages/school/MVC/services/school/schoolCoreContracts');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');
const uploadPathUtils = requireCoreModule('MVC/utils/uploadPathUtils');

const ROOT = path.resolve(__dirname, '..');
function createMinimalDocxBuffer(documentBodyXml) {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${documentBodyXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

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

test('mergeTemplateData uses assignment.sharedAnswers for shared fields when each_student', () => {
  const template = {
    schema: {
      fields: [
        { id: 'common', type: 'text', sharedAcrossStudents: true },
        { id: 'per', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const instance = {
    answers: { per: 'p1' },
    prefillSnapshot: {}
  };
  const assignment = {
    reportScope: 'each_student',
    sharedAnswers: { common: 'ALL' }
  };
  const merged = reportService.mergeTemplateData(template, instance, assignment);
  assert.equal(merged.common, 'ALL');
  assert.equal(merged.per, 'p1');
});

test('mergeTemplateData prefers prefill snapshot for readOnly fields with prefillKey', () => {
  const template = {
    schema: {
      fields: [
        { id: 'ro', type: 'text', readOnly: true, prefillKey: 'teacher_name' }
      ]
    }
  };
  const instance = {
    answers: { ro: 'stale from old save' },
    prefillSnapshot: { teacher_name: 'Ms. Smith' }
  };
  const merged = reportService.mergeTemplateData(template, instance, null);
  assert.equal(merged.ro, 'Ms. Smith');
});

test('mergeTemplateData resolves brace-wrapped prefill keys and preserves zero values', () => {
  const template = {
    schema: {
      fields: [
        { id: 'Attendance', type: 'number', prefillKey: '{{class_attendance_present}}' },
        { id: 'RawAttendance', type: 'number', prefillKey: 'class_attendance_present' }
      ]
    }
  };
  const instance = {
    answers: {},
    prefillSnapshot: { class_attendance_present: 0 }
  };
  const merged = reportService.mergeTemplateData(template, instance, null);
  assert.equal(merged.Attendance, 0);
  assert.equal(merged.RawAttendance, 0);
});

test('DOCX placeholder payload exposes all prefill catalog keys directly', () => {
  const catalogKeys = Object.values(reportService.getPrefillCatalog())
    .flat()
    .map((item) => item.key);
  const prefillSnapshot = {};
  catalogKeys.forEach((key) => {
    prefillSnapshot[key] = `value:${key}`;
  });

  const payload = reportService.buildPlaceholderPayloadDetailed(
    { schema: { fields: [] }, placeholderMap: {} },
    { answers: {}, prefillSnapshot },
    null
  );

  catalogKeys.forEach((key) => {
    assert.equal(payload.placeholders[`{{${key}}}`], `value:${key}`);
  });
});

test('mapped DOCX placeholders override direct prefill catalog placeholders', () => {
  const template = {
    schema: {
      fields: [
        { id: 'student_first_name_field', type: 'text' }
      ]
    },
    placeholderMap: {
      student_first_name_field: '{{student_first_name}}'
    }
  };
  const payload = reportService.buildPlaceholderPayloadDetailed(
    template,
    {
      answers: { student_first_name_field: 'Mapped Name' },
      prefillSnapshot: { student_first_name: 'Prefill Name' }
    },
    null
  );

  assert.equal(payload.placeholders['{{student_first_name}}'], 'Mapped Name');
});

test('DOCX render data normalizes braced and bare keys and blanks missing values', () => {
  const renderData = reportDocxRenderService.buildRenderData({
    '{{student_first_name}}': 'Ada',
    student_last_name: null,
    '{{student_middle_name}}': undefined
  });
  const renderServiceSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/services/school/reportDocxRenderService.js'),
    'utf8'
  );

  assert.equal(renderData.student_first_name, 'Ada');
  assert.equal(renderData.student_last_name, '');
  assert.equal(renderData.student_middle_name, '');
  assert.match(renderServiceSource, /nullGetter:\s*\(\)\s*=>\s*''/);
});

test('DOCX render data preserves repeat collection rows beside flat placeholders', () => {
  const renderData = reportDocxRenderService.buildRenderData(
    { '{{teacher_name}}': 'Teacher One' },
    {
      students: [
        { student_full_name: 'Ada Lovelace', student_attendance_span_percent: 100 },
        { '{{student_full_name}}': 'Grace Hopper', student_attendance_span_percent: null }
      ]
    }
  );

  assert.equal(renderData.teacher_name, 'Teacher One');
  assert.deepEqual(renderData.students, [
    { student_full_name: 'Ada Lovelace', student_attendance_span_percent: '100' },
    { student_full_name: 'Grace Hopper', student_attendance_span_percent: '' }
  ]);
});

test('DOCX renderer expands repeat collection data', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-report-docx-'));
  const filePath = path.join(tmpDir, 'repeat.docx');
  fs.writeFileSync(filePath, createMinimalDocxBuffer('<w:p><w:r><w:t>{{#students}}{{student_full_name}}={{student_attendance_span_percent}};{{/students}}</w:t></w:r></w:p>'));

  try {
    const rendered = await reportDocxRenderService.renderReportInstanceDocx({
      template: { id: 'TPL-REPEAT', title: 'Repeat Template', docxTemplate: { path: filePath } },
      instance: { id: 'INST-REPEAT' },
      placeholders: { '{{class_name}}': 'Dynamic Class' },
      collections: {
        students: [
          { student_full_name: 'Ada Lovelace', student_attendance_span_percent: 100 },
          { student_full_name: 'Grace Hopper', student_attendance_span_percent: 75 }
        ]
      }
    });
    const zip = new PizZip(rendered.buffer);
    const xml = zip.file('word/document.xml').asText();
    assert.match(xml, /Ada Lovelace=100;/);
    assert.match(xml, /Grace Hopper=75;/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
test('DOCX template resolver treats /app/uploads paths as upload storage references', () => {
  const storedPath = '/app/uploads/ORG_900000/reports/Semi-Monthly-Report_1783055912591.docx';
  const railwayVolumeRoot = '/app/uploads';
  const expectedVolumeDiskPath = path
    .resolve(railwayVolumeRoot, 'ORG_900000/reports/Semi-Monthly-Report_1783055912591.docx')
    .replace(/\\/g, '/');

  assert.equal(uploadPathUtils.extractRelativeUploadPath(storedPath), 'ORG_900000/reports/Semi-Monthly-Report_1783055912591.docx');
  assert.equal(
    uploadPathUtils.fromUploadsUrlToDiskPath(storedPath, railwayVolumeRoot).replace(/\\/g, '/'),
    expectedVolumeDiskPath
  );
  assert.equal(
    uploadPathUtils.fromDiskPathToUploadsUrl(storedPath, railwayVolumeRoot),
    '/uploads/ORG_900000/reports/Semi-Monthly-Report_1783055912591.docx'
  );
  assert.equal(fileAssetStorage.isUploadReference(storedPath), true);
  assert.equal(
    reportDocxRenderService.resolveTemplateFilePath({ path: storedPath }),
    '/uploads/ORG_900000/reports/Semi-Monthly-Report_1783055912591.docx'
  );
});

test('report prefill key normalization removes template braces', () => {
  assert.equal(normalizePrefillKey('{{class_attendance_present}}'), 'class_attendance_present');
  assert.equal(normalizePrefillKey('{{ class_attendance_present }}'), 'class_attendance_present');
  assert.equal(normalizePrefillKey('class_attendance_present'), 'class_attendance_present');
});

test('report template prefill key validation rejects values outside the catalog', () => {
  const invalid = reportService.validateTemplatePrefillKeys({
    fields: [
      { id: 'ok', label: 'OK', type: 'number', prefillKey: '{{class_attendance_present}}' },
      { id: 'blank', label: 'Blank', type: 'number', prefillKey: '' },
      { id: 'bad', label: 'Bad Default', type: 'number', prefillKey: '50' },
      { id: 'section', label: 'Section', type: 'section', prefillKey: '50' }
    ]
  });

  assert.deepEqual(invalid, [
    { fieldId: 'bad', label: 'Bad Default', prefillKey: '50' }
  ]);
});

test('report template save and instance hydration use normalized prefill keys', () => {
  const templateModelSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/models/school/reportTemplateModel.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/reportController.js'), 'utf8');
  assert.match(templateModelSource, /normalizePrefillKey\(cleanString\(rawField\.prefillKey/);
  assert.match(controllerSource, /getPrefillValue\(prefill,\s*field\?\.prefillKey\)/);
  assert.match(controllerSource, /const rawPrefill = resolvedPrefill\.value/);
});

test('buildPrefillSnapshot uses attendance matrix percent and counts missing marks as absent', async () => {
  const assignment = {
    id: 'ASN-1',
    orgId: '900000',
    classId: 'CLASS-1',
    sessionId: 'SES-3',
    sessionDate: '2026-06-18',
    reportStartDate: '2026-06-16',
    reportDueDate: '2026-06-18',
    teacherIds: ['TEACHER-1']
  };
  const sessions = [
    { sessionId: 'SES-1', date: '2026-06-16', status: 'completed', startTime: '09:00', endTime: '10:00', roster: [{ personId: 'STUDENT-PERSON-1', attendance: 'present' }] },
    { sessionId: 'SES-2', date: '2026-06-17', status: 'completed', startTime: '09:00', endTime: '10:00', roster: [{ personId: 'STUDENT-PERSON-1', attendance: 'late', lateMinutes: 15 }] },
    { sessionId: 'SES-3', date: '2026-06-18', status: 'scheduled', startTime: '09:00', endTime: '10:00', roster: [] }
  ];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-1') return { id: 'CLASS-1', orgId: '900000', title: 'Class One' };
      return null;
    },
    getClassSessions: async () => sessions,
    fetchData: async (entityType) => {
      if (entityType === 'students') return [{ id: 'STU-1', orgId: '900000', personId: 'STUDENT-PERSON-1' }];
      if (entityType === 'examAssignments') return [];
      return [];
    }
  }, async () => {
    await withPatched(dataServiceGlobal, {
      fetchData: async (entityType) => {
        if (entityType === 'persons') {
          return [
            { id: 'TEACHER-1', name: { preferred: 'Teacher One' } },
            { id: 'STUDENT-PERSON-1', name: { first: 'Student', last: 'One' } }
          ];
        }
        if (entityType === 'organizations') return [{ id: '900000', name: 'Org One' }];
        return [];
      }
    }, async () => {
      await withPatched(sessionStatusPolicyService, {
        getStatusMap: async () => new Map()
      }, async () => {
        await withPatched(attendanceMatrixPolicyModel, {
          getPolicyForOrg: async () => ({
            scheduledMinutes: 60,
            disqualifyLateMinutes: 30,
            disqualifyEarlyLeaveMinutes: 30,
            disqualifyCombinedMissedMinutes: null
          })
        }, async () => {
          const snapshot = await reportService.buildPrefillSnapshot({
            assignment,
            teacherId: 'TEACHER-1',
            studentId: 'STUDENT-PERSON-1',
            reqUser: { id: 'USER-1', activeOrgId: '900000' }
          });

          assert.equal(snapshot.class_attendance_total, 3);
          assert.equal(snapshot.class_attendance_present, 58.33);
          assert.equal(snapshot.class_attendance_absent, 1);
          assert.equal(snapshot.student_attendance_span_total_sessions, 3);
          assert.equal(snapshot.student_attendance_span_present, 1);
          assert.equal(snapshot.student_attendance_span_late, 1);
          assert.equal(snapshot.student_attendance_span_absent, 1);
          assert.equal(snapshot.student_attendance_span_percent, 58.33);
        });
      });
    });
  });
});


test('buildPrefillSnapshot excludes N/A attendance from percentage denominators', async () => {
  const assignment = {
    id: 'ASN-NA',
    orgId: '900000',
    classId: 'CLASS-NA',
    sessionId: 'SES-3',
    sessionDate: '2026-06-18',
    reportStartDate: '2026-06-16',
    reportDueDate: '2026-06-18',
    teacherIds: ['TEACHER-1']
  };
  const sessions = [
    { sessionId: 'SES-1', date: '2026-06-16', status: 'completed', startTime: '09:00', endTime: '10:00', roster: [{ personId: 'STUDENT-PERSON-1', attendance: 'present' }] },
    { sessionId: 'SES-2', date: '2026-06-17', status: 'completed', startTime: '09:00', endTime: '10:00', roster: [{ personId: 'STUDENT-PERSON-1', attendance: 'absent' }] },
    { sessionId: 'SES-3', date: '2026-06-18', status: 'completed', startTime: '09:00', endTime: '10:00', roster: [{ personId: 'STUDENT-PERSON-1', attendance: 'not_applicable' }] }
  ];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-NA') return { id: 'CLASS-NA', orgId: '900000', title: 'Class N/A' };
      return null;
    },
    getClassSessions: async () => sessions,
    fetchData: async (entityType) => {
      if (entityType === 'students') return [{ id: 'STU-1', orgId: '900000', personId: 'STUDENT-PERSON-1' }];
      if (entityType === 'examAssignments') return [];
      return [];
    }
  }, async () => {
    await withPatched(dataServiceGlobal, {
      fetchData: async (entityType) => {
        if (entityType === 'persons') {
          return [
            { id: 'TEACHER-1', name: { preferred: 'Teacher One' } },
            { id: 'STUDENT-PERSON-1', name: { first: 'Student', last: 'One' } }
          ];
        }
        if (entityType === 'organizations') return [{ id: '900000', name: 'Org One' }];
        return [];
      }
    }, async () => {
      await withPatched(sessionStatusPolicyService, {
        getStatusMap: async () => new Map()
      }, async () => {
        await withPatched(attendanceMatrixPolicyModel, {
          getPolicyForOrg: async () => ({
            scheduledMinutes: 60,
            disqualifyLateMinutes: 30,
            disqualifyEarlyLeaveMinutes: 30,
            disqualifyCombinedMissedMinutes: null
          })
        }, async () => {
          const snapshot = await reportService.buildPrefillSnapshot({
            assignment,
            teacherId: 'TEACHER-1',
            studentId: 'STUDENT-PERSON-1',
            reqUser: { id: 'USER-1', activeOrgId: '900000' }
          });

          assert.equal(snapshot.student_attendance_span_total_sessions, 2);
          assert.equal(snapshot.student_attendance_span_absent, 1);
          assert.equal(snapshot.student_attendance_span_na, 1);
          assert.equal(snapshot.student_attendance_span_percent, 50);
          assert.equal(snapshot.class_attendance_na, 1);
          assert.equal(snapshot.class_attendance_span_total, 2);
          assert.equal(snapshot.class_attendance_span_na, 1);
          assert.equal(snapshot.class_attendance_span_percent, 50);
        });
      });
    });
  });
});

test('buildPrefillSnapshot derives make-up-required sessions as N/A without counting saved marks', async () => {
  const assignment = {
    id: 'ASN-MAKEUP-NA',
    orgId: '900000',
    classId: 'CLASS-MAKEUP-NA',
    sessionId: 'SES-MAKEUP',
    sessionDate: '2026-06-17',
    reportStartDate: '2026-06-16',
    reportDueDate: '2026-06-17',
    teacherIds: ['TEACHER-1']
  };
  const sessions = [
    { sessionId: 'SES-1', date: '2026-06-16', status: 'completed', startTime: '09:00', endTime: '10:00', roster: [{ personId: 'STUDENT-PERSON-1', attendance: 'present' }] },
    { sessionId: 'SES-MAKEUP', date: '2026-06-17', status: 'missed_informed24', startTime: '09:00', endTime: '10:00', roster: [{ personId: 'STUDENT-PERSON-1', attendance: 'present' }] }
  ];
  const statusMap = new Map([
    ['completed', { code: 'completed', isFinal: true, makeUpRequired: false, excludeFromAttendance: false }],
    ['missed_informed24', { code: 'missed_informed24', isFinal: true, makeUpRequired: true, excludeFromAttendance: true }]
  ]);

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-MAKEUP-NA') return { id: 'CLASS-MAKEUP-NA', orgId: '900000', title: 'Make-up N/A Class' };
      return null;
    },
    getClassSessions: async () => sessions,
    fetchData: async (entityType) => {
      if (entityType === 'students') return [{ id: 'STU-1', orgId: '900000', personId: 'STUDENT-PERSON-1' }];
      if (entityType === 'examAssignments') return [];
      return [];
    }
  }, async () => {
    await withPatched(dataServiceGlobal, {
      fetchData: async (entityType) => {
        if (entityType === 'persons') {
          return [
            { id: 'TEACHER-1', name: { preferred: 'Teacher One' } },
            { id: 'STUDENT-PERSON-1', name: { first: 'Student', last: 'One' } }
          ];
        }
        if (entityType === 'organizations') return [{ id: '900000', name: 'Org One' }];
        return [];
      }
    }, async () => {
      await withPatched(sessionStatusPolicyService, {
        getStatusMap: async () => statusMap
      }, async () => {
        await withPatched(attendanceMatrixPolicyModel, {
          getPolicyForOrg: async () => ({
            scheduledMinutes: 60,
            disqualifyLateMinutes: 30,
            disqualifyEarlyLeaveMinutes: 30,
            disqualifyCombinedMissedMinutes: null
          })
        }, async () => {
          const snapshot = await reportService.buildPrefillSnapshot({
            assignment,
            teacherId: 'TEACHER-1',
            studentId: 'STUDENT-PERSON-1',
            reqUser: { id: 'USER-1', activeOrgId: '900000' }
          });

          assert.equal(snapshot.student_attendance_span_total_sessions, 1);
          assert.equal(snapshot.student_attendance_span_present, 1);
          assert.equal(snapshot.student_attendance_span_na, 1);
          assert.equal(snapshot.student_attendance_span_percent, 100);
          assert.equal(snapshot.class_attendance_span_total, 1);
          assert.equal(snapshot.class_attendance_span_na, 1);
          assert.equal(snapshot.class_attendance_span_percent, 100);
        });
      });
    });
  });
});
test('buildReportDocxCollections builds students, sessions, and N/A-aware attendance rows', async () => {
  const assignment = {
    id: 'ASN-COLLECTIONS',
    orgId: '900000',
    classId: 'CLASS-COLLECTIONS',
    reportScope: 'class',
    reportStartDate: '2026-06-16',
    reportDueDate: '2026-06-17'
  };
  const sessions = [
    {
      sessionId: 'SES-1',
      date: '2026-06-16',
      status: 'completed',
      startTime: '09:00',
      endTime: '10:00',
      roster: [
        { personId: 'STUDENT-PERSON-1', attendance: 'present' },
        { personId: 'STUDENT-PERSON-2', attendance: 'not_applicable' }
      ]
    },
    {
      sessionId: 'SES-2',
      date: '2026-06-17',
      status: 'completed',
      startTime: '09:00',
      endTime: '10:00',
      roster: [
        { personId: 'STUDENT-PERSON-1', attendance: 'late', lateMinutes: 10 }
      ]
    },
    {
      sessionId: 'SES-OUT',
      date: '2026-07-01',
      status: 'completed',
      startTime: '09:00',
      endTime: '10:00',
      roster: [{ personId: 'STUDENT-PERSON-1', attendance: 'present' }]
    }
  ];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-COLLECTIONS') {
        return { id: 'CLASS-COLLECTIONS', orgId: '900000', title: 'Collections Class' };
      }
      return null;
    },
    getClassSessions: async () => sessions,
    fetchData: async (entityType) => {
      if (entityType === 'students') {
        return [
          { id: 'STU-1', orgId: '900000', personId: 'STUDENT-PERSON-1', localId: 'L-1' },
          { id: 'STU-2', orgId: '900000', personId: 'STUDENT-PERSON-2', localId: 'L-2' }
        ];
      }
      return [];
    }
  }, async () => {
    await withPatched(schoolIdentityLookupService, {
      listSchoolPersonRecords: async () => ({
        rows: [
          { id: 'STUDENT-PERSON-1', name: { first: 'Ada', last: 'Lovelace' } },
          { id: 'STUDENT-PERSON-2', name: { preferred: 'Grace', first: 'Grace', last: 'Hopper' } }
        ]
      })
    }, async () => {
      await withPatched(classEnrollmentReadService, {
        listActiveStudentIdsForClass: async () => ({ studentIds: new Set(['STU-1', 'STU-2']) })
      }, async () => {
        await withPatched(sessionStatusPolicyService, {
          getStatusMap: async () => new Map()
        }, async () => {
          await withPatched(attendanceMatrixPolicyModel, {
            getPolicyForOrg: async () => ({
              scheduledMinutes: 60,
              disqualifyLateMinutes: 30,
              disqualifyEarlyLeaveMinutes: 30,
              disqualifyCombinedMissedMinutes: null
            })
          }, async () => {
            const collections = await reportService.buildReportDocxCollections({
              instance: { id: 'INST-COLLECTIONS' },
              assignment,
              reqUser: { id: 'USER-1', activeOrgId: '900000' }
            });

            assert.equal(collections.students.length, 2);
            assert.equal(collections.students[0].student_full_name, 'Ada Lovelace');
            assert.equal(collections.students[1].student_preferred_name, 'Grace');
            assert.equal(collections.attendance_sessions.length, 2);
            assert.equal(collections.student_attendance_rows.length, 4);
            assert.equal(
              collections.student_attendance_rows.find((row) => row.student_id === 'STUDENT-PERSON-2' && row.session_id === 'SES-1').attendance_status_label,
              'N/A'
            );
            assert.equal(
              collections.student_attendance_rows.find((row) => row.student_id === 'STUDENT-PERSON-2' && row.session_id === 'SES-2').attendance_status_label,
              'Absent'
            );
          });
        });
      });
    });
  });
});
test('report template prefill catalog keys are all produced with correct representative calculations', async () => {
  const assignment = {
    id: 'ASN-FULL',
    orgId: '900000',
    classId: 'CLASS-FULL',
    sessionId: 'SES-3',
    sessionDate: '2026-06-18',
    reportStartDate: '2026-06-16',
    reportDueDate: '2026-06-18',
    teacherIds: ['TEACHER-1']
  };
  const sessions = [
    {
      sessionId: 'SES-1',
      date: '2026-06-16',
      status: 'completed',
      startTime: '09:00',
      endTime: '10:00',
      roster: [
        { personId: 'STUDENT-PERSON-1', attendance: 'present' },
        { personId: 'STUDENT-PERSON-2', attendance: 'present' }
      ],
      gradebooks: [{ totalScore: 10, includeInGradeCalculation: true, scores: { 'STUDENT-PERSON-1': 8, 'STUDENT-PERSON-2': 10 } }]
    },
    {
      sessionId: 'SES-2',
      date: '2026-06-17',
      status: 'completed',
      startTime: '09:00',
      endTime: '10:00',
      roster: [
        { personId: 'STUDENT-PERSON-1', attendance: 'late', lateMinutes: 15 },
        { personId: 'STUDENT-PERSON-2', attendance: 'absent' }
      ],
      quizzes: [{ totalScore: 20, includeInGradeCalculation: true, scores: { 'STUDENT-PERSON-1': 10, 'STUDENT-PERSON-2': 20 } }]
    },
    {
      sessionId: 'SES-3',
      date: '2026-06-18',
      status: 'scheduled',
      startTime: '09:00',
      endTime: '10:00',
      roster: [],
      assignments: [{ totalScore: 5, includeInGradeCalculation: true, scores: { 'STUDENT-PERSON-1': 5 } }]
    }
  ];
  const examRows = [
    {
      id: 'EX-1',
      orgId: '900000',
      studentId: 'STU-1',
      status: 'graded',
      startWindowUtc: '2026-06-16T08:00:00.000Z',
      endWindowUtc: '2026-06-16T20:00:00.000Z',
      percentageComputed: 90,
      scoreComputed: 18,
      maxScoreComputed: 20
    },
    {
      id: 'EX-2',
      orgId: '900000',
      studentId: 'STU-2',
      status: 'submitted',
      startWindowUtc: '2026-06-17T08:00:00.000Z',
      endWindowUtc: '2026-06-17T20:00:00.000Z',
      percentageComputed: 70,
      scoreComputed: 14,
      maxScoreComputed: 20
    },
    {
      id: 'EX-3',
      orgId: '900000',
      studentId: 'STU-1',
      status: 'cancelled',
      startWindowUtc: '2026-06-17T08:00:00.000Z',
      endWindowUtc: '2026-06-17T20:00:00.000Z',
      percentageComputed: 100,
      scoreComputed: 20,
      maxScoreComputed: 20
    },
    {
      id: 'EX-4',
      orgId: '900000',
      studentId: 'STU-1',
      status: 'graded',
      startWindowUtc: '2026-07-01T08:00:00.000Z',
      endWindowUtc: '2026-07-01T20:00:00.000Z',
      percentageComputed: 100,
      scoreComputed: 20,
      maxScoreComputed: 20
    }
  ];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-FULL') {
        return { id: 'CLASS-FULL', orgId: '900000', title: 'Full Audit Class' };
      }
      return null;
    },
    getClassSessions: async () => sessions,
    fetchData: async (entityType) => {
      if (entityType === 'students') {
        return [
          {
            id: 'STU-1',
            localId: 'L-1',
            orgId: '900000',
            personId: 'STUDENT-PERSON-1',
            enrollmentDate: '2026-01-05',
            countryOfOrigin: 'Canada',
            feeCategory: 'funded',
            academicStatus: 'active',
            sendingOrganization: 'Sender Org',
            funderOrganization: 'Funder Org',
            funderAccountId: 'FA-1',
            studentAccountId: 'SA-1',
            studentIdAtFunder: 'SID-FUNDER',
            selfFund: false,
            funderNote: 'Funder note',
            notes: 'Student note'
          }
        ];
      }
      if (entityType === 'examAssignments') return examRows;
      return [];
    }
  }, async () => {
    await withPatched(dataServiceGlobal, {
      fetchData: async (entityType) => {
        if (entityType === 'persons') {
          return [
            { id: 'TEACHER-1', name: { preferred: 'Teacher One', first: 'Teacher', last: 'Uno' } },
            {
              id: 'STUDENT-PERSON-1',
              active: true,
              name: { preferred: 'Student Preferred', first: 'Student', middle: 'M', last: 'One' },
              demographics: { gender: 'F', dateOfBirth: '2000-01-01' },
              contact: { email: 'student@example.com', phones: [{ number: '555-0100' }] },
              avatarUrl: '/avatar.png',
              notes: 'Person note',
              address: { line1: '1 Main', line2: 'Unit 2', city: 'Calgary', province: 'AB', postalCode: 'T1T1T1', country: 'Canada' },
              organizations: [{ orgId: '900000', role: 'student', memberStatus: 'active' }]
            },
            { id: 'STUDENT-PERSON-2', name: { first: 'Other', last: 'Student' } }
          ];
        }
        if (entityType === 'organizations') {
          return [{ id: '900000', identity: { displayName: 'Equilibrium School' }, name: 'Fallback Org' }];
        }
        return [];
      }
    }, async () => {
      await withPatched(sessionStatusPolicyService, {
        getStatusMap: async () => new Map()
      }, async () => {
        await withPatched(attendanceMatrixPolicyModel, {
          getPolicyForOrg: async () => ({
            scheduledMinutes: 60,
            disqualifyLateMinutes: 30,
            disqualifyEarlyLeaveMinutes: 30,
            disqualifyCombinedMissedMinutes: null
          })
        }, async () => {
          const snapshot = await reportService.buildPrefillSnapshot({
            assignment,
            teacherId: 'TEACHER-1',
            studentId: 'STUDENT-PERSON-1',
            reqUser: { id: 'USER-1', activeOrgId: '900000' }
          });

          const catalogKeys = Object.values(reportService.getPrefillCatalog())
            .flat()
            .map((item) => item.key);
          const missing = catalogKeys.filter((key) => !Object.prototype.hasOwnProperty.call(snapshot, key));
          assert.deepEqual(missing, []);

          assert.equal(snapshot.teacher_name, 'Teacher One');
          assert.equal(snapshot.class_name, 'Full Audit Class');
          assert.equal(snapshot.report_org_name, 'Equilibrium School');
          assert.equal(snapshot.report_period_start_date, '2026-06-16');
          assert.equal(snapshot.report_period_due_date, '2026-06-18');
          assert.equal(snapshot.report_period_days, 3);
          assert.equal(snapshot.session_id, 'SES-3');
          assert.equal(snapshot.session_date, '2026-06-18');
          assert.equal(snapshot.student_preferred_name, 'Student Preferred');
          assert.equal(snapshot.student_full_name, 'Student One');
          assert.equal(snapshot.student_email, 'student@example.com');
          assert.equal(snapshot.student_phone, '555-0100');
          assert.equal(snapshot.student_org_member_role, 'student');

          assert.equal(snapshot.class_attendance_total, 3);
          assert.equal(snapshot.class_attendance_present, 58.33);
          assert.equal(snapshot.class_attendance_late, 1);
          assert.equal(snapshot.class_attendance_absent, 1);
          assert.equal(snapshot.class_attendance_span_sessions, 3);
          assert.equal(snapshot.class_attendance_span_unique_students, 2);
          assert.equal(snapshot.class_attendance_span_total, 4);
          assert.equal(snapshot.class_attendance_span_present, 2);
          assert.equal(snapshot.class_attendance_span_late, 1);
          assert.equal(snapshot.class_attendance_span_absent, 1);
          assert.equal(snapshot.class_attendance_span_percent, 75);
          assert.equal(snapshot.student_attendance_span_total_sessions, 3);
          assert.equal(snapshot.student_attendance_span_percent, 58.33);

          assert.equal(snapshot.class_gradebook_period_sessions_count, 3);
          assert.equal(snapshot.class_gradebook_period_activity_count, 3);
          assert.equal(snapshot.class_gradebook_period_avg_percent, 76.67);
          assert.equal(snapshot.class_gradebook_period_points_earned, 28);
          assert.equal(snapshot.class_gradebook_period_points_possible, 40);
          assert.equal(snapshot.student_gradebook_period_activity_count, 2);
          assert.equal(snapshot.student_gradebook_period_avg_percent, 65);
          assert.equal(snapshot.student_gradebook_period_points_earned, 18);
          assert.equal(snapshot.student_gradebook_period_points_possible, 30);

          assert.equal(snapshot.class_exam_period_assignment_count, 2);
          assert.equal(snapshot.class_exam_period_graded_count, 1);
          assert.equal(snapshot.class_exam_period_submitted_count, 2);
          assert.equal(snapshot.class_exam_period_avg_percent, 80);
          assert.equal(snapshot.student_exam_period_assignment_count, 1);
          assert.equal(snapshot.student_exam_period_graded_count, 1);
          assert.equal(snapshot.student_exam_period_avg_percent, 90);
          assert.equal(snapshot.student_exam_period_total_score, 18);
          assert.equal(snapshot.student_exam_period_total_max_score, 20);
        });
      });
    });
  });
});

test('buildPrefillSnapshot resolves student name prefill from top-level person name fields', async () => {
  const assignment = {
    id: 'ASN-TOP-NAME',
    orgId: '900000',
    classId: 'CLASS-TOP-NAME',
    sessionId: 'SES-TOP-NAME',
    sessionDate: '2026-06-18',
    reportStartDate: '2026-06-18',
    reportDueDate: '2026-06-18',
    teacherIds: ['TEACHER-TOP']
  };
  const sessions = [
    {
      sessionId: 'SES-TOP-NAME',
      date: '2026-06-18',
      status: 'completed',
      startTime: '09:00',
      endTime: '10:00',
      roster: [{ personId: 'STUDENT-TOP', attendance: 'present' }]
    }
  ];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-TOP-NAME') {
        return { id: 'CLASS-TOP-NAME', orgId: '900000', title: 'Top Name Class' };
      }
      return null;
    },
    getClassSessions: async () => sessions,
    fetchData: async (entityType) => {
      if (entityType === 'students') return [{ id: 'STU-TOP', orgId: '900000', personId: 'STUDENT-TOP' }];
      if (entityType === 'examAssignments') return [];
      return [];
    }
  }, async () => {
    await withPatched(schoolIdentityLookupService, {
      listSchoolPersonRecords: async () => ({
        allRows: [
          { id: 'TEACHER-TOP', firstName: 'Teacher', lastName: 'Top' },
          { id: 'STUDENT-TOP', firstName: 'Ada', middleName: 'M', lastName: 'Lovelace', preferredName: 'Addie' }
        ]
      })
    }, async () => {
      await withPatched(dataServiceGlobal, {
        fetchData: async (entityType) => (entityType === 'organizations' ? [{ id: '900000', name: 'Org' }] : [])
      }, async () => {
        await withPatched(sessionStatusPolicyService, {
          getStatusMap: async () => new Map()
        }, async () => {
          await withPatched(attendanceMatrixPolicyModel, {
            getPolicyForOrg: async () => ({})
          }, async () => {
            const snapshot = await reportService.buildPrefillSnapshot({
              assignment,
              teacherId: 'TEACHER-TOP',
              studentId: 'STUDENT-TOP',
              reqUser: { id: 'USER-1', activeOrgId: '900000' }
            });

            assert.equal(snapshot.student_first_name, 'Ada');
            assert.equal(snapshot.student_middle_name, 'M');
            assert.equal(snapshot.student_last_name, 'Lovelace');
            assert.equal(snapshot.student_full_name, 'Ada Lovelace');
            assert.equal(snapshot.student_preferred_name, 'Addie');
            assert.equal(snapshot.teacher_name, 'Teacher Top');
          });
        });
      });
    });
  });
});

test('partitionInstanceSave splits shared vs student answers for each_student', () => {
  const template = {
    schema: {
      fields: [
        { id: 's', type: 'text', sharedAcrossStudents: true },
        { id: 't', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const assignment = { reportScope: 'each_student' };
  const full = { s: 'sharedVal', t: 'studentVal' };
  const { studentAnswers, sharedAnswers } = reportService.partitionInstanceSave(template, assignment, full);
  assert.deepEqual(sharedAnswers, { s: 'sharedVal' });
  assert.deepEqual(studentAnswers, { t: 'studentVal' });
});

test('partitionInstanceSave puts all fields on student when scope is class', () => {
  const template = {
    schema: {
      fields: [
        { id: 's', type: 'text', sharedAcrossStudents: true },
        { id: 't', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const assignment = { reportScope: 'class' };
  const full = { s: 'a', t: 'b' };
  const { studentAnswers, sharedAnswers } = reportService.partitionInstanceSave(template, assignment, full);
  assert.deepEqual(studentAnswers, { s: 'a', t: 'b' });
  assert.deepEqual(sharedAnswers, {});
});

test('partitionInstanceSave ignores visual-only section/subheader rows', () => {
  const template = {
    schema: {
      fields: [
        { id: '__section_1', type: 'section' },
        { id: '__sub_1', type: 'subheader' },
        { id: 's', type: 'text', sharedAcrossStudents: true },
        { id: 't', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const assignment = { reportScope: 'each_student' };
  const full = { __section_1: 'x', __sub_1: 'y', s: 'a', t: 'b' };
  const { studentAnswers, sharedAnswers } = reportService.partitionInstanceSave(template, assignment, full);
  assert.deepEqual(sharedAnswers, { s: 'a' });
  assert.deepEqual(studentAnswers, { t: 'b' });
});

test('mergeTemplateData does not emit values for visual-only rows', () => {
  const template = {
    schema: {
      fields: [
        { id: '__section_1', type: 'section' },
        { id: 'per', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const instance = {
    answers: { per: 'ok', __section_1: 'should_not_surface' },
    prefillSnapshot: {}
  };
  const merged = reportService.mergeTemplateData(template, instance, { reportScope: 'class' });
  assert.equal(merged.per, 'ok');
  assert.equal(Object.prototype.hasOwnProperty.call(merged, '__section_1'), false);
});

// Edge case tests for comprehensive prefill coverage
test('buildPrefillSnapshot handles empty class with no sessions in report period', async () => {
  const assignment = {
    id: 'ASN-EMPTY',
    orgId: '900000',
    classId: 'CLASS-EMPTY',
    reportStartDate: '2026-06-16',
    reportDueDate: '2026-06-18',
    teacherIds: ['TEACHER-1']
  };
  const sessions = [
    { sessionId: 'SES-PAST', date: '2026-06-10', status: 'completed', startTime: '09:00', endTime: '10:00', roster: [] }
  ];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-EMPTY') return { id: 'CLASS-EMPTY', orgId: '900000', title: 'Empty Class' };
      return null;
    },
    getClassSessions: async () => sessions,
    fetchData: async (entityType) => {
      if (entityType === 'students') return [];
      if (entityType === 'examAssignments') return [];
      return [];
    }
  }, async () => {
    await withPatched(dataServiceGlobal, {
      fetchData: async (entityType) => {
        if (entityType === 'persons') return [{ id: 'TEACHER-1', name: { first: 'Teacher', last: 'One' } }];
        if (entityType === 'organizations') return [{ id: '900000', identity: { displayName: 'School' }, name: 'School' }];
        return [];
      }
    }, async () => {
      await withPatched(sessionStatusPolicyService, {
        getStatusMap: async () => new Map()
      }, async () => {
        await withPatched(attendanceMatrixPolicyModel, {
          getPolicyForOrg: async () => ({
            scheduledMinutes: 60,
            disqualifyLateMinutes: 30,
            disqualifyEarlyLeaveMinutes: 30,
            disqualifyCombinedMissedMinutes: null
          })
        }, async () => {
          const snapshot = await reportService.buildPrefillSnapshot({
            assignment,
            teacherId: 'TEACHER-1',
            reqUser: { id: 'USER-1', activeOrgId: '900000' }
          });

          const catalogKeys = Object.values(reportService.getPrefillCatalog())
            .flat()
            .map((item) => item.key);
          const missing = catalogKeys.filter((key) => !Object.prototype.hasOwnProperty.call(snapshot, key));
          assert.deepEqual(missing, [], 'All catalog keys must be present even for empty class');

          // Verify empty class produces zero/null values correctly
          assert.equal(snapshot.class_attendance_total, 0, 'Empty class should have 0 total attendance');
          assert.equal(snapshot.class_attendance_span_sessions, 0, 'Empty class should have 0 sessions in report period');
          assert.equal(snapshot.class_attendance_span_unique_students, 0, 'Empty class should have 0 unique students');
        });
      });
    });
  });
});

test('buildPrefillSnapshot handles student with all absent attendance marks', async () => {
  const assignment = {
    id: 'ASN-ABSENT',
    orgId: '900000',
    classId: 'CLASS-1',
    sessionId: 'SES-3',
    reportStartDate: '2026-06-16',
    reportDueDate: '2026-06-18',
    teacherIds: ['TEACHER-1']
  };
  const sessions = [
    { sessionId: 'SES-1', date: '2026-06-16', status: 'completed', startTime: '09:00', endTime: '10:00', roster: [{ personId: 'STU-ABSENT', attendance: 'absent' }] },
    { sessionId: 'SES-2', date: '2026-06-17', status: 'completed', startTime: '09:00', endTime: '10:00', roster: [{ personId: 'STU-ABSENT', attendance: 'absent' }] },
    { sessionId: 'SES-3', date: '2026-06-18', status: 'scheduled', startTime: '09:00', endTime: '10:00', roster: [] }
  ];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-1') return { id: 'CLASS-1', orgId: '900000', title: 'Class One' };
      return null;
    },
    getClassSessions: async () => sessions,
    fetchData: async (entityType) => {
      if (entityType === 'students') return [{ id: 'STU-1', orgId: '900000', personId: 'STU-ABSENT' }];
      if (entityType === 'examAssignments') return [];
      return [];
    }
  }, async () => {
    await withPatched(dataServiceGlobal, {
      fetchData: async (entityType) => {
        if (entityType === 'persons') {
          return [
            { id: 'TEACHER-1', name: { first: 'Teacher', last: 'One' } },
            { id: 'STU-ABSENT', name: { first: 'Absent', last: 'Student' } }
          ];
        }
        if (entityType === 'organizations') return [{ id: '900000', identity: { displayName: 'School' }, name: 'School' }];
        return [];
      }
    }, async () => {
      await withPatched(sessionStatusPolicyService, {
        getStatusMap: async () => new Map()
      }, async () => {
        await withPatched(attendanceMatrixPolicyModel, {
          getPolicyForOrg: async () => ({
            scheduledMinutes: 60,
            disqualifyLateMinutes: 30,
            disqualifyEarlyLeaveMinutes: 30,
            disqualifyCombinedMissedMinutes: null
          })
        }, async () => {
          const snapshot = await reportService.buildPrefillSnapshot({
            assignment,
            teacherId: 'TEACHER-1',
            studentId: 'STU-ABSENT',
            reqUser: { id: 'USER-1', activeOrgId: '900000' }
          });

          const catalogKeys = Object.values(reportService.getPrefillCatalog())
            .flat()
            .map((item) => item.key);
          const missing = catalogKeys.filter((key) => !Object.prototype.hasOwnProperty.call(snapshot, key));
          assert.deepEqual(missing, [], 'All catalog keys must be present for all-absent student');

          // Verify all-absent student produces 0% attendance
          assert.equal(snapshot.student_attendance_percent, 0, 'All-absent student should have 0% attendance');
          assert.equal(snapshot.class_attendance_span_absent, 2, '2 absences in class span');
          assert.equal(snapshot.class_attendance_span_present, 0, 'No present marks in class span');
        });
      });
    });
  });
});

test('validateTemplatePrefillKeys rejects all live templates with invalid keys', () => {
  const templatesPath = path.join(ROOT, 'data/school/reportTemplates.json');
  if (!fs.existsSync(templatesPath)) {
    console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â  Live templates file not found; skipping validation check');
    return;
  }

  const templates = JSON.parse(fs.readFileSync(templatesPath, 'utf8'));
  if (!Array.isArray(templates)) {
    console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â  reportTemplates.json is not an array; skipping validation check');
    return;
  }

  const invalidTemplates = [];
  templates.forEach((template) => {
    const invalid = reportService.validateTemplatePrefillKeys(template);
    if (invalid.length > 0) {
      invalidTemplates.push({
        templateId: template.id,
        errors: invalid
      });
    }
  });

  assert.deepEqual(
    invalidTemplates,
    [],
    `Live templates must not contain invalid prefill keys. Found issues in: ${invalidTemplates.map((t) => t.templateId).join(', ')}`
  );
});
