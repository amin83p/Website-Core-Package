// MVC/models/scopeModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');
const { normalizeScopeDefinition } = require('../utils/scopeDefinitionHelper');

const dataPath = path.join(__dirname, '../../data/scopes.json');

async function getAllScopes() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed)
      ? parsed.map((item) => ({
          ...item,
          definition: normalizeScopeDefinition(item?.definition, item?.name)
        }))
      : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function buildScopeQueryPlan(options = {}) {
  const query = options?.query || {};

  return {
    entity: 'scopes',
    query,
    scope: options?.scope || {},
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'name', 'description'],
      dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryScopes(options = {}) {
  const plan = buildScopeQueryPlan(options);
  const executor = getEntityQueryExecutor('scopes');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allScopes = await getAllScopes();
  return applyGenericFilter(allScopes, plan.query, plan.fallback);
}

async function getScopeById(id) {
  const scopes = await getAllScopes();
  return scopes.find(s => s.id === id);
}

// Generate ID: SCP1001, SCP1002, etc.
function generateNextId(scopes) {
  let maxId = 1000;
  
  scopes.forEach(s => {
    if (s.id && s.id.startsWith('SCP')) {
      const numPart = parseInt(s.id.substring(3), 10);
      if (!isNaN(numPart) && numPart > maxId && numPart < 9000) {
        maxId = numPart;
      }
    }
  });

  const nextIdVal = maxId + 1;
  if (nextIdVal > 8999) {
    throw new Error('Maximum Scope ID limit (SCP8999) reached.');
  }

  return 'SCP' + nextIdVal;
}

function validateData(scope) {
  const errors = [];
  const nameRegex = /^[A-Z][A-Z_]*[A-Z]$/; // Uppercase & Underscores only

  if (!scope || typeof scope !== 'object') {
    return { isValid: false, errors: ['Scope must be a valid object.'] };
  }

  // Name Validation
  if (!scope.name || typeof scope.name !== 'string') {
    errors.push('Name is required.');
  } else if (!nameRegex.test(scope.name)) {
    errors.push('Name must be uppercase, use underscores instead of spaces, and contain no other characters.');
  }

  // ✅ Level Validation (0 to Infinity)
  if (scope.level === undefined || scope.level === null || scope.level === '') {
     errors.push('Level is required.');
  } else if (!Number.isInteger(scope.level) || scope.level < 0 || scope.level>100) {
     errors.push('Level must be a positive integer (0 or greater and less than 100).');
  }

  if (typeof scope.active !== 'boolean') {
    errors.push('Active must be a boolean.');
  }

  if (!scope.definition || typeof scope.definition !== 'object') {
    errors.push('Definition is required.');
  } else if (!scope.definition.mode) {
    errors.push('Definition mode is required.');
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ---------------- CRUD ACTIONS ---------------- */

async function addScope(scope) {
  await queueWrite(async () => {
    const scopes = await getAllScopes();
    
    // Check Duplicate Name
    if (scopes.find(s => s.name === scope.name)) {
      throw new Error('Scope name already exists');
    }

    scope.id = generateNextId(scopes);
    scope.definition = normalizeScopeDefinition(scope.definition, scope.name);

    const resultValidity = validateData(scope);
    if(!resultValidity.isValid){
      throw new Error(resultValidity.errors.join("\r\n"));
    }

    scopes.push(scope);
    await fs.writeFile(dataPath, JSON.stringify(scopes, null, 2));
  });
}

async function updateScope(id, updates) {
  await queueWrite(async () => {
    const scopes = await getAllScopes();
    const index = scopes.findIndex(s => s.id === id);
    
    if (index === -1) throw new Error('Scope not found');
    
    const currentScope = scopes[index];

    // Check Duplicate Name
    if (updates.name && scopes.some(s => s.id !== id && s.name === updates.name)) {
      throw new Error('Scope name already exists');
    }

    // Deep Merge
    const merged = {
      ...currentScope,
      ...updates,
      audit: { ...currentScope.audit, ...(updates.audit || {}) }
    };
    merged.definition = normalizeScopeDefinition(merged.definition, merged.name);

    const resultValidity = validateData(merged);
    if(!resultValidity.isValid){
      throw new Error(resultValidity.errors.join("\r\n"));
    }

    scopes[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(scopes, null, 2));
  });
}

async function deleteScope(id) {
  await queueWrite(async () => {
    const scopes = await getAllScopes();
    const index = scopes.findIndex(s => s.id === id);
    
    if (index === -1) throw new Error('Scope not found');

    scopes.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(scopes, null, 2));
  });
}

module.exports = { 
  getAllScopes, 
  queryScopes,
  buildScopeQueryPlan,
  getScopeById, 
  addScope, 
  updateScope, 
  deleteScope 
};
