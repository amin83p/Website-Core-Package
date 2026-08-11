'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const libraryLocationService = require('../../services/school/libraryLocationService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem
} = requireCoreModule('MVC/utils/orgContextUtils');
const { respondSchoolDeleteError } = require('../../utils/schoolDeleteErrorResponse');
const {
  LOCATION_TYPES,
  getChildTypeForParent
} = require('../../models/school/libraryLocationModel');

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function assertOrgAccess(row, activeOrgId) {
  if (!row || !idsEqual(row.orgId, activeOrgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

function typeLabel(type) {
  const map = {
    building: 'Building',
    floor: 'Floor',
    room: 'Room',
    shelf: 'Shelf',
    spot: 'Spot'
  };
  return map[String(type || '').toLowerCase()] || type;
}

function buildLocationPayload(req, orgId, locationType, parentId, userId) {
  const payload = {
    orgId,
    parentId: parentId || null,
    locationType,
    name: String(req.body?.name || '').trim(),
    code: String(req.body?.code || '').trim(),
    sortOrder: Number(req.body?.sortOrder || 0),
    active: toBoolean(req.body?.active, true),
    notes: String(req.body?.notes || '').trim(),
    audit: { createUser: userId, lastUpdateUser: userId }
  };
  return payload;
}

function buildLocationUpdatePayload(req, userId) {
  const payload = {
    name: String(req.body?.name || '').trim(),
    code: String(req.body?.code || '').trim(),
    sortOrder: Number(req.body?.sortOrder || 0),
    active: toBoolean(req.body?.active, true),
    notes: String(req.body?.notes || '').trim(),
    audit: { lastUpdateUser: userId }
  };
  return payload;
}

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000 || /E11000 duplicate key/i.test(String(error?.message || ''));
}

function formatLocationSaveError(error) {
  if (isDuplicateKeyError(error)) {
    return 'Location code is already used for this organization. Leave Code blank or enter a unique code.';
  }
  return error?.message || 'Unable to save location.';
}

exports.listLocations = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const canCreate = await canCreateOrgScopedItem(req.user, { scopeLabel: 'library locations' });
    const rows = await libraryLocationService.listOrgLocations(orgId, req.user);
    const tree = libraryLocationService.buildLocationTree(rows, { includeInactive: true });
    if (isAjax(req)) return res.json({ status: 'success', results: tree });
    return res.render('school/library/locationTree', {
      title: 'Library Locations',
      tree,
      canCreate,
      locationTypes: LOCATION_TYPES,
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
    const orgId = await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'library locations' });
    const parentId = String(req.query?.parentId || '').trim();
    let parent = null;
    let locationType = LOCATION_TYPES.BUILDING;
    if (parentId) {
      parent = await schoolDataService.getDataById('libraryLocations', parentId, req.user);
      if (!parent) throw new Error('Parent location not found.');
      assertOrgAccess(parent, orgId);
      locationType = getChildTypeForParent(parent.locationType);
      if (!locationType) throw new Error('This location type cannot have children.');
    }
    return res.render('school/library/locationForm', {
      title: parent ? `New ${typeLabel(locationType)}` : 'New Building',
      locationItem: null,
      parent,
      locationType,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showEditForm = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const row = await schoolDataService.getDataById('libraryLocations', req.params.id, req.user);
    if (!row) throw new Error('Library location not found.');
    assertOrgAccess(row, orgId);
    let parent = null;
    if (row.parentId) {
      parent = await schoolDataService.getDataById('libraryLocations', row.parentId, req.user);
    }
    return res.render('school/library/locationForm', {
      title: `Edit ${typeLabel(row.locationType)}`,
      locationItem: row,
      parent,
      locationType: row.locationType,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveLocation = async (req, res) => {
  try {
    const id = String(req.params?.id || '').trim();
    const orgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'library locations' });
    const userId = req.user?.id || 'SYSTEM';

    if (id) {
      const existing = await schoolDataService.getDataById('libraryLocations', id, req.user);
      if (!existing) throw new Error('Library location not found.');
      assertOrgAccess(existing, orgId);
      await schoolDataService.updateData('libraryLocations', id, buildLocationUpdatePayload(req, userId), req.user);
    } else {
      const parentId = String(req.body?.parentId || '').trim();
      let locationType = String(req.body?.locationType || '').trim().toLowerCase();
      if (!locationType && !parentId) locationType = LOCATION_TYPES.BUILDING;
      if (parentId) {
        const parent = await schoolDataService.getDataById('libraryLocations', parentId, req.user);
        if (!parent) throw new Error('Parent location not found.');
        assertOrgAccess(parent, orgId);
        locationType = getChildTypeForParent(parent.locationType);
      }
      await schoolDataService.addData('libraryLocations', buildLocationPayload(req, orgId, locationType, parentId, userId), req.user);
    }

    const response = {
      status: 'success',
      message: id ? 'Location updated successfully.' : 'Location created successfully.',
      redirectTo: '/school/library/locations'
    };
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/library/locations');
  } catch (error) {
    const message = formatLocationSaveError(error);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message });
    return res.status(400).render('error', { title: 'Error', message, user: req.user });
  }
};

exports.deactivateLocation = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const row = await schoolDataService.getDataById('libraryLocations', req.params.id, req.user);
    if (!row) throw new Error('Library location not found.');
    assertOrgAccess(row, orgId);
    const userId = req.user?.id || 'SYSTEM';
    await schoolDataService.updateData('libraryLocations', row.id, {
      active: false,
      audit: { lastUpdateUser: userId }
    }, req.user);
    const response = {
      status: 'success',
      message: 'Location deactivated.',
      redirectTo: '/school/library/locations'
    };
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/library/locations');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.deleteLocation = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const row = await schoolDataService.getDataById('libraryLocations', req.params.id, req.user);
    if (!row) throw new Error('Library location not found.');
    assertOrgAccess(row, orgId);

    const orgRows = await libraryLocationService.listOrgLocations(orgId, req.user);
    const hasChildren = orgRows.some((child) => String(child.parentId || '') === String(row.id));
    if (hasChildren) throw new Error('Cannot delete a location that has child locations.');

    if (String(row.locationType) === LOCATION_TYPES.SPOT) {
      const copyCount = await libraryLocationService.countCopiesAtLocation(row.id, req.user);
      if (copyCount > 0) {
        throw new Error('Cannot delete a spot that is assigned to library copies.');
      }
    }

    await schoolDataService.deleteData('libraryLocations', row.id, req.user);
    const response = {
      status: 'success',
      message: 'Location deleted successfully.',
      redirectTo: '/school/library/locations'
    };
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/library/locations');
  } catch (error) {
    return respondSchoolDeleteError(req, res, error, { fallbackRedirect: '/school/library/locations' });
  }
};

exports.apiAssignableSpots = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const rows = await libraryLocationService.listOrgLocations(orgId, req.user);
    const spots = libraryLocationService.listAssignableSpots(rows);
    return res.json({ status: 'success', results: spots });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
