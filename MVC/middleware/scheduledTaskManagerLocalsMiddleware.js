'use strict';

const scheduledTaskManagerService = require('../services/scheduledTaskManagerService');

function shouldEvaluateForView(req) {
  if (!req?.user) return false;
  if (req.method !== 'GET') return false;
  const accept = String(req.headers?.accept || '');
  return !accept || accept.includes('text/html');
}

module.exports = async function scheduledTaskManagerLocals(req, res, next) {
  res.locals.scheduledTaskManagerAccess = { ...scheduledTaskManagerService.EMPTY_MANAGER_ACCESS };

  if (!shouldEvaluateForView(req)) return next();

  try {
    res.locals.scheduledTaskManagerAccess = await scheduledTaskManagerService.buildManagerAccess(
      req.user,
      req.ip
    );
  } catch (error) {
    console.warn(`[ScheduledTaskManager] Unable to build view access: ${error.message}`);
  }

  return next();
};
