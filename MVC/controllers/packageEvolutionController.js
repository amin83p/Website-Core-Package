'use strict';

const packageEvolutionService = require('../services/packageEvolutionService');
const packageEvolutionAccessService = require('../services/packageEvolutionAccessService');
const packageEvolutionItemRepository = require('../repositories/packageEvolutionItemRepository');
const packageEvolutionItemModel = require('../models/packageEvolutionItemModel');

function isAjax(req) {
  return req?.xhr
    || req?.headers?.['x-requested-with'] === 'XMLHttpRequest'
    || String(req?.headers?.accept || '').includes('application/json');
}

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function mapTimelineRow(row = {}) {
  return {
    id: row.id,
    packageName: row.packageName,
    commitSha: row.commitSha,
    commitShortHash: row.commitShortHash,
    committedAt: row.committedAt,
    changeType: row.changeType,
    title: row.title,
    description: row.description,
    purpose: row.purpose,
    team: row.team,
    budget: row.budget,
    taskDuration: row.taskDuration,
    technical: row.technical,
    status: row.status,
    source: row.source
  };
}

async function showTimeline(req, res) {
  if (!packageEvolutionAccessService.canViewPackageEvolution(req.user)) {
    return res.status(403).render('error', {
      title: 'Access denied',
      message: 'You do not have access to package evolution timeline.',
      user: req.user
    });
  }
  const packages = packageEvolutionAccessService.resolveAccessiblePackagesSync(req.user);
  return res.render('packageEvolution/timeline', {
    title: 'Package evolution',
    user: req.user,
    packages,
    defaultPackage: packages[0] || 'CORE'
  });
}

async function getTimelineApi(req, res) {
  try {
    if (!packageEvolutionAccessService.canViewPackageEvolution(req.user)) {
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }
    const allowed = packageEvolutionAccessService.resolveAccessiblePackagesSync(req.user);
    const requested = cleanText(req.query.packageName, 80).toUpperCase();
    const packageNames = requested
      ? (packageEvolutionAccessService.assertPackageAccess(req.user, requested) ? [requested] : [])
      : allowed;
    if (!packageNames.length) {
      return res.json({ status: 'success', items: [], packages: allowed });
    }
    const rows = await packageEvolutionService.listTimelineRows({
      packageNames,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status || 'published',
      page: req.query.page,
      limit: req.query.limit
    });
    return res.json({
      status: 'success',
      packages: allowed,
      packageFilter: requested || '',
      items: rows.map(mapTimelineRow)
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to load timeline.' });
  }
}

async function listManage(req, res) {
  const query = {
    page: req.query.page || 1,
    limit: req.query.limit || 100,
    sort: '-committedAt'
  };
  if (req.query.status) query.status__eq = cleanText(req.query.status, 40).toLowerCase();
  if (req.query.packageName) query.packageName__eq = cleanText(req.query.packageName, 80).toUpperCase();
  const rows = await packageEvolutionItemRepository.list({ query });
  return res.render('packageEvolution/manage', {
    title: 'Package evolution records',
    user: req.user,
    rows,
    changeTypes: packageEvolutionItemModel.CHANGE_TYPES,
    statuses: packageEvolutionItemModel.STATUSES
  });
}

async function postImportApi(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const items = Array.isArray(body.items) ? body.items : [];
    const result = await packageEvolutionService.importItems(
      { items },
      {
        actorUserId: req.user?.id,
        publish: body.publish === true || body.publish === 'true'
      }
    );
    const payload = { status: 'success', created: result.created, updated: result.updated, total: result.rows.length };
    if (isAjax(req)) return res.json(payload);
    return res.redirect('/systemSettings/package-evolution');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Import failed', message: error.message, user: req.user });
  }
}

async function postItemApi(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const id = cleanText(body.id, 120);
    const patch = { ...body, updatedByUserId: req.user?.id };
    if (!patch.createdByUserId) patch.createdByUserId = req.user?.id;
    const row = id
      ? await packageEvolutionItemRepository.update(id, patch)
      : await packageEvolutionItemRepository.create(patch);
    if (isAjax(req)) return res.json({ status: 'success', item: row });
    return res.redirect('/systemSettings/package-evolution');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Save failed', message: error.message, user: req.user });
  }
}

module.exports = {
  showTimeline,
  getTimelineApi,
  listManage,
  postImportApi,
  postItemApi
};