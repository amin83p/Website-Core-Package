'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const accessService = requireCoreModule('MVC/services/security');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

async function evaluateSchoolSettingsAccess(user, operationId, ipAddress) {
  if (!user) return false;
  try {
    const evaluation = await accessService.evaluateAccess({
      user,
      sectionId: SECTIONS.SCHOOL_SETTINGS,
      operationId,
      ipAddress
    });
    return evaluation?.allowed === true;
  } catch (_) {
    return false;
  }
}

async function userCanViewSchoolSettings(user, ipAddress) {
  return evaluateSchoolSettingsAccess(user, OPERATIONS.READ_ALL, ipAddress);
}

async function userCanUpdateSchoolSettings(user, ipAddress) {
  return evaluateSchoolSettingsAccess(user, OPERATIONS.UPDATE, ipAddress);
}

module.exports = {
  evaluateSchoolSettingsAccess,
  userCanViewSchoolSettings,
  userCanUpdateSchoolSettings
};
