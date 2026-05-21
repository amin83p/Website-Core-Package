// MVC/models/school/transactionDefinitionModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const schoolAccountModel = require('./schoolAccountModel');

const dataPath = path.join(__dirname, '../../../data/school/transactionDefinitions.json');
const legacyDataPath = path.join(__dirname, '../../../data/school/feeDefinitions.json');

if (!fsSync.existsSync(dataPath)) {
  if (fsSync.existsSync(legacyDataPath)) {
    fsSync.copyFileSync(legacyDataPath, dataPath);
  } else {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

const TRANSACTION_DEFINITION_STATUSES = new Set(['draft', 'active', 'inactive', 'archived']);
const ACCOUNT_REF_KINDS = Object.freeze(['ACCOUNT', 'ROLE']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 64, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid id format. Use only letters, numbers, underscore, dash.');
  return s;
}

function cleanNumber(v, { min = 0, max = Number.MAX_SAFE_INTEGER, allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? null : NaN;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('Invalid number value.');
  if (n < min || n > max) throw new Error('Number value out of range.');
  return n;
}

function roundToTwo(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function normalizePercentage(value) {
  const num = cleanNumber(value, { min: 0, max: 100, allowEmpty: true });
  if (num === null) return null;
  return roundToTwo(num);
}

function cleanDateISO(v, { allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? '' : null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date value.');
  return s;
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (!role) throw new Error('Role account reference value is required.');
  if (!schoolAccountModel.ACCOUNT_PARTY_ROLES.includes(role) || role === 'none') {
    throw new Error(`Invalid role account reference: ${value}`);
  }
  return role;
}

function parseAccountRef(rawInput) {
  const raw = cleanString(rawInput, { max: 160, allowEmpty: false });
  if (!raw) throw new Error('Account reference is required.');

  if (/^[A-Za-z0-9_-]+$/.test(raw)) {
    const directId = cleanId(raw, { max: 80, allowEmpty: false });
    return { kind: 'ACCOUNT', value: directId, ref: `ACCOUNT:${directId}` };
  }

  const parts = raw.split(':');
  if (parts.length !== 2) throw new Error(`Invalid account reference format: ${raw}`);

  const kind = String(parts[0] || '').trim().toUpperCase();
  const valueRaw = String(parts[1] || '').trim();
  if (!ACCOUNT_REF_KINDS.includes(kind)) throw new Error(`Invalid account reference kind: ${kind}`);

  if (kind === 'ACCOUNT') {
    const accountId = cleanId(valueRaw, { max: 80, allowEmpty: false });
    return { kind, value: accountId, ref: `ACCOUNT:${accountId}` };
  }

  const role = normalizeRole(valueRaw);
  return { kind, value: role, ref: `ROLE:${role}` };
}

function assignEntryPercentages(entriesInput) {
  const entries = Array.isArray(entriesInput) ? entriesInput.map((entry) => ({ ...entry })) : [];
  if (!entries.length) return entries;

  const amounts = entries.map((entry) => roundToTwo(entry.amount));
  const positiveIndexes = amounts
    .map((amount, index) => ({ amount, index }))
    .filter((row) => row.amount > 0);
  const runtimeIndexes = amounts
    .map((amount, index) => ({ amount, index }))
    .filter((row) => !(row.amount > 0));

  if (positiveIndexes.length && runtimeIndexes.length) {
    const providedRuntimePercentages = runtimeIndexes.map((row) => normalizePercentage(entries[row.index].percentage));
    const hasAnyProvidedRuntimePercentage = providedRuntimePercentages.some((value) => value !== null);
    let normalizedRuntimePercentages = providedRuntimePercentages.map((value) => (value === null ? 0 : value));

    if (!hasAnyProvidedRuntimePercentage) {
      if (runtimeIndexes.length === 1) {
        normalizedRuntimePercentages = [100];
      } else {
        const evenShare = roundToTwo(100 / runtimeIndexes.length);
        let running = 0;
        normalizedRuntimePercentages = runtimeIndexes.map((_, index) => {
          const percentage = index === runtimeIndexes.length - 1
            ? roundToTwo(100 - running)
            : evenShare;
          running += percentage;
          return percentage;
        });
      }
    }

    const runtimeTotal = roundToTwo(normalizedRuntimePercentages.reduce((sum, value) => sum + Number(value || 0), 0));
    if (Math.abs(runtimeTotal - 100) > 0.01) {
      throw new Error(`Runtime template percentages must total 100. Current total is ${runtimeTotal.toFixed(2)}.`);
    }

    return entries.map((entry, index) => {
      const runtimeIndex = runtimeIndexes.findIndex((row) => row.index === index);
      if (runtimeIndex === -1) {
        return { ...entry, percentage: 0 };
      }
      return { ...entry, percentage: roundToTwo(normalizedRuntimePercentages[runtimeIndex]) };
    });
  }

  if (positiveIndexes.length) {
    const totalAmount = positiveIndexes.reduce((sum, row) => sum + row.amount, 0);
    let running = 0;
    const lastPositiveIndex = positiveIndexes[positiveIndexes.length - 1].index;

    return entries.map((entry, index) => {
      const amount = amounts[index];
      if (!(amount > 0) || totalAmount <= 0) {
        return { ...entry, percentage: 0 };
      }
      const percentage = index === lastPositiveIndex
        ? roundToTwo(100 - running)
        : roundToTwo((amount / totalAmount) * 100);
      running += percentage;
      return { ...entry, percentage };
    });
  }

  const providedPercentages = entries.map((entry) => normalizePercentage(entry.percentage));
  const hasAnyProvidedPercentage = providedPercentages.some((value) => value !== null);
  let normalizedPercentages = providedPercentages.map((value) => (value === null ? 0 : value));

  if (!hasAnyProvidedPercentage) {
    if (entries.length === 1) {
      normalizedPercentages = [100];
    } else {
      const evenShare = roundToTwo(100 / entries.length);
      let running = 0;
      normalizedPercentages = entries.map((_, index) => {
        const percentage = index === entries.length - 1
          ? roundToTwo(100 - running)
          : evenShare;
        running += percentage;
        return percentage;
      });
    }
  }

  const totalPercentage = roundToTwo(normalizedPercentages.reduce((sum, value) => sum + Number(value || 0), 0));
  if (Math.abs(totalPercentage - 100) > 0.01) {
    throw new Error(`Runtime template percentages must total 100. Current total is ${totalPercentage.toFixed(2)}.`);
  }

  return entries.map((entry, index) => ({
    ...entry,
    percentage: roundToTwo(normalizedPercentages[index])
  }));
}

function sanitizeEntries(entriesInput, fallbackEntry) {
  let entries = entriesInput;

  if ((!Array.isArray(entries) || entries.length === 0) && isPlainObject(fallbackEntry)) {
    const auto = fallbackEntry;
    if (auto.enabled && auto.debitAccountId && auto.creditAccountId) {
      entries = [{
        debitRef: `ACCOUNT:${auto.debitAccountId}`,
        creditRef: `ACCOUNT:${auto.creditAccountId}`,
        amount: auto.fixedAmount,
        currency: fallbackEntry.currency || 'CAD',
        memoTemplate: auto.memoTemplate || ''
      }];
    }
  }

  if (!Array.isArray(entries)) throw new Error('entries must be an array.');
  if (entries.length === 0) throw new Error('At least one posting entry is required.');
  if (entries.length > 200) throw new Error('Too many posting entries.');

  return assignEntryPercentages(entries.map((line, idx) => {
    if (!isPlainObject(line)) throw new Error('Each posting entry must be an object.');

    const debit = parseAccountRef(line.debitRef || line.debitAccountRef || line.debitAccountId);
    const credit = parseAccountRef(line.creditRef || line.creditAccountRef || line.creditAccountId);
    const amount = roundToTwo(cleanNumber(line.amount, { min: 0, max: 1000000000, allowEmpty: false }));
    const currency = cleanString(line.currency, { max: 3, allowEmpty: true }).toUpperCase() || 'CAD';
    const percentage = normalizePercentage(line.percentage);

    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency. Use ISO code like CAD.');
    if (debit.kind === credit.kind && String(debit.value) === String(credit.value)) {
      throw new Error(`Posting entry #${idx + 1} cannot use the same account reference on both sides.`);
    }

    return {
      entryId: cleanId(line.entryId, { max: 60, allowEmpty: true }) || `ENTRY_${idx + 1}`,
      debitRef: debit.ref,
      creditRef: credit.ref,
      amount,
      percentage,
      currency,
      memoTemplate: cleanString(line.memoTemplate, { max: 500, allowEmpty: true }),
      notes: cleanString(line.notes, { max: 1000, allowEmpty: true })
    };
  }));
}

function migrateLegacyRecord(record) {
  if (!isPlainObject(record)) return record;
  if (Array.isArray(record.entries) && record.entries.length) {
    return {
      ...record,
      entries: assignEntryPercentages(record.entries.map((entry, index) => ({
        entryId: cleanId(entry?.entryId, { max: 60, allowEmpty: true }) || `ENTRY_${index + 1}`,
        debitRef: String(entry?.debitRef || entry?.debitAccountRef || entry?.debitAccountId || '').trim(),
        creditRef: String(entry?.creditRef || entry?.creditAccountRef || entry?.creditAccountId || '').trim(),
        amount: roundToTwo(entry?.amount),
        percentage: normalizePercentage(entry?.percentage),
        currency: cleanString(entry?.currency, { max: 3, allowEmpty: true }).toUpperCase() || 'CAD',
        memoTemplate: cleanString(entry?.memoTemplate, { max: 500, allowEmpty: true }),
        notes: cleanString(entry?.notes, { max: 1000, allowEmpty: true })
      })))
    };
  }

  const auto = isPlainObject(record.autoTransaction) ? record.autoTransaction : null;
  if (!auto || !auto.enabled || !auto.debitAccountId || !auto.creditAccountId) {
    return { ...record, entries: Array.isArray(record.entries) ? record.entries : [] };
  }

  const migrated = {
    ...record,
    entries: [{
      entryId: 'ENTRY_1',
      debitRef: `ACCOUNT:${auto.debitAccountId}`,
      creditRef: `ACCOUNT:${auto.creditAccountId}`,
      amount: roundToTwo(Number(auto.fixedAmount || record.defaultAmount || 0) || 0),
      percentage: 100,
      currency: String(record.currency || 'CAD').toUpperCase(),
      memoTemplate: String(auto.memoTemplate || ''),
      notes: ''
    }]
  };

  delete migrated.autoTransaction;
  delete migrated.defaultAmount;
  delete migrated.frequency;
  delete migrated.applicableFeeCategories;
  delete migrated.tags;
  delete migrated.type;
  delete migrated.taxable;
  delete migrated.isOptional;
  return migrated;
}

function sanitizeTransactionDefinitionInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid transaction definition payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');

  const code = cleanString(input.code, { max: 40, allowEmpty: false }).toUpperCase();
  const name = cleanString(input.name, { max: 120, allowEmpty: false });
  if (!code) throw new Error('code is required.');
  if (!name) throw new Error('name is required.');
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    throw new Error('Invalid code format. Use letters, numbers, underscore, dash.');
  }

  const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'active';
  if (!TRANSACTION_DEFINITION_STATUSES.has(status)) throw new Error('Invalid status.');
  const validFrom = cleanDateISO(input.validFrom, { allowEmpty: true });
  const validTo = cleanDateISO(input.validTo, { allowEmpty: true });
  if (validFrom && validTo && validFrom > validTo) {
    throw new Error('validTo cannot be earlier than validFrom.');
  }

  const out = {
    orgId: String(orgId),
    code,
    name,
    description: cleanString(input.description, { max: 5000, allowEmpty: true }),
    status,
    validFrom,
    validTo,
    entries: sanitizeEntries(input.entries, input.autoTransaction),
    notes: cleanString(input.notes, { max: 5000, allowEmpty: true }),
    metadata: isPlainObject(input.metadata) ? input.metadata : {}
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 40, allowEmpty: false });
  }

  return out;
}

async function assertEntryReferencesValid(orgId, entries) {
  const allAccounts = await schoolAccountModel.getAllAccounts();
  const allowedOrgIds = new Set([String(orgId || ''), 'SYSTEM']);

  for (const entry of entries || []) {
    for (const refRaw of [entry.debitRef, entry.creditRef]) {
      const ref = parseAccountRef(refRaw);
      if (ref.kind !== 'ACCOUNT') continue;

      const account = allAccounts.find((a) => String(a.id) === String(ref.value));
      if (!account) throw new Error(`Referenced account was not found: ${ref.value}`);
      if (!allowedOrgIds.has(String(account.orgId || ''))) {
        throw new Error(`Referenced account ${ref.value} is outside organization scope.`);
      }
      if (!account.allowPost || String(account.status || '').toLowerCase() !== 'active') {
        throw new Error(`Referenced account ${ref.value} must be active and postable.`);
      }
    }
  }
}

function generateTransactionDefinitionId(existingIds) {
  for (let i = 0; i < 50; i++) {
    const candidate = `TRX${Math.floor(10000 + Math.random() * 90000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `TRX${Date.now()}`;
}

async function getAllTransactionDefinitions() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(data || '[]');
    if (!Array.isArray(parsed)) return [];

    const migrated = parsed.map(migrateLegacyRecord);
    const changed = JSON.stringify(parsed) !== JSON.stringify(migrated);
    if (changed) {
      await fs.writeFile(dataPath, JSON.stringify(migrated, null, 2));
    }
    return migrated;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve transaction definitions');
  }
}

async function getTransactionDefinitionById(id) {
  const all = await getAllTransactionDefinitions();
  return all.find((f) => String(f.id) === String(id)) || null;
}

async function addTransactionDefinition(data) {
  return queueWrite(async () => {
    const all = await getAllTransactionDefinitions();
    const sanitized = sanitizeTransactionDefinitionInput(data, { isUpdate: false });
    await assertEntryReferencesValid(sanitized.orgId, sanitized.entries);

    const duplicateName = all.some((f) =>
      String(f.orgId || '') === String(sanitized.orgId) &&
      normalizeName(f.name) === normalizeName(sanitized.name)
    );
    if (duplicateName) throw new Error('Transaction definition name already exists in this organization.');

    const duplicateCode = all.some((f) =>
      String(f.orgId) === String(sanitized.orgId) &&
      String(f.code).toUpperCase() === String(sanitized.code).toUpperCase()
    );
    if (duplicateCode) throw new Error('Transaction definition code already exists in this organization.');

    const existingIds = new Set(all.map((f) => String(f.id)));
    const finalId = sanitized.id ? String(sanitized.id) : generateTransactionDefinitionId(existingIds);
    if (existingIds.has(finalId)) throw new Error('Transaction definition id already exists.');

    const newItem = {
      ...sanitized,
      id: finalId,
      audit: { createDateTime: new Date().toISOString() }
    };
    all.push(newItem);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return newItem;
  });
}

async function updateTransactionDefinition(id, data) {
  return queueWrite(async () => {
    const all = await getAllTransactionDefinitions();
    const index = all.findIndex((f) => String(f.id) === String(id));
    if (index === -1) throw new Error('Transaction definition not found');

    const existing = all[index];
    const sanitized = sanitizeTransactionDefinitionInput(
      { ...data, orgId: existing.orgId || data?.orgId },
      { isUpdate: true }
    );
    await assertEntryReferencesValid(existing.orgId || sanitized.orgId, sanitized.entries);

    if (existing.orgId && String(existing.orgId) !== String(sanitized.orgId)) {
      throw new Error('Security Violation: orgId mismatch.');
    }

    const duplicateName = all.some((f, i) =>
      i !== index &&
      String(f.orgId || '') === String(existing.orgId || sanitized.orgId) &&
      normalizeName(f.name) === normalizeName(sanitized.name)
    );
    if (duplicateName) throw new Error('Transaction definition name already exists in this organization.');

    const duplicateCode = all.some((f, i) =>
      i !== index &&
      String(f.orgId) === String(existing.orgId) &&
      String(f.code).toUpperCase() === String(sanitized.code).toUpperCase()
    );
    if (duplicateCode) throw new Error('Transaction definition code already exists in this organization.');

    delete sanitized.id;
    sanitized.orgId = existing.orgId || sanitized.orgId;

    all[index] = {
      ...existing,
      ...sanitized,
      audit: { ...existing.audit, lastUpdateDateTime: new Date().toISOString() }
    };
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteTransactionDefinition(id) {
  return queueWrite(async () => {
    let all = await getAllTransactionDefinitions();
    const initialLength = all.length;
    all = all.filter((f) => String(f.id) !== String(id));
    if (all.length !== initialLength) {
      await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
      return true;
    }
    return false;
  });
}

module.exports = {
  getAllTransactionDefinitions,
  getTransactionDefinitionById,
  addTransactionDefinition,
  updateTransactionDefinition,
  deleteTransactionDefinition,
  parseAccountRef,
  TRANSACTION_DEFINITION_STATUSES: Object.freeze([...TRANSACTION_DEFINITION_STATUSES]),
  ACCOUNT_REF_KINDS
};
