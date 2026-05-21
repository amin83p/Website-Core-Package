// MVC/models/tableSettingsModel.js

const fs = require('fs').promises;
const path = require('path');
const dataPath = path.join(__dirname, '../../data/tableSettings.json');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

/* ============================================================
   Helper: Ensure file exists
============================================================ */
async function ensureFile() {
  try {
    await fs.access(dataPath);
  } catch {
    await fs.writeFile(dataPath, JSON.stringify([], null, 2));
  }
}

async function getAllSettings() {
  try {
    await ensureFile();
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error('Error reading tableSettings.json:', error);
    throw new Error('Failed to retrieve table settings');
  }
}

function applyTableSettingsScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const userId = toPublicId(scope?.userId) || null;
  if (!userId) return [];

  return list.filter((row) => toPublicId(row?.userId) === userId);
}

function buildTableSettingsQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'tablesettings',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      userId: toPublicId(incomingScope?.userId) || null
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['userId', 'tableId', 'id'],
      dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function querySettings(options = {}) {
  const plan = buildTableSettingsQueryPlan(options);
  const executor = getEntityQueryExecutor('tablesettings');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allSettings = await getAllSettings();
  const scopedSettings = applyTableSettingsScope(allSettings, plan.scope);
  return applyGenericFilter(scopedSettings, plan.query, plan.fallback);
}

async function getUserSettings(userId) {
  const settings = await getAllSettings();
  return settings.filter((s) => idsEqual(s?.userId, userId));
}

async function getUserTableSetting(userId, tableId) {
  const settings = await getAllSettings();
  return settings.find((s) =>
    idsEqual(s?.userId, userId) && idsEqual(s?.tableId, tableId)
  ) || null;
}

function generateId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* ---------------- VALIDATION ---------------- */

function validateData(record) {
  const errors = [];

  if (!record || typeof record !== 'object') {
    return { isValid: false, errors: ['Record must be a valid object.'] };
  }

  if (!record.userId || typeof record.userId !== 'string') {
    errors.push('User ID is required.');
  }

  if (!record.tableId || typeof record.tableId !== 'string') {
    errors.push('Table ID is required.');
  }

  if (!record.settings || typeof record.settings !== 'object') {
    errors.push('Settings must be an object.');
  }

  // Audit Validation
  const audit = record.audit || {};
  if (!audit.createUser || typeof audit.createUser !== 'string') {
    errors.push('Creator User ID is missing.');
  }
  if (!audit.lastUpdateUser || typeof audit.lastUpdateUser !== 'string') {
    errors.push('Last Update User ID is missing.');
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ---------------- CRUD ACTIONS ---------------- */

async function addSetting({ userId, tableId, settings, auditUser }) {
  await queueWrite(async () => {
    const storedSettings = await getAllSettings();
    
    // Check for duplicates
    const exists = storedSettings.find((s) =>
      idsEqual(s?.userId, userId) && idsEqual(s?.tableId, tableId)
    );
    if (exists) {
      throw new Error(`Settings already exist for table "${tableId}" and user "${userId}"`);
    }
    
    const now = new Date().toISOString();

    const newRecord = {
      id: generateId(),
      userId,
      tableId,
      settings: settings || {},
      audit: {
        createUser: auditUser,
        createDateTime: now, 
        lastUpdateUser: auditUser,
        lastUpdateDateTime: now,
      }
    };

    const validity = validateData(newRecord);
    if (!validity.isValid) {
      throw new Error(validity.errors.join('\r\n'));
    }

    storedSettings.push(newRecord);
    await fs.writeFile(dataPath, JSON.stringify(storedSettings, null, 2));
    return newRecord;
  });
}

// Update OR Create if missing (Upsert)
async function updateSetting({ userId, tableId, settings, auditUser }) {
  // console.log(userId, tableId, settings, auditUser);
  await queueWrite(async () => {
    const storedSettings = await getAllSettings();

    const index = storedSettings.findIndex(
      (s) => idsEqual(s?.userId, userId) && idsEqual(s?.tableId, tableId)
    );
    
    const now = new Date().toISOString();
    let recordToSave;

    if (index !== -1) {
      // --- UPDATE EXISTING ---
      const current = storedSettings[index];
      
      recordToSave = {
        ...current,
        // Deep merge settings (or replace depending on use case - here we merge top level keys)
        settings: { ...current.settings, ...settings },
        audit: {
          ...current.audit,
          lastUpdateUser: auditUser,
          lastUpdateDateTime: now
        }
      };
      
      // Validate before saving
      const validity = validateData(recordToSave);
      if (!validity.isValid) throw new Error(validity.errors.join('\r\n'));

      storedSettings[index] = recordToSave;

    } else {
      // --- CREATE NEW (Upsert) ---
      recordToSave = {
        id: generateId(),
        userId,
        tableId,
        settings: settings || {},
        audit: {
          createUser: auditUser,
          createDateTime: now, 
          lastUpdateUser: auditUser,
          lastUpdateDateTime: now,
        }
      };

      const validity = validateData(recordToSave);
      if (!validity.isValid) throw new Error(validity.errors.join('\r\n'));

      storedSettings.push(recordToSave);
    }

    await fs.writeFile(dataPath, JSON.stringify(storedSettings, null, 2));
    return recordToSave;
  });
}

async function deleteSetting(userId, tableId) {
  await queueWrite(async () => {
    const storedSettings = await getAllSettings();
    
    const index = storedSettings.findIndex(
      (s) => idsEqual(s?.userId, userId) && idsEqual(s?.tableId, tableId)
    );
    
    if (index === -1) throw new Error('Settings not found in the database.');
    
    const filtered = storedSettings.filter(
      (s) => !(idsEqual(s?.userId, userId) && idsEqual(s?.tableId, tableId))
    );
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

async function deleteUserSettings(userId) {
  await queueWrite(async () => {
    if (userId === '*') {
      // Wipe everything
      await fs.writeFile(dataPath, JSON.stringify([], null, 2));
      return;
    }

    const storedSettings = await getAllSettings();
    // Check if any exist
    const exists = storedSettings.some((s) => idsEqual(s?.userId, userId));
    if (!exists) throw new Error('No settings found for this user.');

    const filtered = storedSettings.filter((s) => !idsEqual(s?.userId, userId));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  getAllSettings,
  querySettings,
  buildTableSettingsQueryPlan,
  getUserSettings,
  getUserTableSetting,
  addSetting,
  updateSetting,
  deleteSetting,
  deleteUserSettings
};
