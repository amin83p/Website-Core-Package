// MVC/models/contractModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue'); // Assuming you have this helper
const { applyGenericFilter } = require('../utils/queryEngine');
const { idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/contracts.json');

async function getAllContracts() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve contracts');
  }
}

function buildContractQueryPlan(options = {}) {
  const query = options?.query || {};

  return {
    entity: 'contracts',
    query,
    scope: options?.scope || {},
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'orgId', 'name', 'status', 'type'],
      dateFields: ['startDate', 'endDate', 'createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryContracts(options = {}) {
  const plan = buildContractQueryPlan(options);
  const executor = getEntityQueryExecutor('contracts');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allContracts = await getAllContracts();
  return applyGenericFilter(allContracts, plan.query, plan.fallback);
}

async function getContractById(id) {
  const list = await getAllContracts();
  return list.find((c) => idsEqual(c?.id, id));
}

function generateId() {
  return 'CNT-' + Math.random().toString(36).substring(2, 9).toUpperCase();
}

function validateData(item) {
  const errors = [];
  if (!item.orgId) errors.push('Organization Association (orgId) is required.');
  if (!item.title) errors.push('Contract Title is required.');
  if (!item.status) errors.push('Status is required.');
  
  return errors.length ? { isValid: false, errors } : { isValid: true };
}

async function addContract(item) {
  await queueWrite(async () => {
    const list = await getAllContracts();
    item.id = generateId();
    
    const validity = validateData(item);
    if (!validity.isValid) throw new Error(validity.errors.join('\n'));

    list.push(item);
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
    return item;
  });
}

async function updateContract(id, updates) {
  await queueWrite(async () => {
    const list = await getAllContracts();
    const index = list.findIndex((c) => idsEqual(c?.id, id));
    if (index === -1) throw new Error('Contract not found');

    const current = list[index];
    const merged = { ...current, ...updates };

    const validity = validateData(merged);
    if (!validity.isValid) throw new Error(validity.errors.join('\n'));

    list[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
  });
}

async function deleteContract(id) {
  await queueWrite(async () => {
    const list = await getAllContracts();
    const filtered = list.filter((c) => !idsEqual(c?.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  getAllContracts,
  queryContracts,
  buildContractQueryPlan,
  getContractById,
  addContract,
  updateContract,
  deleteContract
};
