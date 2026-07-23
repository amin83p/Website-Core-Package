'use strict';

/**
 * CSV import: each row creates a new Person + Student (never links an existing person).
 * Columns: firstName, lastName, gender [, dateOfBirth, email, enrollmentDate,
 * countryOfOrigin, feeCategory, middleName, preferredName, phone, localId,
 * customStudentId, academicStatus, notes, ...]
 */

const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const createImportController = requireCoreModule('MVC/controllers/importControllerFactory');
const {
  getActiveOrgIdOrThrow
} = requireCoreModule('MVC/utils/orgContextUtils');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');
const {
  validateImportRecord,
  admitNewPersonAndStudentFromRecord
} = require('../../services/school/studentPersonAdmissionService');

async function validateStudentImportRecord(record, context) {
  validateImportRecord(record, context);
}

async function processStudentImportRecord(record, context) {
  const result = await admitNewPersonAndStudentFromRecord(record, context);
  // Help import report labeling
  if (record && typeof record === 'object') {
    record.name = result.name;
    record.email = result.email;
  }
  return result;
}

function buildContext(req) {
  const reqUser = req.user || null;
  let orgId = '';
  let orgToday = '';
  try {
    orgId = reqUser ? String(getActiveOrgIdOrThrow(reqUser) || '').trim() : '';
  } catch (_) {
    orgId = String(reqUser?.activeOrgId || '').trim();
  }
  try {
    orgToday = String(resolveOrgTodayFromContext({
      orgTimeZone: req.orgTimeZone || reqUser?.activeOrgTimeZone,
      user: reqUser
    }) || req.orgToday || reqUser?.orgToday || '').trim();
  } catch (_) {
    orgToday = String(req.orgToday || reqUser?.orgToday || '').trim();
  }

  return {
    userId: reqUser ? reqUser.id : '1',
    username: reqUser?.username || reqUser?.email || '',
    reqUser,
    orgId,
    orgToday
  };
}

const studentImportController = createImportController({
  downloadRouteBase: '/school/students/import/report',
  processRecord: processStudentImportRecord,
  validateRecord: validateStudentImportRecord,
  buildContext
});

module.exports = studentImportController;
