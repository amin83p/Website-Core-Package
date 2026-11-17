'use strict';

const schoolDataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

async function buildFunderLabelByIdMap(reqUser, orgId) {
  const orgToken = toPublicId(orgId);
  if (!orgToken) return new Map();
  const rows = await schoolDataService.fetchAllData('funders', {}, reqUser).catch(() => []);
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.orgId, orgToken));
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: scoped.map((row) => row?.personId)
  });
  const map = new Map();
  scoped.forEach((row) => {
    const id = toPublicId(row?.id);
    if (!id) return;
    const personId = toPublicId(row?.personId);
    const label = String(
      schoolPersonAccessService.formatPersonName(personById.get(personId), id)
        || personById.get(personId)?.organizationProfile?.legalName
        || ''
    ).trim() || id;
    map.set(id, label);
    const rawId = String(row?.id || '').trim();
    if (rawId && !idsEqual(rawId, id)) map.set(rawId, label);
  });
  return map;
}

function indexEnrollmentFunderLabelsByStudentId(periods = [], funderLabelById = new Map()) {
  const byStudent = new Map();
  (Array.isArray(periods) ? periods : []).forEach((period) => {
    const status = String(period?.status || '').trim().toLowerCase();
    if (status === 'void') return;
    const studentId = toPublicId(period?.studentId);
    if (!studentId) return;
    const label = String(rollingEnrollmentFunderService.resolveEnrollmentFunderLabel(period, funderLabelById) || '').trim();
    if (!label) return;
    let labels = byStudent.get(studentId);
    if (!labels) {
      labels = new Set();
      byStudent.set(studentId, labels);
    }
    labels.add(label);
  });
  return byStudent;
}

async function loadEnrollmentFunderLabelsByStudentId(reqUser, orgId) {
  const orgToken = toPublicId(orgId);
  if (!orgToken) return new Map();
  const [periods, funderLabelById] = await Promise.all([
    schoolDataService.getClassEnrollmentPeriodsByOrg(orgToken, reqUser).catch(() => []),
    buildFunderLabelByIdMap(reqUser, orgToken)
  ]);
  return indexEnrollmentFunderLabelsByStudentId(periods, funderLabelById);
}

function readEnrollmentFunderLabelsForStudent(student, labelsByStudentId = null) {
  if (!labelsByStudentId || !(labelsByStudentId instanceof Map)) return [];
  const studentId = toPublicId(student?.id);
  if (!studentId) return [];
  const labels = labelsByStudentId.get(studentId);
  if (!labels) return [];
  return Array.from(labels instanceof Set ? labels : labels);
}

module.exports = {
  buildFunderLabelByIdMap,
  indexEnrollmentFunderLabelsByStudentId,
  loadEnrollmentFunderLabelsByStudentId,
  readEnrollmentFunderLabelsForStudent
};