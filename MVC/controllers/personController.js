// MVC/controllers/personController.js
const dataService = require('../services/dataService'); 
const {isAdmin} = require('../services/adminChekersService');
const personRepository = require('../repositories/personRepository');
const organizationRepository = require('../repositories/organizationRepository');
const { buildDataServiceQuery } = require('../utils/generalTools');
const publicRegistrationService = require('../services/person/publicRegistrationService');
const packagePersonDependencyGuardService = require('../services/packagePersonDependencyGuardService');
const {
  buildOrganizationDisplayMap,
  canonicalizeMembershipOrganizationNames,
  resolveMembershipOrganizationLabel
} = require('../utils/organizationDisplay');

const { DEFAULTS } = require('../../config/constants');
const HIGH_ACCESS_MIN = Number(DEFAULTS?.HIGH_ACCESS_MIN || 8);
const HIGH_ACCESS_MAX = Number(DEFAULTS?.HIGH_ACCESS_MAX || 10);
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });
const PERSON_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'active', 'name.first', 'name.last', 'name.preferred'],
  allowedSearchFields: [
    'id',
    'name.first',
    'name.last',
    'name.preferred',
    'contact.emails[0].email',
    'contact.email'
  ],
  defaultSearchFields: [
    'id',
    'name.first',
    'name.last',
    'name.preferred',
    'contact.emails[0].email',
    'contact.email'
  ],
  allowMetaKeys: true
});
const {
  resolveFreeOrgSettingId,
  resolveFreeOrgSettingName,
  resolveOrgNameById,
  validatePersonInput,
  buildPersonFromBody,
  autoCreateMinimumUserForPerson,
  registerPublicPersonAndUser
} = publicRegistrationService;

async function loadOrganizationDisplayMap() {
  const organizations = await organizationRepository.list({
    scope: { canViewAll: true },
    pagination: { limit: 10000 }
  });
  return buildOrganizationDisplayMap(organizations);
}

async function canonicalizeOrganizationMemberships(organizations = []) {
  const organizationMap = await loadOrganizationDisplayMap();
  return canonicalizeMembershipOrganizationNames(organizations, organizationMap).value;
}

function decorateMembershipOrganizationLabels(rows = [], organizationMap = new Map()) {
  return (Array.isArray(rows) ? rows : []).map((person) => {
    const organizations = Array.isArray(person?.organizations)
      ? person.organizations.map((membership) => ({
        ...membership,
        displayLabel: resolveMembershipOrganizationLabel(membership, organizationMap)
      }))
      : person?.organizations;
    return { ...person, organizations };
  });
}

function getAccessLevel(user) {
  const lvl = user?.accessLevel ?? user?.minimumAccessRequirement ?? user?.minAccess ?? user?.role ?? 0;
  return Number(lvl || 0);
}

function canEditOrganizationsForUser(user) {
  const accessLevel = getAccessLevel(user);
  return isAdmin(user) || (accessLevel >= HIGH_ACCESS_MIN && accessLevel <= HIGH_ACCESS_MAX);
}

async function extractUserOrganizations(reqUser) {
  if (!reqUser) return [];
  const query = { q: reqUser.username, type: 'exact_match', searchFields: 'username' };
  const users = await dataService.fetchData('users', query, reqUser);
  const user=users[0];
  if(!user) throw new Error('User not found');

  let allowedOrgs = [];
  if (user.personId) {
    const person = await dataService.getDataById('persons', user.personId, reqUser, PERSON_QUERY_OPTIONS);
    if (person && Array.isArray(person.organizations)) {
      allowedOrgs = person.organizations;
    }
  }
  return allowedOrgs;
}

/* ---------------- LIST ---------------- */
async function listPersons(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, PERSON_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;
    const pagedPersons = await dataService.fetchDataPaged('persons', {
      ...query,
      page,
      limit
    }, req.user, PERSON_QUERY_OPTIONS);
    let data = Array.isArray(pagedPersons?.rows) ? pagedPersons.rows : [];
    const pagination = pagedPersons?.pagination || null;
    const organizationMap = await loadOrganizationDisplayMap();
    data = decorateMembershipOrganizationLabels(data, organizationMap);
    
    if (req.headers['x-ajax-request']) {
      if(query.q === 'aaa') {
        data = decorateMembershipOrganizationLabels(await dataService.getAccessiblePersons(req.user), organizationMap);
      }
      return res.json({ status: 'success', results: data , pagination });
    }

    res.render('person/persons', {
      title: 'Persons Management',
      tableName: 'Persons_Management',
      data,
      newUrl: 'persons',
      newLabel: 'Add Person',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      pagination,
      searchableFields: PERSON_LIST_QUERY_OPTIONS.defaultSearchFields,
      filters: req.query, 
      user: req.user || null
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message }); 
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

/* ---------------- ADD & EDIT ---------------- */
async function showAddPersonForm(req, res) {
  try {
    const canEditOrganizations = canEditOrganizationsForUser(req.user);
    let availableOrganizations = [];
    let fixedOrganizations = [];

    if (canEditOrganizations) {
      availableOrganizations = await dataService.getAccessibleOrganizations(req.user);
    } else {
      fixedOrganizations = await extractUserOrganizations(req.user);
    }
    
    res.render('person/personForm', {
      title: 'Add Person',
      includeModal: true,
      person: null,
      user: req.user || null,
      showOrganizationsTab: true,
      canEditOrganizations,
      availableOrganizations,
      fixedOrganizations,
      manualTagPresets: personRepository.getAllowedManualTags(),
      systemTagKeys: personRepository.getSystemTagKeys(),
      linkedUsers: null,
      // ✅ PASS TRACKING ID
      actionStateId: req.actionStateId
    });
  } catch(error) {
    console.log(error);
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function addPerson(req, res) {
  try {
    await validatePersonInput(req.body, {
      isSelfRegistration: false,
      requirePrimaryEmail: true,
      checkPersonEmailUnique: true,
      checkUserEmailUnique: true
    });
    const canEditOrganizations = canEditOrganizationsForUser(req.user);
    const reqUserId = req.user?.id || null;

    let person = buildPersonFromBody(req.body, reqUserId);
    if (!canEditOrganizations) {
      person.organizations = await extractUserOrganizations(req.user);
    }
    person.organizations = await canonicalizeOrganizationMemberships(person.organizations);

    const regPerson = await dataService.addData('persons', person, req.user); 
    
    const autoUser = await autoCreateMinimumUserForPerson(regPerson, {
      creatorUserId: reqUserId,
      registrationSource: canEditOrganizations ? 'admin_create' : 'org_admin_create'
    });
    
    if(!autoUser.created){
      dataService.deleteData('persons', regPerson.id, req.user);
      // Logic failure (e.g. dup email) -> 400
      return res.status(400).json({
        status: 'error',
        message: '<b>'+autoUser.reason +`</b><br>For user account we cannot register multiple users with the same email address.<br>Registered person deleted.`,
      });
    }

    if (req.headers['x-ajax-request']) {
      return res.json({
        status: 'success',
        message: 'Person saved successfully.',
        userEditUrl: `/users/edit/${autoUser?.user?.id || '0'}`,
        autoUserCreated: autoUser.created,
        tempPassword: autoUser.tempPassword || null
      });
    }
    res.redirect(`/users/edit/${autoUser.id}`);
  } catch (error) {
    if (req.headers['x-ajax-request']) {
        // ✅ FIX: Use 400 for logic/validation errors to keep session active
        return res.status(400).json({ status: 'error', message: error.message }); 
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showEditPersonForm(req, res) {
  try {
    const person = await dataService.getDataById('persons', req.params.id, req.user, PERSON_QUERY_OPTIONS);
    if (!person) return res.status(404).render('404', { title: 'Person Not Found', user: req.user || null });

    const canEditOrganizations = canEditOrganizationsForUser(req.user);
    let availableOrganizations = [];
    if (canEditOrganizations) {
      availableOrganizations = await dataService.getAccessibleOrganizations(req.user);
    }

    let linkedUser = null;
    if(person.id){
      const users = await dataService.fetchData('users',{ q: person.id, type: 'exact_match', searchFields: 'personId' }, req.user);
      linkedUser = users[0];
    }
    
    res.render('person/personForm', {
      title: 'Edit Person',
      includeModal: true,
      person,
      user: req.user || null,
      showOrganizationsTab: true,
      canEditOrganizations,
      availableOrganizations,
      fixedOrganizations: person.organizations || [],
      manualTagPresets: personRepository.getAllowedManualTags(),
      systemTagKeys: personRepository.getSystemTagKeys(),
      linkedUser,
      // ✅ PASS TRACKING ID
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message }); 
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function editPerson(req, res) {
  try {
    const existing = await dataService.getDataById('persons', req.params.id, req.user, PERSON_QUERY_OPTIONS);
    if (!existing) throw new Error('Person not found!');

    // Profile type is immutable after create — ignore any client-submitted change.
    const lockedProfileType = String(existing.personProfileType || '').trim().toLowerCase() === 'organization'
      ? 'organization'
      : 'individual';
    req.body = {
      ...req.body,
      personProfileType: lockedProfileType
    };

    await validatePersonInput(req.body, {
      isSelfRegistration: false,
      requirePrimaryEmail: true,
      existingPersonId: existing.id,
      checkPersonEmailUnique: true,
      checkUserEmailUnique: true
    });

    const canEditOrganizations = canEditOrganizationsForUser(req.user);
    const reqUserId = req.user?.id || null;

    let updates = buildPersonFromBody(req.body, reqUserId, existing);
    if (!canEditOrganizations) {
      updates.organizations = existing.organizations || [];
    }
    updates.organizations = await canonicalizeOrganizationMemberships(updates.organizations);
    
    await dataService.updateData('persons', req.params.id, updates, req.user);

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Person updated successfully.' });
    res.redirect('/persons');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
        // ✅ FIX: Use 400 for logic/validation errors
        return res.status(400).json({ status: 'error', message: error.message }); 
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

/* ---------------- DELETE ---------------- */
async function deletePerson(req, res) {
  try {
    const personId = req.params.id;
    const person = await dataService.getDataById('persons', personId, req.user, PERSON_QUERY_OPTIONS);
    if (!person) throw new Error('Person not found.');

    const deleteBlocks = await packagePersonDependencyGuardService.collectPersonDeleteBlocks(person, {
      user: req.user,
      request: req
    });
    if (deleteBlocks.length > 0) {
      const firstBlock = deleteBlocks[0];
      const e = new Error(firstBlock.message || 'Deletion blocked by a package dependency guard.');
      e.statusCode = Number(firstBlock.statusCode || 409);
      throw e;
    }
    // const linkedUsers = await dataService.fetchData('users', { q: personId, type: 'exact_match', searchFields: 'personId' }, req.user);

    // if (linkedUsers && linkedUsers.length > 0) {
    //     const userRef = linkedUsers[0].username || linkedUsers[0].email;
    //     throw new Error(`<b>Constraint Violation:</b><br>Cannot delete Person. A User account (<b>${userRef}</b>) is currently linked to this profile.<br><br>Please delete or unlink the User account first.`);
    // }

    const deleted_item = await dataService.deleteData('persons', personId, req.user);
    
    if (req.headers['x-ajax-request']) return res.json({ status: 'success' ,results:deleted_item, message:'Person deleted successfully.', result: deleted_item});
    res.redirect('/persons');

  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // ✅ FIX: Use 400 for constraint violations
      const statusCode = Number(error?.statusCode || 400);
      return res.status(statusCode).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

/* ---------------- SELF REGISTRATION & UNLINK (Unchanged) ---------------- */
async function showRegisterForm(req, res) {
  res.render('person/personForm', {
    title: 'Register',
    includeModal: false,
    person: null,
    user: null,
    showOrganizationsTab: false,
    canEditOrganizations: false,
    availableOrganizations: [],
    fixedOrganizations: [],
    manualTagPresets: personRepository.getAllowedManualTags(),
    systemTagKeys: personRepository.getSystemTagKeys()
  });
}

async function registerSelf(req, res) {
  try {
    const freeOrgId = resolveFreeOrgSettingId();
    const freeOrgName = await resolveOrgNameById(freeOrgId, resolveFreeOrgSettingName());
    const result = await registerPublicPersonAndUser({
      body: req.body,
      orgId: freeOrgId,
      orgName: freeOrgName,
      roles: ['member'],
      creatorUserId: 'SYSTEM',
      creatorUsername: 'Self_Registration',
      registrationSource: 'self'
    });

    res.json({ status: 'success', message: 'Registration successful.', tempPassword: result.tempPassword });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message }); 
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function unlinkUserFromPerson(req, res) {
  try {
    const { personId, userId } = req.params;
    const accessLevel = getAccessLevel(req.user);
    if (accessLevel < HIGH_ACCESS_MIN) {
      return res.status(403).json({ status: 'error', message: 'Not allowed.' });
    }
    await dataService.unlinkPersonFromUser(userId, personId, req.user);
    res.json({ status: 'success', message: 'User unlinked.' });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message }); 
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

/* ============================================================
   PUBLIC JOIN / SIGN UP ENDPOINTS
============================================================ */

async function showPublicJoinForm(req, res) {
  return res.render('person/publicJoin', {
    title: 'Join Us',
    person: {},
    user: null,
    includeModal: true,
    showOrganizationsTab: false,
    canEditOrganizations: false,
    availableOrganizations: [],
    fixedOrganizations: [],
    formAction: '/persons/join',
    joinHeadingTitle: 'Join Our Community',
    joinHeadingSubtitle: 'Create your profile to get started.',
    submitButtonLabel: 'Create Account'
  });
}

async function processPublicJoin(req, res) {
  try {
    const freeOrgId = resolveFreeOrgSettingId();
    const freeOrgName = await resolveOrgNameById(freeOrgId, resolveFreeOrgSettingName());
    const result = await registerPublicPersonAndUser({
      body: req.body,
      orgId: freeOrgId,
      orgName: freeOrgName,
      roles: ['member'],
      creatorUserId: 'SYSTEM',
      creatorUsername: 'Public_Sign_Up',
      registrationSource: 'self'
    });

    return res.json({
        status: 'success',
        message: 'Account created successfully.',
        tempPassword: result.tempPassword,
        userEditUrl: null,
        isPublicJoin: true // Flag for frontend to handle redirect differently
    });

  } catch (error) {
    console.error("Join Error:", error);
    if (req.headers['x-ajax-request']) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Registration Error', message: error.message, user: null });
  }
}

module.exports = {
  listPersons,
  showAddPersonForm,
  addPerson,
  showEditPersonForm,
  editPerson,
  deletePerson,
  showRegisterForm,
  registerSelf,
  unlinkUserFromPerson,
  showPublicJoinForm,
  processPublicJoin
};
