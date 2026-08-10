'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const libraryCirculationService = require('../../services/school/libraryCirculationService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');
const { PATRON_ROLES } = require('../../models/school/libraryPatronModel');

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

exports.listPolicies = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const policies = await libraryCirculationService.listOrgPolicies(orgId, req.user);
    if (isAjax(req)) return res.json({ status: 'success', results: policies });
    return res.render('school/library/policyList', {
      title: 'Library Policies',
      policies,
      patronRoles: Object.values(PATRON_ROLES),
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showEditForm = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const patronRole = String(req.params.role || '').trim().toLowerCase();
    if (!Object.values(PATRON_ROLES).includes(patronRole)) {
      throw new Error('Invalid patron role.');
    }
    const policies = await libraryCirculationService.listOrgPolicies(orgId, req.user);
    const policyItem = policies.find((row) => String(row.patronRole) === patronRole) || null;
    return res.render('school/library/policyForm', {
      title: `Library Policy — ${patronRole}`,
      policyItem,
      patronRole,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.savePolicy = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const patronRole = String(req.params.role || req.body?.patronRole || '').trim().toLowerCase();
    if (!Object.values(PATRON_ROLES).includes(patronRole)) {
      throw new Error('Invalid patron role.');
    }
    const userId = req.user?.id || 'SYSTEM';
    const payload = {
      orgId,
      patronRole,
      maxConcurrentLoans: Number(req.body?.maxConcurrentLoans || 0),
      loanPeriodDays: Number(req.body?.loanPeriodDays || 14),
      digitalAccessDays: Number(req.body?.digitalAccessDays || 30),
      allowDigitalDownload: toBoolean(req.body?.allowDigitalDownload, true),
      maxRenewals: Number(req.body?.maxRenewals || 0),
      active: toBoolean(req.body?.active, true),
      notes: String(req.body?.notes || '').trim(),
      audit: { createUser: userId, lastUpdateUser: userId }
    };

    const existingRows = await schoolDataService.fetchAllData('libraryPolicies', {}, req.user);
    const existing = (Array.isArray(existingRows) ? existingRows : []).find((row) => (
      idsEqual(row.orgId, orgId) && String(row.patronRole) === patronRole
    ));

    if (existing?.id) {
      await schoolDataService.updateData('libraryPolicies', existing.id, payload, req.user);
    } else {
      await schoolDataService.addData('libraryPolicies', payload, req.user);
    }

    const response = {
      status: 'success',
      message: 'Policy saved successfully.',
      redirectTo: '/school/library/policies'
    };
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/library/policies');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};
