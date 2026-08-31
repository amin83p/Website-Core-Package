const routingPolicyModel = require('../../models/school/sessionStudentCaseRoutingPolicyModel');
const sessionStudentCaseModel = require('../../models/school/sessionStudentCaseModel');
const personDisplayNameService = require('./personDisplayNameService');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const { normalizeCategory, CASE_CATEGORY_LABELS } = require('./sessionStudentCasePresetService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function cleanString(value, max = 5000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  const token = cleanString(value, 20).toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(token);
}

function getActiveOrgId(user) {
  return toPublicId(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId || '');
}

function getActorId(user) {
  return toPublicId(user?.id || user?._id || user?.userId || user?.username || '');
}

function getViewerPersonId(user) {
  return toPublicId(user?.personId || user?.person?.id || user?.profile?.personId || '');
}

function isRoutingAdminViewer(user) {
  return schoolAdminAccessService.isStudentCaseRoutingAdminViewer(user);
}

function assertRoutingAdmin(user) {
  if (isRoutingAdminViewer(user)) return;
  const error = new Error('Only student case routing administrators can manage category routing.');
  error.statusCode = 403;
  throw error;
}

function emptyPolicy() {
  return { categories: {} };
}

function normalizeAssignee(input = {}) {
  const personId = toPublicId(input.personId || input.assigneePersonId || input.id || '');
  if (!personId) return null;
  return {
    personId,
    personName: cleanString(input.personName || input.assigneePersonName || input.name || personId, 180)
  };
}

function normalizeCategoryRouting(input = {}, categoryKey = '') {
  const category = normalizeCategory(categoryKey || input.category || 'other');
  const active = input.active === false || normalizeBoolean(input.active) === false ? false : true;
  const assignees = (Array.isArray(input.assignees) ? input.assignees : [])
    .map((row) => normalizeAssignee(row))
    .filter(Boolean);
  const unique = [];
  const seen = new Set();
  assignees.forEach((row) => {
    if (seen.has(row.personId)) return;
    seen.add(row.personId);
    unique.push(row);
  });
  return {
    category,
    active,
    assignees: unique
  };
}

function normalizePolicyInput(input = {}) {
  const categoriesInput = input.categories && typeof input.categories === 'object' ? input.categories : {};
  const categories = {};
  const keys = new Set([
    ...(sessionStudentCaseModel.CASE_CATEGORIES || []),
    ...Object.keys(categoriesInput || {})
  ]);
  keys.forEach((categoryKey) => {
    const normalized = normalizeCategoryRouting(categoriesInput[categoryKey] || {}, categoryKey);
    categories[normalized.category] = {
      active: normalized.active,
      assignees: normalized.assignees
    };
  });
  return { categories };
}

function normalizeStoredPolicy(row = {}) {
  const categoriesInput = row.categories && typeof row.categories === 'object' ? row.categories : {};
  return normalizePolicyInput({ categories: categoriesInput });
}

async function enrichAssigneeNames(assignees = []) {
  return Promise.all((Array.isArray(assignees) ? assignees : []).map(async (row) => {
    const personId = toPublicId(row?.personId || '');
    if (!personId) return null;
    const personName = await personDisplayNameService.resolvePersonDisplayName(personId, {
      fallback: cleanString(row?.personName || personId, 180)
    });
    return { personId, personName: cleanString(personName || row?.personName || personId, 180) };
  })).then((rows) => rows.filter(Boolean));
}

async function enrichPolicyForDisplay(policy = emptyPolicy()) {
  const categories = {};
  const entries = Object.entries(policy.categories || {});
  await Promise.all(entries.map(async ([category, config]) => {
    categories[category] = {
      active: config?.active !== false,
      assignees: await enrichAssigneeNames(config?.assignees || [])
    };
  }));
  return { categories };
}

async function getRoutingPolicyForOrg(orgId) {
  const row = await routingPolicyModel.getOrgPolicyRow(orgId);
  return normalizeStoredPolicy(row);
}

async function saveRoutingPolicyForOrg(orgId, input, auditUserId = '') {
  const normalized = normalizePolicyInput(input);
  const enriched = await enrichPolicyForDisplay(normalized);
  await routingPolicyModel.saveOrgPolicyRow(orgId, enriched, auditUserId);
  return enriched;
}

function getCategoryConfig(policy = emptyPolicy(), category = '') {
  const key = normalizeCategory(category);
  const config = policy?.categories?.[key];
  if (!config || config.active === false) return null;
  const assignees = (Array.isArray(config.assignees) ? config.assignees : [])
    .map((row) => normalizeAssignee(row))
    .filter(Boolean);
  if (!assignees.length) return null;
  return { category: key, active: true, assignees };
}

function getActiveAssigneePersonIdsForCategory(policy = emptyPolicy(), category = '') {
  const config = getCategoryConfig(policy, category);
  if (!config) return [];
  return config.assignees.map((row) => row.personId).filter(Boolean);
}

function isPersonAssignedToCategory(policy = emptyPolicy(), category = '', personId = '') {
  const targetPersonId = toPublicId(personId);
  if (!targetPersonId) return false;
  const assigneeIds = getActiveAssigneePersonIdsForCategory(policy, category);
  return assigneeIds.some((id) => idsEqual(id, targetPersonId));
}

function isCaseRoutedToPerson(caseRow = {}, personId = '', policy = emptyPolicy()) {
  const targetPersonId = toPublicId(personId);
  if (!caseRow || !targetPersonId) return false;
  const category = normalizeCategory(caseRow.category || 'other');
  return isPersonAssignedToCategory(policy, category, targetPersonId);
}

function getRoutedCategoriesForPerson(policy = emptyPolicy(), personId = '') {
  const targetPersonId = toPublicId(personId);
  if (!targetPersonId) return [];
  return (sessionStudentCaseModel.CASE_CATEGORIES || []).filter((category) => (
    isPersonAssignedToCategory(policy, category, targetPersonId)
  ));
}

function listCategoryDefinitions() {
  return (sessionStudentCaseModel.CASE_CATEGORIES || []).map((category) => ({
    category,
    label: CASE_CATEGORY_LABELS[category] || category
  }));
}

async function getRoutingPageData(reqUser) {
  assertRoutingAdmin(reqUser);
  const orgId = getActiveOrgId(reqUser);
  if (!orgId) throw new Error('Active organization is required.');
  const policy = await enrichPolicyForDisplay(await getRoutingPolicyForOrg(orgId));
  return {
    orgId,
    policy,
    categories: listCategoryDefinitions()
  };
}

async function saveRoutingFromRequest(reqUser, input = {}) {
  assertRoutingAdmin(reqUser);
  const orgId = getActiveOrgId(reqUser);
  if (!orgId) throw new Error('Active organization is required.');
  return saveRoutingPolicyForOrg(orgId, input, getActorId(reqUser));
}

module.exports = {
  emptyPolicy,
  getActiveOrgId,
  getViewerPersonId,
  isRoutingAdminViewer,
  assertRoutingAdmin,
  normalizePolicyInput,
  getRoutingPolicyForOrg,
  saveRoutingPolicyForOrg,
  getActiveAssigneePersonIdsForCategory,
  isPersonAssignedToCategory,
  isCaseRoutedToPerson,
  getRoutedCategoriesForPerson,
  listCategoryDefinitions,
  getRoutingPageData,
  saveRoutingFromRequest,
  enrichPolicyForDisplay
};
