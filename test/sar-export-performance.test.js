'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runWithConcurrency } = require('../packages/school/MVC/utils/asyncPool');
const reportExportBatchCacheService = require('../packages/school/MVC/services/school/reportExportBatchCacheService');
const sarExportTimingService = require('../packages/school/MVC/services/school/sarExportTimingService');
const sarExportConfigService = require('../packages/school/MVC/services/school/sarExportConfigService');
const sarExportJobService = require('../packages/school/MVC/services/school/sarExportJobService');
const classEnrollmentReadService = require('../packages/school/MVC/services/school/classEnrollmentReadService');
const studentAttendanceReportPolicyService = require('../packages/school/MVC/services/school/studentAttendanceReportPolicyService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const integrationVariableService = require('../MVC/services/integrationVariableService');
const settingService = require('../MVC/services/settingService');

test('runWithConcurrency preserves order under parallel execution', async () => {
  const input = [1, 2, 3, 4, 5];
  const results = await runWithConcurrency(input, 2, async (value) => value * 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test('export batch cache stores class bundle once per classId', async () => {
  const cache = reportExportBatchCacheService.createExportBatchCache();
  let fetchCount = 0;
  const reqUser = { activeOrgId: 'ORG-1' };
  const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
  const originalGet = schoolDataService.getDataById;
  const originalSessions = schoolDataService.getClassSessions;
  schoolDataService.getDataById = async (type, id) => {
    if (type === 'classes') fetchCount += 1;
    return { id, orgId: 'ORG-1', name: 'Class' };
  };
  schoolDataService.getClassSessions = async () => {
    fetchCount += 1;
    return [{ sessionId: 'S1', date: '2026-01-01' }];
  };
  try {
    await reportExportBatchCacheService.getOrLoadClassBundle(cache, 'CLASS-1', reqUser);
    await reportExportBatchCacheService.getOrLoadClassBundle(cache, 'CLASS-1', reqUser);
    assert.equal(fetchCount, 2);
    assert.equal(cache.classById.size, 1);
  } finally {
    schoolDataService.getDataById = originalGet;
    schoolDataService.getClassSessions = originalSessions;
  }
});

test('sarExportConfigService reads SAR_EXPORT_CONCURRENCY from integration variables', () => {
  const originalGet = settingService.get;
  settingService.get = () => ({
    app: {
      integrationVariables: [{
        key: 'SAR_EXPORT_CONCURRENCY',
        isSecret: false,
        value: '6'
      }]
    }
  });
  delete process.env.SAR_EXPORT_CONCURRENCY;
  try {
    assert.equal(sarExportConfigService.getExportConcurrency(), 6);
    assert.equal(integrationVariableService.validateIntegrationVariable('SAR_EXPORT_CONCURRENCY').linked, true);
  } finally {
    settingService.get = originalGet;
  }
});

test('listClassStudentMatchesForReportWindow groups students by class', async () => {
  const original = schoolDataService.getClassEnrollmentPeriodsByOrg;
  schoolDataService.getClassEnrollmentPeriodsByOrg = async () => ([
    {
      orgId: 'ORG-1',
      classId: 'CLASS-A',
      studentId: 'STU-1',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-01-31'
    },
    {
      orgId: 'ORG-1',
      classId: 'CLASS-B',
      studentId: 'STU-2',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-01-31'
    }
  ]);
  try {
    const { matchesByClassId } = await classEnrollmentReadService.listClassStudentMatchesForReportWindow({
      reqUser: { activeOrgId: 'ORG-1' },
      activeOrgId: 'ORG-1',
      startDate: '2026-01-10',
      endDate: '2026-01-20',
      selectedStudentRecordIds: ['STU-1', 'STU-2']
    });
    assert.equal(matchesByClassId.size, 2);
    assert.ok(matchesByClassId.get('CLASS-A')?.has('STU-1'));
    assert.ok(matchesByClassId.get('CLASS-B')?.has('STU-2'));
  } finally {
    schoolDataService.getClassEnrollmentPeriodsByOrg = original;
  }
});

test('policy access cache avoids duplicate template loads', async () => {
  const accessCache = studentAttendanceReportPolicyService.createPolicyAccessCache();
  let fetchCount = 0;
  const originalGet = schoolDataService.getDataById;
  schoolDataService.getDataById = async (type, id) => {
    if (type === 'reportTemplates') fetchCount += 1;
    return { id, orgId: 'ORG-1', status: 'active', title: 'Template' };
  };
  try {
    await studentAttendanceReportPolicyService.assertReportTemplateAccessible('TPL-1', { activeOrgId: 'ORG-1' }, { accessCache });
    await studentAttendanceReportPolicyService.assertReportTemplateAccessible('TPL-1', { activeOrgId: 'ORG-1' }, { accessCache });
    assert.equal(fetchCount, 1);
  } finally {
    schoolDataService.getDataById = originalGet;
  }
});

test('sarExportConfigService reads async export threshold from integration variables', () => {
  const originalGet = settingService.get;
  settingService.get = () => ({
    app: {
      integrationVariables: [{
        key: 'SAR_EXPORT_ASYNC_MIN_TARGETS',
        isSecret: false,
        value: '8'
      }]
    }
  });
  delete process.env.SAR_EXPORT_ASYNC_MIN_TARGETS;
  try {
    assert.equal(sarExportConfigService.getAsyncExportMinTargets(), 8);
    assert.equal(integrationVariableService.validateIntegrationVariable('SAR_EXPORT_ASYNC_MIN_TARGETS').linked, true);
  } finally {
    settingService.get = originalGet;
  }
});

test('sarExportJobService stores and returns job status', () => {
  const job = sarExportJobService.createJob({ userId: 'USER-1', activeOrgId: 'ORG-1' });
  const loaded = sarExportJobService.getJobForUser(job.id, { id: 'USER-1', activeOrgId: 'ORG-1' });
  assert.equal(loaded.status, 'pending');
  assert.equal(sarExportJobService.toPublicJob(loaded).jobId, job.id);
});

test('sarExportConfigService enables timing from integration variables', () => {
  const originalGet = settingService.get;
  const prevNode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  settingService.get = () => ({
    app: {
      integrationVariables: [{
        key: 'SAR_EXPORT_TIMING',
        isSecret: false,
        value: 'true'
      }]
    }
  });
  delete process.env.SAR_EXPORT_TIMING;
  try {
    assert.equal(sarExportConfigService.isExportTimingEnabled(), true);
    assert.equal(sarExportTimingService.timingEnabled(), true);
  } finally {
    settingService.get = originalGet;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  }
});
