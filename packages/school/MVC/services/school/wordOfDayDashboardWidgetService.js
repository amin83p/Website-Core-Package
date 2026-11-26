'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const wordOfDayPolicyModel = require('../../models/school/wordOfDayPolicyModel');
const wordOfDayDisplayService = require('./wordOfDayDisplayService');
const wordOfDayService = require('./wordOfDayService');
const wordOfDayController = require('../../controllers/school/wordOfDayController');

function isUsableWordOfDayOrgId(orgId) {
  const id = String(orgId || '').trim();
  return Boolean(id) && id.toUpperCase() !== 'SYSTEM';
}

function resolveWordOfDayDashboardOrgId(user) {
  const fromActive = wordOfDayService.getActiveOrgId(user);
  if (isUsableWordOfDayOrgId(fromActive)) {
    return { orgId: fromActive, source: 'active' };
  }
  const pools = [
    ...(Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : []),
    ...(Array.isArray(user?.organizations) ? user.organizations : [])
  ];
  for (const row of pools) {
    const candidate = toPublicId(row?.orgId ?? row?.id ?? '');
    if (isUsableWordOfDayOrgId(candidate)) {
      return { orgId: candidate, source: 'membership' };
    }
  }
  return { orgId: '', source: 'none' };
}

async function resolveWordOfDayDashboardPayload(req) {
  if (!req?.user) return null;
  try {
    const { orgId } = resolveWordOfDayDashboardOrgId(req.user);
    if (!orgId) return null;
    const policy = await wordOfDayPolicyModel.getPolicyForOrg(orgId);
    if (policy.schoolDashboardEnabled === false) return null;
    const dateKey = await wordOfDayController.resolveOrgDateKey(req.user, orgId);
    return await wordOfDayDisplayService.resolveDailyDisplay({
      orgId,
      dateKey,
      recordAnalytics: true,
      policy
    });
  } catch (_err) {
    return null;
  }
}

function getWordOfDayUiConstants() {
  return require('./wordOfDayUiConstants');
}

module.exports = {
  resolveWordOfDayDashboardPayload,
  getWordOfDayUiConstants,
  resolveWordOfDayDashboardOrgId,
  isUsableWordOfDayOrgId
};