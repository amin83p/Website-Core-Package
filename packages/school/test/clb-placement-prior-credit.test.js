const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseLowerClbBandFromText } = require('../MVC/utils/clbSubjectBandParser');
const { normalizeConfiguration } = require('../MVC/models/school/subjectModel');
const clbPlacementPriorCreditService = require('../MVC/services/school/clbPlacementPriorCreditService');

const subjectFormPath = path.join(__dirname, '../MVC/views/school/subject/subjectForm.ejs');
const rollingEnrollmentPath = path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs');
const classRoutesPath = path.join(__dirname, '../MVC/routes/classRoutes.js');

test('parseLowerClbBandFromText extracts lower band from code and title', () => {
  assert.equal(parseLowerClbBandFromText('EAL-CLB5-6'), 5);
  assert.equal(parseLowerClbBandFromText('EAL- CLB 5-6'), 5);
  assert.equal(parseLowerClbBandFromText('EAL-CLB11-12'), 11);
  assert.equal(parseLowerClbBandFromText('LINC-CLB-1-2'), 1);
  assert.equal(parseLowerClbBandFromText('LINC-PRE-CLB'), null);
  assert.equal(parseLowerClbBandFromText(''), null);
});

test('normalizeConfiguration validates CLB levels and defaults skills from level', () => {
  const normalized = normalizeConfiguration({
    defaultHours: 100,
    credits: 2,
    level: 'Intermediate',
    deliveryMethod: 'Online',
    clb: {
      level: 5,
      skills: {
        listening: '',
        speaking: null,
        reading: undefined,
        writing: 6
      }
    }
  }, { code: 'EAL-CLB5-6', title: 'EAL CLB 5-6' });

  assert.equal(normalized.clb.level, 5);
  assert.equal(normalized.clb.skills.listening, 5);
  assert.equal(normalized.clb.skills.speaking, 5);
  assert.equal(normalized.clb.skills.reading, 5);
  assert.equal(normalized.clb.skills.writing, 6);
});

test('normalizeConfiguration auto-fills CLB from code when clb empty', () => {
  const normalized = normalizeConfiguration({
    defaultHours: 45,
    credits: 3
  }, { code: 'EAL-CLB3-4', title: 'EAL' });

  assert.equal(normalized.clb.level, 3);
  assert.equal(normalized.clb.skills.listening, 3);
  assert.equal(normalized.clb.skills.speaking, 3);
  assert.equal(normalized.clb.skills.reading, 3);
  assert.equal(normalized.clb.skills.writing, 3);
});

test('normalizeConfiguration rejects invalid CLB level', () => {
  assert.throws(() => normalizeConfiguration({
    clb: { level: 13 }
  }, {}), /between 1 and 12/);
});

test('normalizeClbLevelToken strips +/- from student CLB tokens', () => {
  assert.equal(clbPlacementPriorCreditService.normalizeClbLevelToken('3+'), 3);
  assert.equal(clbPlacementPriorCreditService.normalizeClbLevelToken('4-'), 4);
  assert.equal(clbPlacementPriorCreditService.normalizeClbLevelToken(''), null);
});

test('suggestPlacementSubjectIds matches program subjects by clb.level in student level set', () => {
  const student = {
    clbLevelHistory: [{
      id: 'clb_1',
      recordedAt: '2026-08-01T00:00:00.000Z',
      current: {
        listening: '1+',
        speaking: '2+',
        reading: '3',
        writing: '4-'
      }
    }]
  };
  const program = {
    subjects: [
      { subjectId: 'SUB_1' },
      { subjectId: 'SUB_2' },
      { subjectId: 'SUB_5' }
    ]
  };
  const subjectCatalog = [
    { id: 'SUB_1', configuration: { clb: { level: 1 } } },
    { id: 'SUB_2', configuration: { clb: { level: 2 } } },
    { id: 'SUB_5', configuration: { clb: { level: 5 } } }
  ];

  const result = clbPlacementPriorCreditService.suggestPlacementSubjectIds({
    student,
    program,
    missingSubjectIds: ['SUB_1', 'SUB_2', 'SUB_5'],
    subjectCatalog
  });

  assert.deepEqual(result.normalizedLevels, [1, 2, 3, 4]);
  assert.deepEqual(result.subjectIds, ['SUB_1', 'SUB_2']);
});

test('getLatestCurrentClbEntry picks newest recordedAt row', () => {
  const student = {
    clbLevelHistory: [
      { id: 'old', recordedAt: '2026-01-01T00:00:00.000Z', current: { listening: '2' } },
      { id: 'new', recordedAt: '2026-08-01T00:00:00.000Z', current: { listening: '5+' } }
    ]
  };
  const entry = clbPlacementPriorCreditService.getLatestCurrentClbEntry(student);
  assert.equal(entry.id, 'new');
});

test('subject form includes CLB placement inputs', () => {
  const html = fs.readFileSync(subjectFormPath, 'utf8');
  assert.match(html, /inp_clb_level/);
  assert.match(html, /inp_clb_listening/);
  assert.match(html, /inp_clb_speaking/);
  assert.match(html, /inp_clb_reading/);
  assert.match(html, /inp_clb_writing/);
  assert.match(html, /btn_clb_apply_to_skills/);
});

test('subjects repository normalizes configuration.clb for mongo writes', () => {
  const repoSource = fs.readFileSync(
    path.join(__dirname, '../MVC/repositories/school/index.js'),
    'utf8'
  );
  assert.match(repoSource, /entityName: 'subjects'/);
  assert.match(repoSource, /normalizePayload[\s\S]*normalizeConfiguration/);
  assert.match(repoSource, /replaceObjectFields: \['configuration'\]/);
});

test('buildClbPlacementSlice includes insight fields for class subjects and qualification summary', () => {
  const student = {
    clbLevelHistory: [{
      id: 'clb_1',
      recordedAt: '2026-08-01T00:00:00.000Z',
      current: {
        listening: '5+',
        speaking: '5',
        reading: '6',
        writing: '6-'
      }
    }]
  };
  const program = {
    subjects: [
      { subjectId: 'SUB_5' },
      { subjectId: 'SUB_6' }
    ]
  };
  const subjectCatalogMap = new Map([
    ['SUB_5', { id: 'SUB_5', code: 'EAL-CLB5-6', title: 'EAL CLB 5-6', configuration: { clb: { level: 5 } } }],
    ['SUB_6', { id: 'SUB_6', code: 'EAL-CLB6-7', title: 'EAL CLB 6-7', configuration: { clb: { level: 6 } } }],
    ['CLASS_SUB', { id: 'CLASS_SUB', code: 'EAL-CLB5-6', title: 'Class Subject', configuration: { clb: { level: 5 } } }]
  ]);

  const slice = clbPlacementPriorCreditService.buildClbPlacementSlice({
    student,
    program,
    missingSubjects: [],
    subjectCatalogMap,
    classSubjectIds: ['CLASS_SUB'],
    prerequisitesSatisfied: true
  });

  assert.equal(slice.hasInsight, true);
  assert.equal(slice.hasCurrentClb, true);
  assert.deepEqual(slice.normalizedLevels, [5, 6]);
  assert.equal(slice.matchedProgramSubjectCount, 2);
  assert.equal(slice.prerequisitesSatisfied, true);
  assert.equal(slice.classSubjects.length, 1);
  assert.equal(slice.classSubjects[0].id, 'CLASS_SUB');
  assert.equal(slice.classSubjects[0].matchesStudentLevels, true);
  assert.match(slice.qualificationSummary, /Prerequisites are satisfied/);
  assert.equal(slice.currentClb.normalizedBySkill.listening, 5);
  assert.equal(slice.currentClb.current.speaking, '5');
});

test('rolling enrollment view and routes include CLB placement apply flow', () => {
  const rollingHtml = fs.readFileSync(rollingEnrollmentPath, 'utf8');
  const routesSource = fs.readFileSync(classRoutesPath, 'utf8');
  assert.match(rollingHtml, /btn_applyClbPlacementCredits/);
  assert.match(rollingHtml, /applyClbPlacementCredits/);
  assert.match(rollingHtml, /rolling-prior-subject-credits\/apply-placement/);
  assert.match(rollingHtml, /btn_openClbPlacementInsight/);
  assert.match(rollingHtml, /clbPlacementInsightModal/);
  assert.match(rollingHtml, /openClbPlacementInsightModal/);
  assert.match(routesSource, /rolling-prior-subject-credits\/apply-placement/);
  assert.match(routesSource, /applyRollingClbPlacementCredits/);
});
