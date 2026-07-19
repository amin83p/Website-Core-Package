const { attachOrgTimezoneContext } = require('../utils/timezoneUtils');

module.exports = function orgTimezoneLocalsMiddleware(req, res, next) {
  try {
    attachOrgTimezoneContext(req, res);
  } catch (error) {
    console.warn(`[OrgTimezone] Unable to attach org timezone context: ${error.message}`);
  }
  return next();
};
