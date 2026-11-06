'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const accessService = requireCoreModule('MVC/services/security/index');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

/**
 * True when the user may open class rolling enrollment (READ_ALL on SCHOOL_ROLLING_ENROLLMENT).
 */
async function canAccessRollingEnrollment(user) {
  try {
    if (!user) return false;
    const result = await accessService.evaluateAccess({
      user,
      sectionId: SECTIONS.SCHOOL_ROLLING_ENROLLMENT,
      operationId: OPERATIONS.READ_ALL
    });
    return result === true || result?.granted === true || result?.allowed === true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  canAccessRollingEnrollment
};
