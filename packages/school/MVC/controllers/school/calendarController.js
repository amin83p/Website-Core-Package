const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const schoolCalendarService = require('../../services/school/schoolCalendarService');
const activityService = require('../../services/school/activityService');
const scheduleController = require('./scheduleController');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

function normalizeId(value) {
  return String(value == null ? '' : value).trim();
}

function getUserPersonId(reqUser = {}) {
  return normalizeId(
    reqUser.personId
    || reqUser.person?.id
    || reqUser.person?._id
    || reqUser.profile?.personId
    || reqUser.account?.personId
  );
}

function getActiveOrgId(reqUser = {}) {
  return normalizeId(
    reqUser.activeOrgId
    || reqUser.activeOrganizationId
    || reqUser.currentOrgId
    || reqUser.currentOrganizationId
    || reqUser.selectedOrgId
    || reqUser.orgId
    || reqUser.organizationId
    || reqUser.activeOrg?.id
    || reqUser.organization?.id
  );
}

function isCalendarAdminViewer(reqUser) {
  return Boolean(adminChekersService.isAdminForRequest(reqUser, SECTIONS.SCHOOL_CALENDAR, OPERATIONS.READ_ALL, {
    orgId: reqUser?.activeOrgId,
    section: { id: SECTIONS.SCHOOL_CALENDAR, category: 'SCHOOL' }
  }));
}

function jsonError(res, error, fallback = 'Unable to load School Calendar data.') {
  return res.status(error?.statusCode || 500).json({
    status: 'error',
    message: error?.message || fallback
  });
}

async function buildCalendarAccess(reqUser) {
  const scheduleAccess = await scheduleController.buildScheduleViewerAccess(reqUser);
  const canSelectAnyPerson = isCalendarAdminViewer(reqUser) || Boolean(scheduleAccess.canSelectAnyPerson);
  return {
    ...scheduleAccess,
    canSelectAnyPerson
  };
}

async function resolveCalendarPerson(reqUser, personId) {
  const effectivePersonId = normalizeId(personId);
  if (!effectivePersonId) return null;
  const rows = await scheduleController.buildSchoolSchedulePersonPickerRows({
    activeOrgId: getActiveOrgId(reqUser),
    reqUser
  });
  return (Array.isArray(rows) ? rows : []).find((row) => normalizeId(row.personId || row.id) === effectivePersonId) || null;
}

function paginateRows(rows = [], query = {}) {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.max(1, Math.min(100, Number.parseInt(String(query.limit || '20'), 10) || 20));
  const start = (page - 1) * limit;
  return {
    rows: rows.slice(start, start + limit),
    pagination: {
      page,
      currentPage: page,
      limit,
      pageSize: limit,
      totalItems: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / limit))
    }
  };
}

async function showCalendarPage(req, res) {
  try {
    const calendarAccess = await buildCalendarAccess(req.user);
    const orgId = getActiveOrgId(req.user);
    const calendarActivityCategories = await activityService.listActivityCategories({
      orgId,
      reqUser: req.user,
      includeInactive: false
    });
    const activeRoleKeys = (Array.isArray(calendarAccess?.availableRoles) ? calendarAccess.availableRoles : [])
      .map((role) => normalizeId(role?.key || role))
      .filter(Boolean);
    res.render('school/calendar/calendar', {
      title: 'School Calendar',
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId || '',
      calendarAccess,
      calendarActivityCategories: (Array.isArray(calendarActivityCategories) ? calendarActivityCategories : [])
        .map((category) => {
          const categoryId = normalizeId(category?.id);
          return {
            id: categoryId,
            name: String(category?.name || category?.code || categoryId).trim(),
            code: String(category?.code || '').trim(),
            layerKey: schoolCalendarService.buildActivityCategoryLayerKey(categoryId),
            defaultPaid: category?.defaultPaid === true
          };
        })
        .filter((category) => category.id && category.layerKey),
      calendarActiveRoleKeys: activeRoleKeys,
      calendarLayerStorageKey: `schoolCalendar:selectedLayers:${orgId || 'global'}`
    });
  } catch (error) {
    console.error('[SchoolCalendar] render failed:', error);
    res.status(500).render('error', {
      title: 'School Calendar',
      message: error.message || 'Unable to load School Calendar.'
    });
  }
}

async function getCalendarEvents(req, res) {
  try {
    const calendarAccess = await buildCalendarAccess(req.user);
    let effectivePersonId = normalizeId(req.query.personId);
    let selectedPerson = null;

    if (!calendarAccess.canSelectAnyPerson) {
      effectivePersonId = normalizeId(calendarAccess.lockedPersonId);
      selectedPerson = {
        id: effectivePersonId,
        personId: effectivePersonId,
        displayName: calendarAccess.lockedPersonName || 'My Schedule',
        roles: calendarAccess.availableRoles || []
      };
    } else {
      effectivePersonId = effectivePersonId || getUserPersonId(req.user);
      selectedPerson = await resolveCalendarPerson(req.user, effectivePersonId);
    }

    const result = await schoolCalendarService.getCalendarEvents({
      reqUser: req.user,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      layers: req.query.layers,
      personId: effectivePersonId,
      selectedPerson
    });

    res.json({
      status: 'success',
      ...result
    });
  } catch (error) {
    console.error('[SchoolCalendar] api/events failed:', error);
    jsonError(res, error);
  }
}

async function pickCalendarPersons(req, res) {
  try {
    const calendarAccess = await buildCalendarAccess(req.user);
    if (!calendarAccess.canSelectAnyPerson) {
      return res.status(403).json({
        status: 'error',
        message: 'Only School Calendar administrators can select another person.'
      });
    }

    const q = String(req.query.q || req.query.search || '').trim().toLowerCase();
    const allRows = await scheduleController.buildSchoolSchedulePersonPickerRows({
      activeOrgId: getActiveOrgId(req.user),
      reqUser: req.user
    });
    const filteredRows = q
      ? (Array.isArray(allRows) ? allRows : []).filter((row) => String(row.searchText || '').toLowerCase().includes(q))
      : (Array.isArray(allRows) ? allRows : []);
    const { rows: pageRows, pagination } = paginateRows(filteredRows, req.query);
    const rows = pageRows.map((row) => {
      const source = row && typeof row === 'object' ? row : {};
      const personId = normalizeId(source.personId || source.id);
      const { searchText, ...cleanSource } = source;
      return {
        ...cleanSource,
        id: source.id || personId,
        personId
      };
    });
    res.json({
      status: 'success',
      rows,
      results: rows,
      data: rows,
      pagination
    });
  } catch (error) {
    console.error('[SchoolCalendar] person picker failed:', error);
    jsonError(res, error, 'Unable to search School Calendar people.');
  }
}

module.exports = {
  showCalendarPage,
  getCalendarEvents,
  pickCalendarPersons
};
