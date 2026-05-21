// MVC/models/symbolModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const fileService = require('../services/fileService');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/symbols.json');

/* ---------------- READERS ---------------- */

async function getAllSymbols() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function applySymbolScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const includeGlobal = scope?.includeGlobal !== false;
  const orgId = toPublicId(scope?.orgId) || null;

  return list.filter((row) => {
    const itemOrgId = toPublicId(row?.orgId) || null;
    if (includeGlobal && (!itemOrgId || itemOrgId === 'SYSTEM')) return true;
    if (orgId && idsEqual(itemOrgId, orgId)) return true;
    return false;
  });
}

function buildSymbolQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'symbols',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      includeGlobal: incomingScope?.includeGlobal !== false,
      orgId: toPublicId(incomingScope?.orgId) || null
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'name', 'orgId', 'description', 'tags[0]', 'tags[1]', 'tags[2]'],
      dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function querySymbols(options = {}) {
  const plan = buildSymbolQueryPlan(options);
  const executor = getEntityQueryExecutor('symbols');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const getAllSymbolsFn = module.exports?.getAllSymbols;
  const allSymbols = await (typeof getAllSymbolsFn === 'function'
    ? getAllSymbolsFn()
    : getAllSymbols());
  const scopedSymbols = applySymbolScope(allSymbols, plan.scope);
  return applyGenericFilter(scopedSymbols, plan.query, plan.fallback);
}

async function getSymbolById(id) {
  const symbols = await getAllSymbols();
  return symbols.find((s) => idsEqual(s?.id, id));
}

/* ---------------- HELPERS ---------------- */

// ✅ NEW: ID Generation includes Org ID (SYM_100_001)
function generateNextId(symbols, orgId) {
  const prefix = `SYM_${orgId}_`;
  let maxId = 0;
  
  symbols.forEach(s => {
    if (s.id && s.id.startsWith(prefix)) {
      const suffix = s.id.replace(prefix, '');
      const numPart = parseInt(suffix, 10);
      if (!isNaN(numPart) && numPart > maxId) {
        maxId = numPart;
      }
    }
  });
  
  return prefix + String(maxId + 1).padStart(3, '0');
}

// ✅ NEW: Uniqueness check is now scoped to the Org
function checkUniqueTags(newTags, allSymbols, orgId, excludeId = null) {
  if (!newTags || !Array.isArray(newTags)) return;

  for (const sym of allSymbols) {
    // 1. Skip self (for updates)
    if (excludeId && idsEqual(sym?.id, excludeId)) continue;

    // 2. Skip symbols from other organizations
    if (!idsEqual(sym?.orgId, orgId)) continue;

    if (Array.isArray(sym.tags)) {
      const conflict = newTags.find(tag => sym.tags.includes(tag));
      if (conflict) {
        throw new Error(`The label <b>"${conflict}"</b> is already in use by symbol <b>"${sym.name}"</b> in this organization.`);
      }
    }
  }
}

/* ---------------- VALIDATION ---------------- */

function validateData(symbol) {
  const errors = [];
  
  if (!symbol.orgId) {
      errors.push('Organization ID is missing.');
  }

  if (!symbol.name || typeof symbol.name !== 'string') {
    errors.push('Symbol Name is required.');
  } else if (!/^[A-Z][A-Z0-9_]*$/.test(symbol.name)) {
    errors.push('Symbol Name must be uppercase, alphanumeric, and use underscores.');
  }

  if (!['class', 'image', 'raw'].includes(symbol.type)) {
    errors.push('Invalid Symbol Type.');
  }

  if ((!symbol.value || typeof symbol.value !== 'string') && symbol.type !== 'image') {
    errors.push('Symbol Value is required.');
  }

  if (symbol.tags && !Array.isArray(symbol.tags)) {
      errors.push('Tags must be an array of strings.');
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ---------------- CRUD ACTIONS ---------------- */

async function addSymbol(symbol) {
  await queueWrite(async () => {
    const symbols = await getAllSymbols();
    
    // 1. Check Duplicate Name (Scoped to Org)
    const nameExists = symbols.find((s) => s.name === symbol.name && idsEqual(s?.orgId, symbol?.orgId));
    if (nameExists) {
      throw new Error('Symbol unique name already exists in this organization.');
    }

    // 2. Check Duplicate Tags (Scoped to Org)
    if (symbol.tags && symbol.tags.length > 0) {
        checkUniqueTags(symbol.tags, symbols, symbol.orgId);
    }

    // 3. Generate Scoped ID & Validate
    symbol.id = generateNextId(symbols, symbol.orgId);
    
    const validity = validateData(symbol);
    if (!validity.isValid) throw new Error(validity.errors.join('\n'));

    symbols.push(symbol);
    await fs.writeFile(dataPath, JSON.stringify(symbols, null, 2));
  });
  return symbol;
}

async function updateSymbol(id, updates) {
  await queueWrite(async () => {
    const symbols = await getAllSymbols();
    const index = symbols.findIndex((s) => idsEqual(s?.id, id));
    if (index === -1) throw new Error('Symbol not found.');
    //
    const current = symbols[index];
    const theCurrentValue = current.value;
    const theCurrentType = current.type;
    // Keep the original Org ID (cannot move symbols between orgs)
    const orgId = current.orgId; 

    // Check Name Duplication (Scoped)
    if (updates.name && updates.name !== current.name) {
       const nameExists = symbols.find((s) => s.name === updates.name && idsEqual(s?.orgId, orgId));
       if (nameExists) {
         throw new Error('Symbol unique name already exists in this organization.');
       }
    }

    const merged = { ...current, ...updates, id: current.id, orgId: orgId }; 
    
    // Check Tags (Scoped)
    if (merged.tags && merged.tags.length > 0) {
        checkUniqueTags(merged.tags, symbols, orgId, id);
    }

    const validity = validateData(merged);
    if (!validity.isValid) throw new Error(validity.errors.join('\n'));

    symbols[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(symbols, null, 2));
    //If the previous version has a image or file, check it and if it has changed, delete it.
    //console.log(theCurrentValue,symbols[index].value);
    if(theCurrentValue!==symbols[index].value && theCurrentType==='image'){
      await fileService.deleteFile(theCurrentValue);
    }
  });
}

async function deleteSymbol(id) {
  await queueWrite(async () => {
    const symbols = await getAllSymbols();
    const index = symbols.findIndex((s) => idsEqual(s?.id, id));
    if (index === -1) throw new Error('Symbol not found.');
    //
    const filtered = symbols.filter((s) => !idsEqual(s?.id, id));
    // if (filtered.length === symbols.length) throw new Error('Symbol not found.');
    //Delete the attached file if any
    if(symbols[index].value.length>0 && symbols[index].type==='image'){
      await fileService.deleteFile(symbols[index].value);
    }
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  getAllSymbols,
  querySymbols,
  buildSymbolQueryPlan,
  getSymbolById,
  addSymbol,
  updateSymbol,
  deleteSymbol
};
