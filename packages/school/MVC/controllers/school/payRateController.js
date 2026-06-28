// MVC/controllers/school/payRateController.js
const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const dataService1 = requireCoreModule('MVC/services/dataService');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields, normalizeSearchKeyword } = requireCoreModule('MVC/utils/generalTools');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { COMPENSATION_METHODS } = require('../../models/school/teacherModel');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const schoolIdentityLookupService = require('../../services/school/schoolIdentityLookupService');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

function getActiveOrgIdOrThrow(reqUser) {
  const activeOrgId = reqUser?.activeOrgId ? String(reqUser.activeOrgId) : '';
  if (!activeOrgId) throw new Error('<b>Security Violation</b><br>No active organization context found.');
  return activeOrgId;
}

function assertOwnerOrgAccess(owner, activeOrgId, reqUser) {
  if (!owner) return;
  if (adminChekersService.isSuperAdmin(reqUser)) return;
  if (owner.orgId && !idsEqual(owner.orgId, activeOrgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

function normalizeOrgRoles(org) {
  const raw = Array.isArray(org?.roles) ? org.roles : (org?.role ? [org.role] : []);
  return raw
    .map((r) => String(r || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((r, i, arr) => arr.indexOf(r) === i);
}

function resolvePersonRoleInOrg(person, activeOrgId) {
  const orgMembership = (person?.organizations || []).find((o) => idsEqual(o?.orgId || '', activeOrgId || ''));
  const roles = normalizeOrgRoles(orgMembership);
  if (roles.includes('school_teacher')) return 'teacher';
  if (roles.includes('school_staff')) return 'staff';
  return '';
}

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeCompEntry(entry, idx = 0) {
  return {
    id: String(entry?.id || `CMP_${Date.now()}_${idx}`),
    departmentId: String(entry?.departmentId || '').trim(),
    paymentMethod: String(entry?.paymentMethod || 'hourly').trim().toLowerCase(),
    hourlyRate: entry?.hourlyRate === '' || entry?.hourlyRate === null || entry?.hourlyRate === undefined ? '' : Number(entry.hourlyRate),
    paymentAmount: entry?.paymentAmount === '' || entry?.paymentAmount === null || entry?.paymentAmount === undefined ? '' : Number(entry.paymentAmount),
    effectiveFrom: String(entry?.effectiveFrom || '').trim(),
    effectiveTo: String(entry?.effectiveTo || '').trim(),
    contractId: String(entry?.contractId || '').trim(),
    notes: String(entry?.notes || '').trim()
  };
}

async function getOwnerByTypeAndId(ownerType, ownerId, reqUser) {
  if (ownerType === 'teacher') return dataService.getDataById('teachers', ownerId, reqUser);
  if (ownerType === 'staff') return dataService.getDataById('staff', ownerId, reqUser);
  return null;
}

async function resolveOwnerForPerson({ reqUser, activeOrgId, personId, personRole }) {
  const role = String(personRole || '').trim().toLowerCase();
  if (role === 'teacher') {
    const teachers = await dataService.fetchData('teachers', {}, reqUser);
    return teachers.find((t) => idsEqual(t.personId || '', personId || '') && idsEqual(t.orgId || '', activeOrgId || '')) || null;
  }
  if (role === 'staff') {
    const staff = await dataService.fetchData('staff', {}, reqUser);
    return staff.find((s) => idsEqual(s.personId || '', personId || '') && idsEqual(s.orgId || '', activeOrgId || '')) || null;
  }
  return null;
}

async function getEligiblePayRatePersons(req) {
  const activeOrgId = getActiveOrgIdOrThrow(req.user);
  const personPayload = await schoolIdentityLookupService.listSchoolPersons({
    reqUser: req.user,
    requireSchoolRole: true,
    query: { limit: 1000 }
  });
  const persons = personPayload.allRows || personPayload.rows || [];
  const teachers = await dataService.fetchData('teachers', {}, req.user);
  const staff = await dataService.fetchData('staff', {}, req.user);

  const personById = new Map((persons || []).map((p) => [String(p.id || p.personId), p]));
  const results = [];

  (teachers || []).forEach((t) => {
    if (!idsEqual(t.orgId || '', activeOrgId)) return;
    const person = personById.get(String(t.personId || ''));
    const roles = Array.isArray(person?.schoolRoles || person?.roles) ? (person.schoolRoles || person.roles) : [];
    if (!roles.includes('school_teacher')) return;
    results.push({
      id: String(t.personId || ''),
      personId: String(t.personId || ''),
      ownerId: String(t.id || ''),
      ownerType: 'teacher',
      matchedRole: 'teacher',
      displayName: person?.displayName || person?.name || String(t.personId || '')
    });
  });

  (staff || []).forEach((s) => {
    if (!idsEqual(s.orgId || '', activeOrgId)) return;
    const person = personById.get(String(s.personId || ''));
    const roles = Array.isArray(person?.schoolRoles || person?.roles) ? (person.schoolRoles || person.roles) : [];
    if (!roles.includes('school_staff')) return;
    results.push({
      id: String(s.personId || ''),
      personId: String(s.personId || ''),
      ownerId: String(s.id || ''),
      ownerType: 'staff',
      matchedRole: 'staff',
      displayName: person?.displayName || person?.name || String(s.personId || '')
    });
  });

  return results;
}

exports.listPayRates = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    let query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query = {};

    const teachers = await dataService.fetchData('teachers', {}, req.user);
    const staff = await dataService.fetchData('staff', {}, req.user);
    const personPayload = await schoolIdentityLookupService.listSchoolPersons({
      reqUser: req.user,
      requireSchoolRole: false,
      query: { limit: 1000 }
    });
    const persons = personPayload.allRows || personPayload.rows || [];
    const departments = await dataService.fetchData('departments', {}, req.user);

    const personById = new Map((persons || []).map((p) => [String(p.id || p.personId), p]));
    const deptById = new Map((departments || []).map((d) => [String(d.id), `${d.code || d.id} - ${d.name || ''}`.trim()]));

    const profiles = [];
    const pushOwner = (ownerType, owner) => {
      if (!idsEqual(owner?.orgId || '', activeOrgId)) return;
      const personId = String(owner?.personId || '');
      const person = personById.get(personId);
      const personName = person?.displayName || person?.name || personId;
      const comp = Array.isArray(owner?.compensationProfiles) ? owner.compensationProfiles : [];
      const deptNames = [...new Set(comp.map((c) => deptById.get(String(c.departmentId || '')) || String(c.departmentId || '')).filter(Boolean))];

      profiles.push({
        id: `${ownerType}:${owner.id}`,
        ownerType,
        ownerId: String(owner.id || ''),
        personId,
        personName,
        profileRole: ownerType,
        compensationCount: comp.length,
        departments: deptNames.join(', '),
        status: String(owner.status || '')
      });
    };

    (teachers || []).forEach((t) => pushOwner('teacher', t));
    (staff || []).forEach((s) => pushOwner('staff', s));

    const searchableFields = await inferSearchableFields(profiles, { exclude: ['audit'] });
    const { data, pagination } = paginate(profiles, query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/payRate/payRateList', {
      title: 'Pay Rate Profiles',
      tableName: 'Pay_Rate_Profiles',
      data,
      searchableFields,
      newUrl: 'school/payrates',
      newLabel: 'Manage Profile Rates',
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
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showCreateForm = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const departments = await dataService.fetchData('departments', {}, req.user);
    res.render('school/payRate/payRateForm', {
      title: 'Manage Pay Rate Profile',
      rate: {},
      user: req.user,
      includeModal: true,
      isEdit: false,
      departments,
      compensationMethods: COMPENSATION_METHODS,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showEditForm = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const ownerType = String(req.query.ownerType || '').trim().toLowerCase();
    const ownerId = String(req.params.id || '').trim();

    const owner = await getOwnerByTypeAndId(ownerType, ownerId, req.user);
    if (!owner) throw new Error('Owner profile not found.');
    assertOwnerOrgAccess(owner, activeOrgId, req.user);

    const person = await dataService1.getDataById('persons', owner.personId, req.user, PERSON_QUERY_OPTIONS);
    const departments = await dataService.fetchData('departments', {}, req.user);

    const view = {
      ownerType,
      ownerId,
      personId: String(owner.personId || ''),
      personName: person ? `${person.name?.first || ''} ${person.name?.last || ''}`.trim() : String(owner.personId || ''),
      personRole: ownerType,
      compensationProfiles: Array.isArray(owner.compensationProfiles) ? owner.compensationProfiles : []
    };

    res.render('school/payRate/payRateForm', {
      title: 'Manage Pay Rate Profile',
      rate: view,
      user: req.user,
      includeModal: true,
      isEdit: true,
      departments,
      compensationMethods: COMPENSATION_METHODS,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.savePayRate = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const editOwnerId = String(req.params.id || '').trim();

    let ownerType = String(req.body.ownerType || '').trim().toLowerCase();
    let ownerId = String(req.body.ownerId || '').trim();

    if (editOwnerId) ownerId = editOwnerId;

    let owner = null;
    if (ownerId && (ownerType === 'teacher' || ownerType === 'staff')) {
      owner = await getOwnerByTypeAndId(ownerType, ownerId, req.user);
    } else {
      const personId = String(req.body.personId || '').trim();
      const personRole = String(req.body.personRole || '').trim().toLowerCase();
      owner = await resolveOwnerForPerson({ reqUser: req.user, activeOrgId, personId, personRole });
      ownerType = personRole;
      ownerId = String(owner?.id || '');
    }

    if (!owner) throw new Error('Teacher/Staff profile was not found for this person in the active organization.');
    assertOwnerOrgAccess(owner, activeOrgId, req.user);

    const incoming = parseJsonSafe(req.body.compensationProfiles, []);
    const normalized = (Array.isArray(incoming) ? incoming : []).map((c, idx) => normalizeCompEntry(c, idx));

    const payload = { ...owner, compensationProfiles: normalized };
    if (ownerType === 'teacher') await dataService.updateData('teachers', ownerId, payload, req.user);
    else await dataService.updateData('staff', ownerId, payload, req.user);

    if (isAjax(req)) return res.json({ status: 'success', message: 'Pay rate profile updated successfully.' });
    return res.redirect('/school/payrates');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    return res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.deletePayRate = async (req, res) => {
  try {
    return res.status(400).json({ status: 'error', message: 'Use profile editor to remove individual pay rate entries.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', error, message: error.message });
  }
};

exports.eligiblePersons = async (req, res) => {
  try {
    const q = String(normalizeSearchKeyword(req.query.q || '') || '').trim().toLowerCase();
    const list = await getEligiblePayRatePersons(req);
    const filtered = !q
      ? list
      : list.filter((p) => {
          const hay = `${p.personId} ${p.displayName} ${p.matchedRole}`.toLowerCase();
          return hay.includes(q);
        });
    return res.json({ status: 'success', results: filtered });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
