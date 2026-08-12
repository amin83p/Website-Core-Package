const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const overallReportService = require('../packages/school/MVC/services/school/overallReportService');
const studentAttendanceReportPolicyService = require('../packages/school/MVC/services/school/studentAttendanceReportPolicyService');

const reqUser = { id: 'USER-1', activeOrgId: 'ORG-1' };

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

test('normalizePolicyFromForm trims template ids', () => {
  const normalized = studentAttendanceReportPolicyService.normalizePolicyFromForm({
    reportTemplateId: ' RPT-1 ',
    overallReportTemplateId: ' OV-1 '
  });
  assert.equal(normalized.reportTemplateId, 'RPT-1');
  assert.equal(normalized.overallReportTemplateId, 'OV-1');
});

test('validatePolicyInput rejects archived report templates', async () => {
  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'reportTemplates' && id === 'RPT-ARCH') {
        return { id: 'RPT-ARCH', orgId: 'ORG-1', status: 'archived', title: 'Old' };
      }
      return null;
    }
  }, async () => {
    await assert.rejects(
      () => studentAttendanceReportPolicyService.validatePolicyInput({
        reportTemplateId: 'RPT-ARCH'
      }, reqUser),
      /archived/i
    );
  });
});

test('validatePolicyInput accepts active overall template references', async () => {
  const overallTemplate = {
    id: 'OV-1',
    orgId: 'ORG-1',
    status: 'active',
    sourceSlots: [{ slotKey: 'T1', templateId: 'RPT-1' }]
  };
  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'reportTemplates' && id === 'RPT-1') {
        return { id: 'RPT-1', orgId: 'ORG-1', status: 'active', title: 'Attendance', version: 1, type: 'attendance' };
      }
      if (entityType === 'overallReportTemplates' && id === 'OV-1') {
        return overallTemplate;
      }
      return null;
    }
  }, async () => {
    await withPatched(overallReportService, {
      validateTemplateReferences: async () => {}
    }, async () => {
      const normalized = await studentAttendanceReportPolicyService.validatePolicyInput({
        reportTemplateId: 'RPT-1',
        overallReportTemplateId: 'OV-1'
      }, reqUser);
      assert.equal(normalized.reportTemplateId, 'RPT-1');
      assert.equal(normalized.overallReportTemplateId, 'OV-1');
    });
  });
});
