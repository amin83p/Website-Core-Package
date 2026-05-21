// MVC/models/operationModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/operations.json');
const sectionsPath = path.join(__dirname, '../../data/sections.json');

async function getAllOperations() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function buildOperationQueryPlan(options = {}) {
  const query = options?.query || {};

  return {
    entity: 'operations',
    query,
    scope: options?.scope || {},
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'name', 'sectionId', 'description'],
      dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryOperations(options = {}) {
  const plan = buildOperationQueryPlan(options);
  const executor = getEntityQueryExecutor('operations');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allOperations = await getAllOperations();
  return applyGenericFilter(allOperations, plan.query, plan.fallback);
}

async function getOperationById(id) {
  const operations = await getAllOperations();
  return operations.find(op => op.id === id);
}
async function getOperationByName(name) {
  const operations = await getAllOperations();
  return operations.find(op => op.name === name);
}

// Helper to get sections for dependency check
async function getAllSections() {
  try {
    const data = await fs.readFile(sectionsPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    return [];
  }
}

function generateNextId(operations) {
  let maxId = 1000;
  
  operations.forEach(op => {
    if (op.id && op.id.startsWith('OP')) {
      const numPart = parseInt(op.id.substring(2), 10);
      if (!isNaN(numPart) && numPart > maxId && numPart < 9000) {
        maxId = numPart;
      }
    }
  });

  const nextIdVal = maxId + 1;
  if (nextIdVal > 8999) {
    throw new Error('Maximum Operation ID limit (OP8999) reached.');
  }

  return 'OP' + nextIdVal;
}

/* ---------------- VALIDATION ---------------- */

function validateData(operation) {
  const errors = [];
  const nameRegex = /^[A-Z][A-Z_]*[A-Z]$/;

  if (!operation || typeof operation !== 'object') {
    return { isValid: false, errors: ['Operation must be a valid object.'] };
  }

  // Name Validation
  if (!operation.name || typeof operation.name !== 'string') {
    errors.push('Name is required.');
  } else if (!nameRegex.test(operation.name)) {
    errors.push('Name must be uppercase, use underscores instead of spaces, and contain no other characters.');
  }

  if (typeof operation.active !== 'boolean') {
    errors.push('Active must be a boolean.');
  }

  // ✅ NEW: Track State Validation
  if (operation.trackState !== undefined && typeof operation.trackState !== 'boolean') {
    errors.push('Track State must be a boolean.');
  }

  // System flag check
  if (operation.system !== undefined && typeof operation.system !== 'boolean') {
    errors.push('System flag must be a boolean.');
  }

  // Audit Validation
  const audit = operation.audit || {};
  if (!audit.createUser || typeof audit.createUser !== 'string') {
    errors.push('Creator User ID is missing or invalid.');
  }

  if (!audit.lastUpdateUser || typeof audit.lastUpdateUser !== 'string') {
    errors.push('Last Update User ID is missing or invalid.');
  }

  if (operation.keepActive !== undefined && typeof operation.keepActive !== 'boolean') {
    errors.push('Keep Active must be a boolean.');
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ---------------- CRUD ACTIONS ---------------- */

async function addOperation(operation) {
  await queueWrite(async () => {
    const operations = await getAllOperations();
    
    // 1. Check Duplicate Name
    if (operations.find(op => op.name === operation.name)) {
      throw new Error('Operation name already exists');
    }

    // 2. Generate Sequential ID (OP1001 - OP8999)
    operation.id = generateNextId(operations);

    // 3. Validate
    const resultValidity = validateData(operation);
    if(!resultValidity.isValid){
      throw new Error(resultValidity.errors.join("\r\n"));
    }

    operations.push(operation);
    await fs.writeFile(dataPath, JSON.stringify(operations, null, 2));
  });
}

async function updateOperation(id, updates) {
  await queueWrite(async () => {
    const operations = await getAllOperations();
    const index = operations.findIndex(op => op.id === id);
    
    if (index === -1) throw new Error('Operation not found');
    
    const currentOp = operations[index];

    // 1. System Check
    if (currentOp.system === true) {
      throw new Error('System operations cannot be edited.');
    }

    // 2. Duplicate Name Check
    if (updates.name && operations.some(op => op.id !== id && op.name === updates.name)) {
      throw new Error('Operation name already exists');
    }

    // 3. Deep Merge Logic
    const merged = {
      ...currentOp,
      ...updates,
      // Ensure system flag isn't accidentally overwritten by UI
      system: currentOp.system, 
      // Deep merge audit
      audit: { ...currentOp.audit, ...(updates.audit || {}) }
    };

    // 4. Validate
    const resultValidity = validateData(merged);
    if(!resultValidity.isValid){
      throw new Error(resultValidity.errors.join("\r\n"));
    }

    operations[index] = merged;

    try {
      await fs.writeFile(dataPath, JSON.stringify(operations, null, 2));
    } catch (writeError) {
      throw new Error(`Failed to write operation data: ${writeError.message}`);
    }
  });
}

async function deleteOperation(id) {
  await queueWrite(async () => {
    const operations = await getAllOperations();
    const index = operations.findIndex(op => op.id === id);
    
    if (index === -1) throw new Error('Operation not found');

    const opToDelete = operations[index];

    // 1. System Check
    if (opToDelete.system === true) {
      throw new Error('System operations cannot be deleted.');
    }

    // 2. Dependency Check (Sections)
    const sections = await getAllSections();
    const usedInSection = sections.find(sec => 
      Array.isArray(sec.operations) && 
      sec.operations.some(opRef => opRef.id === id)
    );

    if (usedInSection) {
      throw new Error(`Cannot delete: Operation is used in section "${usedInSection.name}" (ID: ${usedInSection.id}).`);
    }

    // 3. Delete
    operations.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(operations, null, 2));
  });
}

module.exports = { 
  getAllOperations, 
  queryOperations,
  buildOperationQueryPlan,
  getOperationById, 
  getOperationByName,
  addOperation, 
  updateOperation, 
  deleteOperation 
};
