const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataDir = path.join(__dirname, '../../../data/school');
const dataPath = path.join(dataDir, 'transactionJournals.json');

if (!fsSync.existsSync(dataDir)) {
  fsSync.mkdirSync(dataDir, { recursive: true });
}
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const JOURNAL_STATUSES = new Set(['draft', 'posted', 'voided']);
const JOURNAL_TYPES = new Set(['charge', 'payment', 'refund', 'waiver', 'adjustment']);
const JOURNAL_LINE_DIRECTIONS = new Set(['debit', 'credit']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 120, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanDateISO(v, { allowEmpty = true, withTime = false } = {}) {
  const s = cleanString(v, { max: 40, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!withTime && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date value.');
  return withTime ? d.toISOString() : d.toISOString().slice(0, 10);
}

function cleanNumber(v, { min = 0, max = 1000000000, allowEmpty = false } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? null : NaN;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('Invalid number value.');
  if (n < min || n > max) throw new Error('Number value out of range.');
  return n;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function cleanCurrency(v) {
  const ccy = cleanString(v, { max: 3, allowEmpty: false }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(ccy)) throw new Error('Currency must be a valid ISO code.');
  return ccy;
}

function sanitizeLineInput(line, index) {
  if (!isPlainObject(line)) throw new Error(`Invalid line payload at index ${index + 1}.`);

  const accountId = cleanId(line.accountId, { max: 80, allowEmpty: false });
  const direction = cleanString(line.direction, { max: 10, allowEmpty: false }).toLowerCase();
  if (!JOURNAL_LINE_DIRECTIONS.has(direction)) throw new Error(`Invalid direction at line ${index + 1}.`);

  const amount = cleanNumber(line.amount, { min: 0.01, max: 1000000000, allowEmpty: false });
  const currency = cleanCurrency(line.currency || 'CAD');

  return {
    lineNo: Number(index + 1),
    accountId,
    direction,
    amount: roundMoney(amount),
    currency,
    memo: cleanString(line.memo, { max: 500, allowEmpty: true }),
    note: cleanString(line.note, { max: 2000, allowEmpty: true })
  };
}

function computeTotals(lines) {
  const out = {
    debit: 0,
    credit: 0,
    difference: 0,
    isBalanced: false
  };

  (lines || []).forEach((line) => {
    const amount = roundMoney(line.amount);
    if (line.direction === 'debit') out.debit = roundMoney(out.debit + amount);
    if (line.direction === 'credit') out.credit = roundMoney(out.credit + amount);
  });
  out.difference = roundMoney(out.debit - out.credit);
  out.isBalanced = (lines || []).length >= 2 && out.difference === 0;
  return out;
}

function sanitizeJournalInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid journal payload.');

  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');

  const status = (cleanString(input.status, { max: 30, allowEmpty: true }) || 'draft').toLowerCase();
  if (!JOURNAL_STATUSES.has(status)) throw new Error('Invalid journal status.');

  const transactionType = (cleanString(input.transactionType, { max: 30, allowEmpty: true }) || 'adjustment').toLowerCase();
  if (!JOURNAL_TYPES.has(transactionType)) throw new Error('Invalid transaction type.');

  const linesRaw = Array.isArray(input.lines) ? input.lines : [];
  if (linesRaw.length > 1000) throw new Error('Too many journal lines.');
  const lines = linesRaw.map((line, idx) => sanitizeLineInput(line, idx));
  const currencies = Array.from(new Set(lines.map((x) => String(x.currency || '').toUpperCase()).filter(Boolean)));
  if (currencies.length > 1) throw new Error('Mixed currencies are not supported in one journal.');
  const totals = computeTotals(lines);

  if (status === 'posted' && !totals.isBalanced) {
    throw new Error('Only balanced journals can be posted.');
  }

  const out = {
    orgId,
    journalNumber: cleanString(input.journalNumber, { max: 80, allowEmpty: true }),
    effectiveDate: cleanDateISO(input.effectiveDate, { allowEmpty: false, withTime: false }),
    postedAt: cleanDateISO(input.postedAt, { allowEmpty: true, withTime: true }) || '',
    status,
    transactionType,
    description: cleanString(input.description, { max: 500, allowEmpty: false }),
    referenceNo: cleanString(input.referenceNo, { max: 120, allowEmpty: true }),
    externalReference: cleanString(input.externalReference, { max: 120, allowEmpty: true }),
    internalNote: cleanString(input.internalNote, { max: 5000, allowEmpty: true }),
    currency: currencies[0] || 'CAD',
    lines,
    totals,
    postedLedgerTransactionIds: Array.isArray(input.postedLedgerTransactionIds)
      ? input.postedLedgerTransactionIds.map((x) => cleanId(x, { max: 120, allowEmpty: false }))
      : []
  };

  if (!out.effectiveDate) throw new Error('effectiveDate is required.');
  if (!out.description) throw new Error('description is required.');
  if (!Array.isArray(out.lines) || out.lines.length === 0) throw new Error('At least one journal line is required.');

  if (status === 'posted' && !out.postedAt) {
    out.postedAt = new Date().toISOString();
  }
  if (status !== 'posted') {
    out.postedAt = '';
    out.postedLedgerTransactionIds = [];
  }

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  }

  return out;
}

function generateJournalId(existingIds) {
  const prefix = `JRN${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  for (let i = 0; i < 200; i++) {
    const candidate = `${prefix}${Math.floor(10000 + Math.random() * 90000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `JRN${Date.now()}`;
}

function generateJournalNumber(existingNumbers) {
  const prefix = `J-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  for (let i = 0; i < 200; i++) {
    const candidate = `${prefix}-${Math.floor(100 + Math.random() * 900)}`;
    if (!existingNumbers.has(candidate)) return candidate;
  }
  return `J-${Date.now()}`;
}

async function getAllJournals() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve transaction journals');
  }
}

async function getJournalById(id) {
  const all = await getAllJournals();
  return all.find((x) => String(x.id) === String(id)) || null;
}

async function addJournal(data) {
  return queueWrite(async () => {
    const all = await getAllJournals();
    const sanitized = sanitizeJournalInput(data, { isUpdate: false });

    const existingIds = new Set(all.map((x) => String(x.id)));
    const existingNumbers = new Set(all.map((x) => String(x.journalNumber || '')));
    const id = sanitized.id ? String(sanitized.id) : generateJournalId(existingIds);
    if (existingIds.has(id)) throw new Error('Journal id already exists.');

    const journalNumber = sanitized.journalNumber || generateJournalNumber(existingNumbers);
    if (existingNumbers.has(journalNumber)) throw new Error('Journal number already exists.');

    const created = {
      ...sanitized,
      id,
      journalNumber,
      audit: {
        createDateTime: new Date().toISOString()
      }
    };
    all.push(created);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return created;
  });
}

async function updateJournal(id, data) {
  return queueWrite(async () => {
    const all = await getAllJournals();
    const index = all.findIndex((x) => String(x.id) === String(id));
    if (index === -1) throw new Error('Journal not found');

    const existing = all[index];
    if (existing.status === 'posted' || existing.status === 'voided') {
      throw new Error('Posted/voided journals are immutable.');
    }

    const sanitized = sanitizeJournalInput(
      { ...existing, ...data, orgId: existing.orgId },
      { isUpdate: true }
    );

    if (String(existing.orgId || '') !== String(sanitized.orgId || '')) {
      throw new Error('Security Violation: orgId mismatch.');
    }

    all[index] = {
      ...existing,
      ...sanitized,
      id: existing.id,
      journalNumber: existing.journalNumber || sanitized.journalNumber || '',
      audit: {
        ...existing.audit,
        lastUpdateDateTime: new Date().toISOString()
      }
    };
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteJournal(id) {
  return queueWrite(async () => {
    const all = await getAllJournals();
    const index = all.findIndex((x) => String(x.id) === String(id));
    if (index === -1) return false;

    const existing = all[index];
    if (String(existing.status || '').toLowerCase() === 'posted') {
      throw new Error('Posted journals cannot be deleted.');
    }

    all.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return true;
  });
}

async function clearJournalsByOrg(orgId) {
  return queueWrite(async () => {
    const targetOrgId = String(orgId || '').trim();
    if (!targetOrgId) throw new Error('orgId is required to clear transaction journals.');

    const all = await getAllJournals();
    const before = all.length;
    const filtered = all.filter((journal) => String(journal?.orgId || '') !== targetOrgId);
    const removed = before - filtered.length;
    if (!removed) return { removed: 0, remaining: before };

    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

module.exports = {
  getAllJournals,
  getJournalById,
  addJournal,
  updateJournal,
  deleteJournal,
  clearJournalsByOrg,
  JOURNAL_STATUSES: Object.freeze([...JOURNAL_STATUSES]),
  JOURNAL_TYPES: Object.freeze([...JOURNAL_TYPES]),
  JOURNAL_LINE_DIRECTIONS: Object.freeze([...JOURNAL_LINE_DIRECTIONS])
};

