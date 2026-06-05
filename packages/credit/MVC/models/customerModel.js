const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../services/credit/creditCoreContracts');

const FILE_PATH = path.join(__dirname, '../../../../data/credit/customers.json');

if (!fsSync.existsSync(FILE_PATH)) {
  fsSync.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  fsSync.writeFileSync(FILE_PATH, '[]');
}

function cleanString(value, { max = 500, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function sanitizeCustomerInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid customer payload.');
  }

  const orgId = cleanString(input.orgId, { max: 64, allowEmpty: false });
  const personId = cleanString(input.personId, { max: 120, allowEmpty: false });
  const personName = cleanString(input.personName, { max: 160, allowEmpty: false });

  if (!orgId) throw new Error('orgId is required.');
  if (!personId) throw new Error('personId is required.');
  if (!personName) throw new Error('Person name is required.');

  return {
    orgId: String(orgId),
    personId: String(personId),
    personName: String(personName),
    personEmail: cleanString(input.personEmail, { max: 200, allowEmpty: true }),
    personPhone: cleanString(input.personPhone, { max: 80, allowEmpty: true }),
    customerCode: cleanString(input.customerCode, { max: 100, allowEmpty: true }),
    status: cleanString(input.status, { max: 40, allowEmpty: true }) || 'active',
    notes: cleanString(input.notes, { max: 4000, allowEmpty: true }),
    createdBy: cleanString(input.createdBy, { max: 120, allowEmpty: true })
  };
}

function assertUniquePersonInOrg(allRows, candidate, { excludeId = null } = {}) {
  const exists = allRows.some((item) => {
    if (excludeId && String(item.id) === String(excludeId)) return false;
    return String(item.orgId || '') === String(candidate.orgId)
      && String(item.personId || '') === String(candidate.personId);
  });

  if (exists) {
    throw new Error('This person is already registered as a financial customer in the active organization.');
  }
}

async function getAllCustomers() {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (_) {
    return [];
  }
}

async function getCustomerById(id) {
  const list = await getAllCustomers();
  return list.find((item) => String(item.id) === String(id)) || null;
}

async function addCustomer(payload) {
  return await queueWrite(async () => {
    const list = await getAllCustomers();
    const sanitized = sanitizeCustomerInput(payload);
    assertUniquePersonInOrg(list, sanitized);

    const item = {
      id: `CRC_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      ...sanitized,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    list.push(item);
    await fs.writeFile(FILE_PATH, JSON.stringify(list, null, 2));
    return item;
  });
}

async function updateCustomer(id, payload) {
  return await queueWrite(async () => {
    const list = await getAllCustomers();
    const index = list.findIndex((item) => String(item.id) === String(id));
    if (index === -1) throw new Error('Customer not found.');

    const existing = list[index];
    const sanitized = sanitizeCustomerInput({
      ...payload,
      orgId: existing.orgId || payload?.orgId
    });

    if (existing.orgId && String(existing.orgId) !== String(sanitized.orgId)) {
      throw new Error('Security violation: orgId mismatch.');
    }

    sanitized.orgId = existing.orgId || sanitized.orgId;
    assertUniquePersonInOrg(list, sanitized, { excludeId: existing.id });

    const updated = {
      ...existing,
      ...sanitized,
      updatedAt: new Date().toISOString()
    };

    list[index] = updated;
    await fs.writeFile(FILE_PATH, JSON.stringify(list, null, 2));
    return updated;
  });
}

async function deleteCustomer(id) {
  return await queueWrite(async () => {
    const list = await getAllCustomers();
    const filtered = list.filter((item) => String(item.id) !== String(id));
    if (filtered.length === list.length) return false;
    await fs.writeFile(FILE_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  getAllCustomers,
  getCustomerById,
  addCustomer,
  updateCustomer,
  deleteCustomer
};
