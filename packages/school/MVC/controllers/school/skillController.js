'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const skillCatalogService = require('../../services/school/skillCatalogService');
const skillUsageService = require('../../services/school/skillUsageService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { getDefaultSkillDefinition, normalizeSkillCode } = require('../../../config/skillDefinitions');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const settingService = requireCoreModule('MVC/services/settingService');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem
} = requireCoreModule('MVC/utils/orgContextUtils');
const { respondSchoolDeleteError } = require('../../utils/schoolDeleteErrorResponse');

function assertOrgAccess(row, activeOrgId) {
  if (!row || !idsEqual(row.orgId, activeOrgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function buildPayload(reqBody, activeOrgId, userId) {
  return {
    orgId: activeOrgId,
    code: normalizeSkillCode(reqBody?.code),
    label: String(reqBody?.label || '').trim(),
    kind: String(reqBody?.kind || 'general').trim(),
    supportsTeachingOutline: toBoolean(reqBody?.supportsTeachingOutline, false),
    active: toBoolean(reqBody?.active, false),
    sortOrder: Number(reqBody?.sortOrder || 0),
    audit: {
      createUser: String(userId || 'SYSTEM'),
      lastUpdateUser: String(userId || 'SYSTEM')
    }
  };
}

function beginGuard(keyParts) {
  const key = idempotencyGuardService.createGuardKey(keyParts);
  const result = idempotencyGuardService.beginGuard({
    key,
    runningTtlMs: 90000,
    replayTtlMs: 12000
  });
  return { key, result };
}

function respondGuard(req, res, result, message) {
  if (!result || result.status === 'acquired') return false;
  const payload = result.status === 'replay' && result.payload
    ? { ...result.payload, idempotency: { state: 'replayed' } }
    : {
        status: 'warning',
        message,
        idempotency: { state: 'busy', retryAfterMs: Number(result.retryAfterMs || 0) }
      };
  if (isAjax(req)) res.status(result.status === 'busy' ? 409 : 200).json(payload);
  else res.redirect(payload.redirectTo || '/school/skills');
  return true;
}

exports.listSkills = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const canCreateSkills = await canCreateOrgScopedItem(req.user, { scopeLabel: 'skills' });
    if (skillCatalogService.isRealOrganizationId(orgId)) {
      await skillCatalogService.ensureOrgDefaultSkills(orgId, req.user?.id || 'SYSTEM');
    }
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    let rows = await skillCatalogService.listOrgSkills(orgId, { includeInactive: true });
    rows = rows.sort((a, b) => {
      const orderA = Number(a?.sortOrder || 0);
      const orderB = Number(b?.sortOrder || 0);
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.label || a?.code || '').localeCompare(String(b?.label || b?.code || ''));
    });

    const searchableFields = ['code', 'label', 'kind'];
    rows = applyGenericFilter(rows, query, { defaultSearchFields: searchableFields });
    const { data, pagination } = paginate(rows, query.page, query.limit);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    return res.render('school/skill/skillList', {
      title: 'Skills',
      tableName: 'School_Skills',
      data,
      newUrl: 'school/skills',
      newLabel: canCreateSkills ? 'New Skill' : null,
      canCreateSkills,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showCreateForm = async (req, res) => {
  try {
    const orgId = await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'skills' });
    await skillCatalogService.ensureOrgDefaultSkills(orgId, req.user?.id || 'SYSTEM');
    return res.render('school/skill/skillForm', {
      title: 'New Skill',
      skillItem: null,
      codeLocked: false,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showEditForm = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const row = await schoolDataService.getDataById('skills', req.params.id, req.user);
    if (!row) throw new Error('Skill not found.');
    assertOrgAccess(row, orgId);
    const usages = await skillUsageService.findSkillUsage(row.code, orgId, req.user);
    return res.render('school/skill/skillForm', {
      title: 'Edit Skill',
      skillItem: row,
      codeLocked: Boolean(getDefaultSkillDefinition(row.code) || usages.length),
      usageCount: usages.length,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveSkill = async (req, res) => {
  let guardKey = '';
  try {
    const id = String(req.params?.id || '').trim();
    const orgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'skills' });
    const guard = beginGuard(['school_skill_save', orgId, id, req.body || {}]);
    guardKey = guard.key;
    if (respondGuard(req, res, guard.result, 'Skill save is already in progress. Please wait.')) return;
    if (id) {
      const existing = await schoolDataService.getDataById('skills', id, req.user);
      if (!existing) throw new Error('Skill not found.');
      assertOrgAccess(existing, orgId);
      const payload = buildPayload(req.body, existing.orgId, req.user?.id || 'SYSTEM');
      if (normalizeSkillCode(existing.code) !== payload.code) {
        if (getDefaultSkillDefinition(existing.code)) {
          throw new Error('Default skill codes are stable identifiers and cannot be changed.');
        }
        const usages = await skillUsageService.findSkillUsage(existing.code, orgId, req.user);
        if (usages.length) {
          throw new Error('This skill code cannot be changed because it is referenced by classes, sessions, or teaching outlines.');
        }
      }
      await schoolDataService.updateData('skills', id, payload, req.user);
    } else {
      const payload = buildPayload(req.body, orgId, req.user?.id || 'SYSTEM');
      await schoolDataService.addData('skills', payload, req.user);
    }
    const response = {
      status: 'success',
      message: id ? 'Skill updated successfully.' : 'Skill created successfully.',
      redirectTo: '/school/skills'
    };
    idempotencyGuardService.completeGuard(guardKey, response);
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/skills');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.deleteSkill = async (req, res) => {
  let guardKey = '';
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    if (!skillCatalogService.isRealOrganizationId(orgId)) {
      throw new Error('<b>Organization Required</b><br>Switch to a valid organization before deleting skills.');
    }
    const id = String(req.params?.id || '').trim();
    const guard = beginGuard(['school_skill_delete', orgId, id]);
    guardKey = guard.key;
    if (respondGuard(req, res, guard.result, 'Skill delete is already in progress. Please wait.')) return;
    const existing = await schoolDataService.getDataById('skills', id, req.user);
    if (!existing) throw new Error('Skill not found.');
    assertOrgAccess(existing, orgId);
    await schoolDataService.deleteData('skills', id, req.user);
    const response = { status: 'success', message: 'Skill deleted successfully.', redirectTo: '/school/skills' };
    idempotencyGuardService.completeGuard(guardKey, response);
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/skills');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return respondSchoolDeleteError(req, res, error, { user: req.user });
  }
};
