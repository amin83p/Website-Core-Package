'use strict';

async function resolveWordOfDayDashboardPayload(req) {
  if (!req?.user) return null;
  try {
    const wordOfDayPolicyModel = require('../../packages/school/MVC/models/school/wordOfDayPolicyModel');
    const wordOfDayDisplayService = require('../../packages/school/MVC/services/school/wordOfDayDisplayService');
    const wordOfDayService = require('../../packages/school/MVC/services/school/wordOfDayService');
    const wordOfDayController = require('../../packages/school/MVC/controllers/school/wordOfDayController');
    const orgId = wordOfDayService.getActiveOrgId(req.user);
    const policy = await wordOfDayPolicyModel.getPolicyForOrg(orgId);
    if (policy.schoolDashboardEnabled !== false && orgId) {
      const dateKey = await wordOfDayController.resolveOrgDateKey(req.user);
      return await wordOfDayDisplayService.resolveDailyDisplay({
        orgId,
        dateKey,
        recordAnalytics: true,
        policy
      });
    }
  } catch (_err) {
    return null;
  }
  return null;
}

function getWordOfDayUiConstants() {
  return require('../../packages/school/MVC/services/school/wordOfDayUiConstants');
}

module.exports = {
  resolveWordOfDayDashboardPayload,
  getWordOfDayUiConstants
};