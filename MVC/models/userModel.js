// MVC/models/userModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toIdArray, toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/users.json');

/* ============================================================
   IMMUNE SYSTEM ADMINS (Virtual Users)
============================================================ */
const VIRTUAL_ADMINS = [
  {
    //id: 'SYS_ROOT_001',
    id: 'ROOT_001',
    email: 'apaknejad@equilibrium.ab.ca',//'root@system.in',
    username: 'Amin',
    // Hash for "Admin@123"
    passwordHash: "$2b$10$9L/KeLvZFyVTGJZ2gc.hzOeLD4LnQWxcyPjnfM.n6x5xvzg8uuRoS",
    active: true,
    status: 'active',
    accessLevel: 10, 
    primaryOrgId: 0,
    isEmailVerified: true,
    organizations: [],
    personId: "NO_PERSONID",
    registrationSource: "SYSTEM",
    isVirtualSuperAdmin: true,
    // Virtual admins do NOT use systemAccessProfileId (they are hardcoded root)
    audit: {
      createUser: "SYSTEM",
      createDateTime: new Date().toISOString(),
      lastUpdateUser: "SYSTEM",
      lastUpdateDateTime: new Date().toISOString()
    },
  }
];

async function _readDb() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.error('Error reading users.json:', err);
    throw new Error('Failed to retrieve users');
  }
}

async function getAllUsers() {
  const dbUsers = await _readDb();
  return [...VIRTUAL_ADMINS, ...dbUsers];
}

function applyUserScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const allowedUserIds = Array.isArray(scope?.userIds)
    ? new Set(toIdArray(scope.userIds))
    : null;

  if (allowedUserIds && allowedUserIds.size > 0) {
    return list.filter((row) => allowedUserIds.has(toPublicId(row?.id)));
  }

  return [];
}

function buildUserQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'users',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      userIds: Array.isArray(incomingScope?.userIds) ? toIdArray(incomingScope.userIds) : []
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'username', 'email', 'personId', 'role'],
      dateFields: ['createdAt', 'lastLogin', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryUsers(options = {}) {
  const plan = buildUserQueryPlan(options);
  const executor = getEntityQueryExecutor('users');

  // Future DB adapter path (Mongo/NoSQL): if registered, model delegates query execution.
  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  // JSON fallback path: keep existing behavior while migration is in progress.
  const allUsers = await getAllUsers();
  const scopedUsers = applyUserScope(allUsers, plan.scope);
  return applyGenericFilter(scopedUsers, plan.query, plan.fallback);
}

async function getAllUsers_Query(query, type) {
  const allUsers = await getAllUsers();
  if (!query) return allUsers;
  if(!type) type='contains';
  const lowercaseQuery = query.toLowerCase();

  return allUsers.filter(u => {
    const email = (u.email || '').toLowerCase();
    const username = (u.username || '').toLowerCase();
    const id = String(u.id);

    if (type === 'starts_with') {
      return email.startsWith(lowercaseQuery) || 
             username.startsWith(lowercaseQuery) ||
             id.startsWith(lowercaseQuery);
    } else {
      return email.includes(lowercaseQuery) || 
             username.includes(lowercaseQuery) ||
             id.includes(lowercaseQuery);
    }
  });
}

async function getUserById(id) {
  const vUser = VIRTUAL_ADMINS.find((u) => idsEqual(u?.id, id));
  if (vUser) return vUser;
  const dbUsers = await _readDb();
  return dbUsers.find((u) => idsEqual(u?.id, id));
}

async function getUsersByPersonId(personId) {
  const dbUsers = await _readDb();
  const matches = dbUsers.filter((u) => idsEqual(u?.personId, personId));
  if (matches.length > 1) {
    throw new Error(`Data integrity violation: multiple users are linked to person ${personId}.`);
  }
  return matches[0] || null;
}

async function getUserByUsername(username) {
  const q = String(username).toLowerCase();
  const vUser = VIRTUAL_ADMINS.find(u => 
    (u.username && String(u.username).toLowerCase() === q) || 
    (u.email && String(u.email).toLowerCase() === q)
  );
  if (vUser) return vUser;
  const dbUsers = await _readDb();
  return dbUsers.find(u => 
    (u.username && String(u.username).toLowerCase() === q) || 
    (u.email && String(u.email).toLowerCase() === q)
  );
}

function generateId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function validateData(user, allUsers = []) {
  const errors = [];
  if (!user || typeof user !== 'object') return { isValid: false, errors: ['User object is required.'] };

  if (!user.email || typeof user.email !== 'string') errors.push('Email is required.');
  else if (!/^\S+@\S+\.\S+$/.test(user.email)) errors.push('Email format is invalid.');

  if (!user.personId && !user.isVirtualSuperAdmin) errors.push('Person ID is required.');

  const validStatuses = ['pending', 'active', 'suspended', 'deleted'];
  if (!validStatuses.includes(user.status)) errors.push(`Status must be one of: ${validStatuses.join(', ')}.`);

  const inactiveStatuses = ['pending', 'suspended', 'deleted'];
  if (inactiveStatuses.includes(user.status) && user.active === true) {
      // Auto-correction happens in add/update, so strictly explicit error is optional
  }

  const validSources = ['self', 'org_invite', 'admin_create', 'org_admin_create'];
  if (user.registrationSource && !validSources.includes(user.registrationSource)) errors.push(`Registration Source is invalid.`);
  user.accessLevel=1;// as we do not use this anymore, we set it to 1 for every users.
  if (!Number.isInteger(user.accessLevel) || user.accessLevel < 1 || user.accessLevel > 10) errors.push('Access Level must be an integer between 1 and 10.');

  if (user.organizations && !Array.isArray(user.organizations)) errors.push('Organizations must be an array.');

  // ✅ NEW: Validate System Access Profile
  if (user.systemAccessProfileId) {
      if (typeof user.systemAccessProfileId !== 'string') {
          errors.push('System Access Profile ID must be a string.');
      }
      if (user.isVirtualSuperAdmin) {
          errors.push('Virtual Super Admins cannot have an assigned System Access Profile.');
      }
  }

  if (allUsers.length > 0) {
    const dup = allUsers.find((u) => !idsEqual(u?.id, user?.id) && String(u.email).toLowerCase() === String(user.email).toLowerCase());
    if (dup) errors.push('Email address already exists in the system.');
  }

  if (user.personId && !user.isVirtualSuperAdmin && allUsers.length > 0) {
    const duplicatePersonLink = allUsers.find((u) => {
      if (idsEqual(u?.id, user?.id)) return false;
      if (u.isVirtualSuperAdmin) return false;
      return idsEqual(u?.personId || '', user?.personId || '');
    });
    if (duplicatePersonLink) {
      errors.push(`This person is already linked to user '${duplicatePersonLink.username || duplicatePersonLink.email || duplicatePersonLink.id}'.`);
    }
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ---------------- CRUD ACTIONS ---------------- */

async function addUser(user) {
  await queueWrite(async () => {
    const users = await _readDb();
    if (VIRTUAL_ADMINS.find(v => v.email.toLowerCase() === user.email.toLowerCase())) {
        throw new Error('Email reserved by System Administrator.');
    }
    
    // ✅ AUTO-CORRECT: Enforce Inactive Status
    if (['pending', 'suspended', 'deleted'].includes(user.status)) {
        user.active = false;
    }

    user.id = user.id || generateId();
    const allUsers = [...VIRTUAL_ADMINS, ...users];
    const v = validateData(user, allUsers);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));
    
    users.push(user);
    await fs.writeFile(dataPath, JSON.stringify(users, null, 2));
    return user;
  });
}

async function updateUser(id, updates) {
  // 1. Check if Virtual Admin
  const vIndex = VIRTUAL_ADMINS.findIndex((v) => idsEqual(v?.id, id));
  
  if (vIndex !== -1) {
      if (updates.primaryOrgId) {
          VIRTUAL_ADMINS[vIndex].primaryOrgId = Number(updates.primaryOrgId);
      }
      return VIRTUAL_ADMINS[vIndex];
  }

  await queueWrite(async () => {
    const users = await _readDb();
    const idx = users.findIndex((u) => idsEqual(u?.id, id));
    if (idx === -1) throw new Error('User not found');

    const current = users[idx];
    
    // Merge updates
    const merged = {
      ...current,
      ...updates,
      audit: { ...current.audit, ...(updates.audit || {}) }
    };

    // ✅ AUTO-CORRECT: Enforce Inactive Status
    if (['pending', 'suspended', 'deleted'].includes(merged.status)) {
        merged.active = false;
    }

    const allUsers = [...VIRTUAL_ADMINS, ...users];
    const v = validateData(merged, allUsers);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    users[idx] = merged;
    await fs.writeFile(dataPath, JSON.stringify(users, null, 2));
  });
}

// ... (deleteUser, unlinkPerson remain unchanged) ...
async function deleteUser(id) {
  if (VIRTUAL_ADMINS.find((v) => idsEqual(v?.id, id))) throw new Error('This Root Administrator cannot be deleted.');

  await queueWrite(async () => {
    const users = await _readDb();
    const filtered = users.filter((u) => !idsEqual(u?.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

async function unlinkPerson(userId, personId) {
  if (VIRTUAL_ADMINS.find((v) => idsEqual(v?.id, userId))) return; 

  await queueWrite(async () => {
    const users = await _readDb();
    const idx = users.findIndex((u) => idsEqual(u?.id, userId));
    if (idx === -1) throw new Error('User not found');
    if (!idsEqual(users[idx]?.personId, personId)) throw new Error('User not linked to this person');
    users[idx].personId = null;
    await fs.writeFile(dataPath, JSON.stringify(users, null, 2));
    return users[idx];
  });
}

module.exports = {
  getAllUsers, 
  queryUsers,
  buildUserQueryPlan,
  getAllUsers_Query, 
  getUserById, 
  getUsersByPersonId, 
  addUser, 
  updateUser, 
  deleteUser, 
  unlinkPerson, 
  getUserByUsername
};
