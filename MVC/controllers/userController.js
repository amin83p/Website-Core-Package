// MVC/controllers/userController.js
const dataService = require('../services/dataService');
const { idsEqual } = require('../utils/idAdapter');
const organizationRepository = require('../repositories/organizationRepository');
 
const securityService = require('../services/security');
const bcrypt = require('bcrypt');
const adminAuthorityService = require('../services/adminAuthorityService');

const { buildDataServiceQuery } = require('../utils/generalTools');
const {
  buildOrganizationDisplayMap,
  resolveMembershipOrganizationName,
  resolveMembershipOrganizationLabel
} = require('../utils/organizationDisplay');
const { FREE_ORG_ID, SEARCH_DEFAULT_KEYWORD } = require('../../config/constants');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });
const USER_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'email',
    'username',
    'personId',
    'accessLevel',
    'primaryOrgId',
    'status',
    'active',
    'isEmailVerified',
    'registrationSource'
  ],
  allowedSearchFields: [
    'id',
    'email',
    'username',
    'personId',
    'primaryOrgId',
    'status',
    'registrationSource'
  ],
  defaultSearchFields: [
    'id',
    'email',
    'username',
    'personId',
    'primaryOrgId',
    'status',
    'registrationSource'
  ],
  allowMetaKeys: true
});

/* ---------------- HELPERS ---------------- */

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true' || String(v) === '1';
}

function normalizeOrganizations(bodyOrgs) {
  if (!bodyOrgs) return [];
  if (Array.isArray(bodyOrgs)) return bodyOrgs;
  try {
    const parsed = JSON.parse(bodyOrgs);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeIdList(values = []) {
  const rows = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  rows.forEach((value) => {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function normalizeManagedAccessProfiles(values = []) {
  const rows = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const profileId = String(row.profileId || row.id || row.accessProfileId || '').trim();
    if (!profileId) return;
    const sourceType = String(row.sourceType || row.type || row.originType || 'external').trim().toLowerCase() || 'external';
    const sourceRefId = String(row.sourceRefId || row.sourceId || row.originId || '').trim();
    const sourceLabel = String(row.sourceLabel || row.label || row.originLabel || '').trim().slice(0, 240);
    const key = `${profileId}::${sourceType}::${sourceRefId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      profileId,
      sourceType,
      sourceRefId,
      sourceLabel,
      locked: true,
      createdAt: String(row.createdAt || row.createDateTime || '').trim() || new Date().toISOString(),
      createdBy: String(row.createdBy || row.createUser || '').trim() || 'System'
    });
  });
  return out;
}

function resolveConfiguredDirectAccessProfileIds(config = {}) {
  if (Array.isArray(config?.directAccessProfileIds)) return normalizeIdList(config.directAccessProfileIds);
  if (Array.isArray(config?.accessProfileIds)) return normalizeIdList(config.accessProfileIds);
  return [];
}

async function loadOrganizationDisplayMap() {
  const organizations = await organizationRepository.list({
    scope: { canViewAll: true },
    pagination: { limit: 10000 }
  });
  return buildOrganizationDisplayMap(organizations);
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

// ✅ REFACTORED: Use shared service + local logic
function isSystemAdmin(user) {
  return adminAuthorityService.isAdmin(user);
}

async function buildUserOrganizations(personId, formOrgsJson, reqUser, existingUserOrgs = []) {
  const person = await dataService.getDataById('persons', personId, reqUser, PERSON_QUERY_OPTIONS);
  if (!person) return [];

  const personOrgs = person.organizations || [];
  const configuredOrgs = normalizeOrganizations(formOrgsJson);
  const organizationMap = await loadOrganizationDisplayMap();

  return personOrgs.map(pOrg => {
    const config = configuredOrgs.find(c => Number(c.orgId) === Number(pOrg.orgId)) || {};
    const existingOrg = (Array.isArray(existingUserOrgs) ? existingUserOrgs : [])
      .find((org) => Number(org?.orgId) === Number(pOrg?.orgId)) || {};
    const managedAccessProfiles = normalizeManagedAccessProfiles(existingOrg?.managedAccessProfiles || []);
    const managedProfileIds = normalizeIdList(managedAccessProfiles.map((row) => row.profileId));
    const managedProfileSet = new Set(managedProfileIds);
    const directAccessProfileIds = resolveConfiguredDirectAccessProfileIds(config)
      .filter((id) => !managedProfileSet.has(id));
    const effectiveAccessProfileIds = normalizeIdList([...directAccessProfileIds, ...managedProfileIds]);
    const rawRoles = Array.isArray(pOrg.roles) ? pOrg.roles : (pOrg.role ? [pOrg.role] : []);
    const roles = rawRoles
      .map(r => String(r || '').trim().toLowerCase())
      .filter(Boolean)
      .filter((r, idx, arr) => arr.indexOf(r) === idx);
    if (!roles.length) roles.push('member');
    return {
      orgId: Number(pOrg.orgId),
      name: resolveMembershipOrganizationName(pOrg, organizationMap),
      roles,
      role: roles[0],
      memberStatus: pOrg.memberStatus || 'active',
      joinedAt: pOrg.joinedAt,
      directAccessProfileIds,
      managedAccessProfiles,
      accessProfileIds: effectiveAccessProfileIds
    };
  });
}

async function assertOrgAccessProfilesMatch(organizations, reqUser) {
  for (const org of organizations || []) {
    const orgProfileIds = Array.isArray(org.directAccessProfileIds)
      ? normalizeIdList(org.directAccessProfileIds)
      : normalizeIdList(org.accessProfileIds || []);
    for (const profileId of orgProfileIds) {
      const profile = await dataService.getDataById('accesses', profileId, reqUser);
      if (!profile) {
        throw new Error(`Access Profile '${profileId}' not found for Organization #${org.orgId}.`);
      }

      if (!idsEqual(profile.orgId || '', org.orgId || '')) {
        const scopeLabel = profile.orgId ? `Organization #${profile.orgId}` : 'Global Scope';
        throw new Error(
          `Access Profile '${profile.name}' cannot be assigned to Organization #${org.orgId}. ` +
          `Its scope is ${scopeLabel}. Please assign only profiles created for the same organization.`
        );
      }
    }
  }
}

async function validateUserInput(body, { allowNoPerson = false } = {}) {
  const errors = [];
  const email = (body.email || '').trim();
  const personId = body.personId ? String(body.personId).trim() : null;
  const status = (body.status || 'pending').trim();
  const registrationSource = (body.registrationSource || 'admin_create').trim();
  const accessLevel = parseInt(body.accessLevel || '1', 10);

  if (!email) errors.push('Email is required.');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.push('Email is invalid.');
  if (!allowNoPerson && !personId) errors.push('personId is required.');
  if (!['pending','active','suspended','deleted'].includes(status)) errors.push('Invalid status.');
  if (!['self','org_invite','admin_create','org_admin_create'].includes(registrationSource)) errors.push('Invalid registrationSource.');
  if (!Number.isInteger(accessLevel) || accessLevel < 1 || accessLevel > 10) errors.push('Access Level must be 1..10.');
  
  if (errors.length) throw new Error(errors.join('\n'));
}

/* ---------------- LIST ---------------- */
async function listUsers(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, USER_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;
    const pagedUsers = await dataService.fetchDataPaged('users', {
      ...query,
      page,
      limit
    }, req.user);
    const usersOnPage = Array.isArray(pagedUsers?.rows) ? pagedUsers.rows : [];
    const pagination = pagedUsers?.pagination || null;

    const personIdsOnPage = usersOnPage.map(u => u.personId).filter((id, index, self) => id && self.indexOf(id) === index);
    const organizationMap = await loadOrganizationDisplayMap();
    const personsForPage = decorateMembershipOrganizationLabels(
      await dataService.getAccessiblePersonsByIds(req.user, personIdsOnPage),
      organizationMap
    );

    if (req.headers['x-ajax-request']) {
      let results = usersOnPage;
      if (String(req.query?.q || '').trim() === SEARCH_DEFAULT_KEYWORD) results = await dataService.getAccessibleUsers(req.user);
      return res.json({ status: 'success', results, pagination });
    }

    res.render('user/users', {
      title: 'Users Management',
      tableName: 'Users_Management',
      users: usersOnPage, 
      persons: personsForPage,
      newUrl: 'users',
      newLabel: 'Add User',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      user: req.user || null,
      pagination,
      searchableFields: USER_LIST_QUERY_OPTIONS.defaultSearchFields,
      filters: req.query,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showAddUserForm(req, res) {
  try {
    const accessDefinitions = await dataService.fetchData('accesses', {}, req.user);
    const scopeDefinitions = await dataService.fetchData('scopes', {}, req.user);
    
    // ✅ PASS PERMISSION FLAG TO VIEW
    const canAssignSystem = isSystemAdmin(req.user);

    res.render('user/userForm', {
      title: 'Add User',
      includeModal: true,
      userItem: null,
      accessDefinitions, 
      scopeDefinitions,
      user: req.user || null,
      actionStateId: req.actionStateId,
      
      // ✅ Allow View to render the special field
      isSystemAdmin: canAssignSystem 
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function addUser(req, res) {
  try {
    await validateUserInput(req.body);
    const now = new Date().toISOString();
    const reqUserId = req.user?.id || null;

    const person = await dataService.getDataById('persons', req.body.personId, req.user, PERSON_QUERY_OPTIONS);
    if(!person) throw new Error('Person not found.');

    const organizations = await buildUserOrganizations(req.body.personId, req.body.organizations, req.user, []);
    await assertOrgAccessProfilesMatch(organizations, req.user);

    // Validate Org-Level Permissions
    for (const org of organizations) {
        const directProfileIds = Array.isArray(org.directAccessProfileIds)
          ? normalizeIdList(org.directAccessProfileIds)
          : normalizeIdList(org.accessProfileIds || []);
        if (directProfileIds.length > 0) {
            for (const profileId of directProfileIds) {
                const check = await securityService.validateDelegation(req.user, profileId, org.orgId);
                if (!check.allowed) throw new Error(`Permission Denied in Org #${org.orgId}: ${check.reason}`);
            }
        }
    }

    // ✅ NEW: Handle System Access Profile (Tier 2 Admin)
    let systemAccessProfileId = null;
    
    // 1. Check Privilege: Only System Admins can assign this
    if (isSystemAdmin(req.user)) {
        const reqSysId = (req.body.systemAccessProfileId || '').trim();
        
        if (reqSysId) {
            // 2. Validate Existence
            const sysProfile = await dataService.getDataById('accesses', reqSysId, req.user);
            if (!sysProfile) throw new Error(`System Access Profile '${reqSysId}' not found.`);
            
            // 3. Validate Scope: Must be GLOBAL (no orgId)
            if (sysProfile.orgId) throw new Error(`Profile '${sysProfile.name}' is organization-specific. System Admins must have a Global profile.`);
            
            systemAccessProfileId = reqSysId;
        }
    }

    let targetPrimaryOrgId = req.body.primaryOrgId;
    if (!targetPrimaryOrgId && organizations.length > 0) targetPrimaryOrgId = organizations[0].orgId;
    if (!targetPrimaryOrgId) targetPrimaryOrgId = FREE_ORG_ID; 

    let passwordHash = null;
    if (req.body.passwordHash && req.body.passwordHash.trim() !== '') {
      passwordHash = await bcrypt.hash(req.body.passwordHash, 10);
    }

    const userItem = {
      active: parseBool(req.body.active),
      email: (req.body.email || '').trim(),
      username: req.body.username?.trim() || null,
      passwordHash: passwordHash, 
      status: (req.body.status || 'pending').trim(),
      registrationSource: (req.body.registrationSource || 'admin_create').trim(),
      personId: String(req.body.personId).trim(),
      accessLevel: parseInt(req.body.accessLevel || '1', 10),
      organizations, 
      primaryOrgId: Number(targetPrimaryOrgId),
      
      // ✅ SAVE SECURE FIELD
      systemAccessProfileId: systemAccessProfileId, 

      isEmailVerified: parseBool(req.body.isEmailVerified),
      lastLoginAt: req.body.lastLoginAt || null,
      audit: { createUser: reqUserId, createDateTime: now, lastUpdateUser: reqUserId, lastUpdateDateTime: now }
    };

    const results = await dataService.addData('users', userItem, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'User saved successfully.', data: results });
    }
    res.redirect('/users');

  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', error, message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showEditUserForm(req, res) {
  try {
    const userItem = await dataService.getDataById('users', req.params.id, req.user);
    if(!userItem) return res.status(404).render('404', { title: 'User Not Found', user: req.user || null });

    let personsItem;
    if (adminAuthorityService.isSuperAdmin(userItem)) { // ✅ Reused helper here too
       const allOrgs = await dataService.getAccessibleOrganizations(req.user);
       personsItem = {
           id: 'VIRTUAL_PERSON',
           name: { first: 'System', last: 'Admin' },
           organizations: allOrgs.map(o => ({
               orgId: o.id,
               name: o.identity?.displayName || o.name,
               role: 'admin',
               memberStatus: 'active',
               joinedAt: new Date().toISOString()
           }))
       };
    } else {
       personsItem = await dataService.getDataById('persons', userItem.personId, req.user, PERSON_QUERY_OPTIONS);
       if(!personsItem) return res.status(404).render('404', { title: 'Related Person Not Found', user: req.user || null });
    }

    const accessDefinitions = await dataService.fetchData('accesses', {}, req.user);
    const scopeDefinitions = await dataService.fetchData('scopes', {}, req.user);
    
    // ✅ PASS PERMISSION FLAG TO VIEW
    const canAssignSystem = isSystemAdmin(req.user);

    res.render('user/userForm', {
      title: 'Edit User',
      includeModal: true,
      userItem,
      person: {
        id: personsItem.id,
        name: (personsItem.name.first || '') +' ' +(personsItem.name.last || ''),
        organizations: personsItem.organizations 
      },
      accessDefinitions, 
      scopeDefinitions,
      user: req.user || null,
      actionStateId: req.actionStateId,
      
      // ✅ Allow View to render the special field
      isSystemAdmin: canAssignSystem
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error ,message: error.message, user: req.user || null });
  }
}

async function editUser(req, res) {
  try {
    const current = await dataService.getDataById('users', req.params.id, req.user);
    if(!current) throw new Error('User not found');

    if (adminAuthorityService.isSuperAdmin(current)) { // ✅ Reused helper
        if (req.body.primaryOrgId) {
             await dataService.updateData('users', req.params.id, { primaryOrgId: req.body.primaryOrgId }, req.user);
        }
        if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Admin Context Updated.' });
        return res.redirect('/users');
    }

    await validateUserInput(req.body, { allowNoPerson: true });
    const now = new Date().toISOString();
    const reqUserId = req.user?.id || null;

    const organizations = await buildUserOrganizations(current.personId, req.body.organizations, req.user, current.organizations || []);
    await assertOrgAccessProfilesMatch(organizations, req.user);

    for (const org of organizations) {
        const directProfileIds = Array.isArray(org.directAccessProfileIds)
          ? normalizeIdList(org.directAccessProfileIds)
          : normalizeIdList(org.accessProfileIds || []);
        if (directProfileIds.length > 0) {
            for (const profileId of directProfileIds) {
                const check = await securityService.validateDelegation(req.user, profileId, org.orgId);
                if (!check.allowed) throw new Error(`Permission Denied in Org #${org.orgId}: ${check.reason}`);
            }
        }
    }

    // ✅ NEW: Handle System Access Profile (Tier 2 Admin)
    let systemAccessProfileId = current.systemAccessProfileId; // Default: Keep existing
    
    // 1. Check Privilege: Only System Admins can CHANGE this
    if (isSystemAdmin(req.user)) {
        const reqSysId = (req.body.systemAccessProfileId || '').trim();
        
        if (reqSysId && reqSysId !== (current.systemAccessProfileId || '')) {
            // 2. Validate Existence
            const sysProfile = await dataService.getDataById('accesses', reqSysId, req.user);
            if (!sysProfile) throw new Error(`System Access Profile '${reqSysId}' not found.`);
            
            // 3. Validate Scope: Must be GLOBAL
            if (sysProfile.orgId) throw new Error(`Profile '${sysProfile.name}' is organization-specific. System Admins must have a Global profile.`);
            
            systemAccessProfileId = reqSysId;
        } else if (!reqSysId) {
            // Allow clearing it
            systemAccessProfileId = null; 
        }
    }
    // If NOT system admin, we ignore req.body.systemAccessProfileId and keep `systemAccessProfileId` as `current.systemAccessProfileId`

    let targetPrimaryOrgId = req.body.primaryOrgId ? Number(req.body.primaryOrgId) : null;
    if (organizations.length > 0) {
       const exists = organizations.some(o => Number(o.orgId) === targetPrimaryOrgId);
       if (!exists) targetPrimaryOrgId = organizations[0].orgId;
    } else {
       targetPrimaryOrgId = FREE_ORG_ID;
    }

    let passwordHash = undefined; 
    if (req.body.passwordHash && req.body.passwordHash.trim() !== '') {
        passwordHash = await bcrypt.hash(req.body.passwordHash, 10);
    }      

    const updates = {
      active: parseBool(req.body.active),
      email: (req.body.email || '').trim(),
      username: req.body.username?.trim() || null,
      status: (req.body.status || 'pending').trim(),
      registrationSource: (req.body.registrationSource || 'admin_create').trim(),
      accessLevel: parseInt(req.body.accessLevel || '1', 10),
      organizations, 
      primaryOrgId: targetPrimaryOrgId,
      
      // ✅ SAVE SECURE FIELD
      systemAccessProfileId: systemAccessProfileId,

      isEmailVerified: parseBool(req.body.isEmailVerified),
      lastLoginAt: req.body.lastLoginAt || null,
      audit: { lastUpdateUser: reqUserId, lastUpdateDateTime: now }
    };

    if (passwordHash) updates.passwordHash = passwordHash;
    updates.personId = current.personId;

    const results = await dataService.updateData('users', req.params.id, updates, req.user);

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'User updated successfully.', data: results });
    res.redirect('/users');

  } catch (error) {
    if (req.headers['x-ajax-request']) {
        return res.status(400).json({ status: 'error', error, message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

// ... (deleteUser, checkUserPerson remain unchanged)
async function deleteUser(req, res) {
  try {
    const userId = req.params.id;
    const results = await dataService.deleteData('users', userId, req.user);
    if (req.headers['x-ajax-request']) return res.json({ status: 'success',results, message: 'User deleted.' });
    res.redirect('/users');
  } catch (err) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: err.message });
    res.status(500).render('error', { title: 'Error', message: err.message, user: req.user || null });
  }
}

async function checkUserPerson(req, res) {
  try {
    const { personId } = req.params;
    if (!personId) throw new Error('Person ID is required');
    const users = await dataService.fetchData('users', { q: personId, type: 'starts_with', searchFields: 'personId' }, req.user);
    const user = users.find(u => idsEqual(u.personId, personId));
    return res.json({ status: 'success', exists: !!user, user: user ? { id: user.id, name: user.username || user.email } : null });
  } catch (error) {
    return res.status(500).json({ status: 'error', error, message: error.message });
  }
}

module.exports = {
  listUsers,
  showAddUserForm,
  addUser,
  showEditUserForm,
  editUser,
  deleteUser,
  checkUserPerson,
  validateUserInput
};
