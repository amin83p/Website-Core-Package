const { applyGenericFilter } = require('../utils/queryEngine');
const { registerEntityQueryExecutor, clearEntityQueryExecutors } = require('./queryExecutionBridge');
const { toIdArray, toPublicId, idsEqual } = require('../utils/idAdapter');
const { normalizeBackendMode } = require('../../config/dataBackend');
const newsVisibilityService = require('../services/newsVisibilityService');

const userModel = require('./userModel');
const personModel = require('./personModel');
const organizationModel = require('./organizationModel');
const contractModel = require('./contractModel');
const sectionModel = require('./sectionModel');
const operationModel = require('./operationModel');
const roleModel = require('./roleModel');
const scopeModel = require('./scopeModel');
const accessModel = require('./accessModel');
const accessPolicyModel = require('./accessPolicyModel');
const tableSettingsModel = require('./tableSettingsModel');
const logModel = require('./logModel');
const actionStateModel = require('./actionStateModel');
const orgPolicyModel = require('./orgPolicyModel');
const symbolModel = require('./symbolModel');
const sessionModel = require('./sessionModel');
const newsModel = require('./newsModel');
const contactModel = require('./contactModel');
const newsletterSubscriptionModel = require('./newsletterSubscriptionModel');
const subscriptionGroupModel = require('./subscriptionGroupModel');
const chatModel = require('./chatModel');
const taskModel = require('./taskModel');
const helpArticleModel = require('./helpArticleModel');

let registeredBackendMode = null;

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function applyCanViewAllScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  return scope?.canViewAll === false ? [] : list;
}

function applyIdScope(rows, scope = {}, scopeKey, rowKey = 'id') {
  const list = normalizeRows(rows);
  if (scope?.canViewAll !== false) return list;

  const allowed = Array.isArray(scope?.[scopeKey]) ? toIdArray(scope[scopeKey]) : [];
  if (!allowed.length) return [];
  const allowedSet = new Set(allowed);

  return list.filter((row) => allowedSet.has(toPublicId(row?.[rowKey])));
}

function applyUserScope(rows, scope = {}) {
  return applyIdScope(rows, scope, 'userIds', 'id');
}

function applyPersonScope(rows, scope = {}) {
  return applyIdScope(rows, scope, 'personIds', 'id');
}

function applyOrganizationScope(rows, scope = {}) {
  return applyIdScope(rows, scope, 'orgIds', 'id');
}

function applySectionScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll !== false) return list;

  const categories = Array.isArray(scope?.categories)
    ? new Set(scope.categories.map((cat) => String(cat)))
    : new Set();
  const sectionIds = Array.isArray(scope?.sectionIds)
    ? new Set(toIdArray(scope.sectionIds))
    : new Set();

  return list.filter((row) => {
    const rowCategory = String(row?.category || '');
    const rowId = toPublicId(row?.id);
    return categories.has(rowCategory) || sectionIds.has(rowId);
  });
}

function applyAccessScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll !== false) return list;

  const includeGlobal = scope?.includeGlobal !== false;
  const orgId = toPublicId(scope?.orgId) || null;

  return list.filter((row) => {
    const rowOrgId = toPublicId(row?.orgId) || null;
    if (includeGlobal && !rowOrgId) return true;
    if (orgId && idsEqual(rowOrgId, orgId)) return true;
    return false;
  });
}

function applyAccessPolicyScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll !== false) return list;
  return applyIdScope(list, scope, 'userIds', 'userId');
}

function applyTableSettingsScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll !== false) return list;

  const userId = toPublicId(scope?.userId) || null;
  if (!userId) return [];
  return list.filter((row) => idsEqual(row?.userId, userId));
}

function applyOrgPolicyScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll !== false) return list;
  return applyIdScope(list, scope, 'orgIds', 'orgId');
}

function applySymbolScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll !== false) return list;

  const includeGlobal = scope?.includeGlobal !== false;
  const orgId = toPublicId(scope?.orgId) || null;

  return list.filter((row) => {
    const rowOrgId = toPublicId(row?.orgId) || null;
    if (includeGlobal && (!rowOrgId || rowOrgId === 'SYSTEM')) return true;
    if (orgId && idsEqual(rowOrgId, orgId)) return true;
    return false;
  });
}

function applySessionScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll !== false) return list;

  const userId = toPublicId(scope?.userId) || null;
  if (!userId) return [];
  return list.filter((row) => idsEqual(row?.userId, userId));
}

function applyAuthenticatedScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll !== false) return list;
  return scope?.isAuthenticated ? list : [];
}

function applyNewsScope(rows, scope = {}) {
  return newsVisibilityService.filterVisibleNews(normalizeRows(rows), scope);
}

function applySubscriptionGroupScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll !== false) return list;
  return applyIdScope(list, scope, 'orgIds', 'orgId');
}

function applyChatConversationScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll === true) return list;
  const scopedUserId = toPublicId(scope?.userId);
  if (!scopedUserId) return [];
  return list.filter((conversation) => {
    const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
    return participants.some((participant) => idsEqual(participant?.userId, scopedUserId));
  });
}

function applyTaskScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll === true) return list;
  if (scope?.denyAll === true) return [];
  const scopedUserId = toPublicId(scope?.userId);
  if (!scopedUserId) return [];
  return list.filter((task) => {
    const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
    return assignees.some((assignee) => idsEqual(assignee?.userId, scopedUserId));
  });
}

function applyHelpArticleScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll === true) return list;
  return list.filter((item) => item?.active !== false);
}

function createExecutor(getRows, applyScope) {
  return async (plan = {}) => {
    const rows = normalizeRows(await getRows(plan));
    const scopedRows = typeof applyScope === 'function'
      ? applyScope(rows, plan.scope || {})
      : rows;
    return applyGenericFilter(scopedRows, plan.query || {}, plan.fallback || {});
  };
}

function registerCoreEntityQueryExecutors(options = {}) {
  const backendMode = normalizeBackendMode(options?.backendMode || 'json');
  if (registeredBackendMode === backendMode) return;

  clearEntityQueryExecutors();
  registeredBackendMode = backendMode;

  if (backendMode !== 'json') {
    // In non-JSON mode, repositories are responsible for backend execution selection.
    // Model-level JSON query executors are not required.
    return;
  }

  const executors = [
    ['users', createExecutor(userModel.getAllUsers, applyUserScope)],
    ['persons', createExecutor(personModel.getAllPersons, applyPersonScope)],
    ['organizations', createExecutor(organizationModel.getAllOrganizations, applyOrganizationScope)],
    ['contracts', createExecutor(contractModel.getAllContracts, applyCanViewAllScope)],
    ['sections', createExecutor(sectionModel.getAllSections, applySectionScope)],
    ['operations', createExecutor(operationModel.getAllOperations, applyCanViewAllScope)],
    ['roles', createExecutor(roleModel.getAllRoles, applyCanViewAllScope)],
    ['scopes', createExecutor(scopeModel.getAllScopes, applyCanViewAllScope)],
    ['accesses', createExecutor(accessModel.getAllAccesses, applyAccessScope)],
    ['accesspolicies', createExecutor(accessPolicyModel.getAllPolicies, applyAccessPolicyScope)],
    ['tablesettings', createExecutor(tableSettingsModel.getAllSettings, applyTableSettingsScope)],
    ['logs', createExecutor(logModel.getAllLogs, applyCanViewAllScope)],
    ['actionstates', createExecutor(actionStateModel.getAllActionStates, applyCanViewAllScope)],
    ['orgpolicies', createExecutor(orgPolicyModel.getAllPolicies, applyOrgPolicyScope)],
    ['symbols', createExecutor(symbolModel.getAllSymbols, applySymbolScope)],
    ['sessions', createExecutor(sessionModel.getAllSessions, applySessionScope)],
    ['news', createExecutor(newsModel.getAllNews, applyNewsScope)],
    ['contacts', createExecutor(contactModel.getAllContactMessages, applyAuthenticatedScope)],
    ['newslettersubscriptions', createExecutor(newsletterSubscriptionModel.getAllSubscriptions, applyAuthenticatedScope)],
    ['subscriptiongroups', createExecutor(subscriptionGroupModel.getAllGroups, applySubscriptionGroupScope)],
    ['chatConversations', createExecutor(chatModel.getAllConversations, applyChatConversationScope)],
    ['tasks', createExecutor(() => taskModel.getAllTasks({ isSuperAdmin: true }), applyTaskScope)],
    ['helpArticles', createExecutor(helpArticleModel.getAllArticles, applyHelpArticleScope)]
  ];

  executors.forEach(([entityName, executor]) => registerEntityQueryExecutor(entityName, executor));
}

module.exports = {
  registerCoreEntityQueryExecutors
};
