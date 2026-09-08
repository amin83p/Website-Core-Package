'use strict';

const {
  requireAccess,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');
const schoolAdminAccessService = require('../services/school/schoolAdminAccessService');

function requireMyTimesheetLegacyDeleteAccess(req, res, next) {
  return schoolAdminAccessService.isTimesheetsAdminViewerAsync(req.user, OPERATIONS.DELETE)
    .then((allowed) => {
      if (allowed) return next();
      return requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE)(req, res, next);
    })
    .catch((error) => {
      console.error('Timesheet legacy delete route guard error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal Security Error' });
    });
}

module.exports = {
  requireMyTimesheetLegacyDeleteAccess
};
