'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reportTargetDepartmentPolicy = require('../MVC/services/school/reportTargetDepartmentPolicy');
const {
  filterTemplatesForDeliveryDepartment,
  templateMatchesDeliveryDepartment
} = require('../public/scripts/sessionReportAssignmentClient.js');

test('general template matches any delivery department', () => {
  const template = { id: 'T1', targetDepartmentIds: [] };
  assert.equal(reportTargetDepartmentPolicy.templateMatchesDeliveryDepartment(template, 'DEPT_A'), true);
  assert.equal(templateMatchesDeliveryDepartment(template, 'DEPT_A'), true);
});

test('restricted template matches only listed department', () => {
  const template = { id: 'T2', targetDepartmentIds: ['DEPT_A', 'DEPT_B'] };
  assert.equal(reportTargetDepartmentPolicy.templateMatchesDeliveryDepartment(template, 'DEPT_A'), true);
  assert.equal(reportTargetDepartmentPolicy.templateMatchesDeliveryDepartment(template, 'DEPT_C'), false);
});

test('filterTemplatesForDeliveryDepartment respects alwaysIncludeTemplateId', () => {
  const templates = [
    { id: 'GEN', targetDepartmentIds: [] },
    { id: 'LINC', targetDepartmentIds: ['DEPT_LINC'] },
    { id: 'OTHER', targetDepartmentIds: ['DEPT_OTHER'] }
  ];
  const filtered = reportTargetDepartmentPolicy.filterTemplatesForDeliveryDepartment(
    templates,
    'DEPT_LINC',
    { alwaysIncludeTemplateId: 'OTHER' }
  );
  assert.deepEqual(filtered.map((row) => row.id), ['GEN', 'LINC', 'OTHER']);

  const clientFiltered = filterTemplatesForDeliveryDepartment(
    templates,
    'DEPT_LINC',
    { alwaysIncludeTemplateId: 'OTHER' }
  );
  assert.deepEqual(clientFiltered.map((row) => row.id), ['GEN', 'LINC', 'OTHER']);
});

test('normalizeTargetDepartmentIds dedupes and rejects invalid ids', () => {
  const ids = reportTargetDepartmentPolicy.normalizeTargetDepartmentIds(['DEPT_A', 'DEPT_A', 'DEPT_B']);
  assert.deepEqual(ids, ['DEPT_A', 'DEPT_B']);
  assert.throws(() => reportTargetDepartmentPolicy.normalizeTargetDepartmentIds(['bad id']));
});

test('assertTemplateMatchesClass throws for mismatched department', () => {
  const template = { targetDepartmentIds: ['DEPT_LINC'] };
  const classData = { deliveryDepartmentId: 'DEPT_OTHER' };
  assert.throws(
    () => reportTargetDepartmentPolicy.assertTemplateMatchesClass(template, classData),
    /not available for this class delivery department/i
  );
});
