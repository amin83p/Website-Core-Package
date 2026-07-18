const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/funders.json');
if (!fsSync.existsSync(dataPath)) fsSync.writeFileSync(dataPath, '[]');

const FUNDER_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

function cleanString(value, { max = 500, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const cleaned = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !cleaned) return null;
  return cleaned.slice(0, max);
}

function cleanId(value, { max = 64, allowEmpty = false } = {}) {
  const cleaned = cleanString(value, { max, allowEmpty });
  if (cleaned === null) return null;
  if (!cleaned) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9._-]+$/.test(cleaned)) throw new Error('Invalid id format.');
  return cleaned;
}

function cleanAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).filter((item) => item && typeof item === 'object').map((item) => ({
    id: cleanString(item.id, { max: 80, allowEmpty: true }),
    name: cleanString(item.name, { max: 255, allowEmpty: true }),
    url: cleanString(item.url, { max: 1000, allowEmpty: true })
  }));
}

function sanitizeFunderInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid funder payload.');
  const orgId = cleanId(input.orgId, { allowEmpty: false });
  const personId = cleanId(input.personId, { allowEmpty: false });
  const status = (cleanString(input.status, { max: 20, allowEmpty: true }) || 'active').toLowerCase();
  if (!orgId) throw new Error('orgId is required for funder records.');
  if (!personId) throw new Error('personId is required for funder records.');
  if (!FUNDER_STATUSES.includes(status)) throw new Error('Invalid funder status.');

  const output = {
    orgId: String(orgId),
    personId: String(personId),
    funderAccountId: cleanId(input.funderAccountId, { allowEmpty: true }),
    status,
    externalReference: cleanString(input.externalReference, { max: 120, allowEmpty: true }),
    notes: cleanString(input.notes, { max: 5000, allowEmpty: true }),
    attachments: cleanAttachments(input.attachments)
  };
  if (!isUpdate && input.id) output.id = cleanId(input.id, { max: 64, allowEmpty: false });
  return output;
}

function generateFunderId(ids) {
  for (let i = 0; i < 30; i += 1) {
    const id = `FUN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    if (!ids.has(id)) return id;
  }
  return `FUN_${Date.now()}`;
}

async function getAllFunders() {
  try { return JSON.parse(await fs.readFile(dataPath, 'utf8') || '[]'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw new Error('Failed to retrieve Funders'); }
}

async function getFunderById(id) {
  return (await getAllFunders()).find((row) => String(row.id) === String(id)) || null;
}

async function addFunder(input, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllFunders();
    const row = sanitizeFunderInput(input);
    if (all.some((item) => String(item.orgId) === row.orgId && String(item.personId) === row.personId && item.status !== 'archived')) {
      throw new Error('This Person is already registered as a Funder in the active organization.');
    }
    const id = row.id || generateFunderId(new Set(all.map((item) => String(item.id))));
    const created = { ...row, id, audit: { createDateTime: new Date().toISOString() } };
    all.push(created);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return created;
  });
}

async function updateFunder(id, input, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllFunders();
    const index = all.findIndex((item) => String(item.id) === String(id));
    if (index < 0) throw new Error('Funder not found.');
    const existing = all[index];
    const row = sanitizeFunderInput({ ...existing, ...input, orgId: existing.orgId, personId: existing.personId }, { isUpdate: true });
    all[index] = { ...existing, ...row, audit: { ...(existing.audit || {}), lastUpdateDateTime: new Date().toISOString() } };
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteFunder(id, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllFunders();
    const index = all.findIndex((item) => String(item.id) === String(id));
    if (index < 0) return false;
    if (String(all[index].status).toLowerCase() === 'archived') return all[index];
    all[index] = { ...all[index], status: 'archived', audit: { ...(all[index].audit || {}), lastUpdateDateTime: new Date().toISOString() } };
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

module.exports = { getAllFunders, getFunderById, addFunder, updateFunder, deleteFunder, sanitizeFunderInput, FUNDER_STATUSES };
