const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/academicLedger.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const ENTRY_TYPES = new Set([
  'program_registered',
  'program_withdrawn',
  'term_registered',
  'term_withdrawn',
  'class_enrolled',
  'class_dropped',
  'score_posted',
  'score_adjusted',
  'subject_passed',
  'subject_failed',
  'credits_awarded',
  'credits_reversed',
  'term_completed',
  'term_failed',
  'promoted_to_next_term',
  'academic_probation',
  'program_completed'
]);

const ENTRY_STATUSES = new Set(['posted', 'draft', 'void']);
const RESULT_VALUES = new Set(['pass', 'fail', 'incomplete', 'withdrawn', 'pending', '']);
const STANDING_VALUES = new Set(['active', 'completed', 'withdrawn', 'probation', 'suspended', 'pending', '']);
const SUBJECT_TYPES = new Set(['main', 'essential', 'optional', '']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 64, allowEmpty = true } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9:_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanNumber(v, { min = -1000000, max = 1000000, allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? null : NaN;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('Invalid number value.');
  if (n < min || n > max) throw new Error('Number value out of range.');
  return Number(n.toFixed(2));
}

function cleanInteger(v, { min = 0, max = Number.MAX_SAFE_INTEGER, allowEmpty = true } = {}) {
  const n = cleanNumber(v, { min, max, allowEmpty });
  if (n === null) return null;
  if (!Number.isInteger(n)) throw new Error('Integer value required.');
  return n;
}

function cleanDateOnly(v, { allowEmpty = false } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? '' : null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return s;
}

function cleanDateTime(v, { allowEmpty = false } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? '' : null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid datetime value.');
  return d.toISOString();
}

function cleanQuantities(v) {
  const q = isPlainObject(v) ? v : {};
  return {
    creditsAttempted: cleanNumber(q.creditsAttempted, { min: 0, max: 100000, allowEmpty: true }),
    creditsEarned: cleanNumber(q.creditsEarned, { min: 0, max: 100000, allowEmpty: true }),
    score: cleanNumber(q.score, { min: 0, max: 100, allowEmpty: true }),
    average: cleanNumber(q.average, { min: 0, max: 100, allowEmpty: true })
  };
}

function cleanAcademic(v) {
  const a = isPlainObject(v) ? v : {};
  const subjectType = cleanString(a.subjectType, { max: 20, allowEmpty: true }).toLowerCase();
  const result = cleanString(a.result, { max: 20, allowEmpty: true }).toLowerCase();
  const standing = cleanString(a.standing, { max: 30, allowEmpty: true }).toLowerCase();

  if (!SUBJECT_TYPES.has(subjectType)) throw new Error('Invalid academic subjectType.');
  if (!RESULT_VALUES.has(result)) throw new Error('Invalid academic result value.');
  if (!STANDING_VALUES.has(standing)) throw new Error('Invalid academic standing value.');

  return {
    subjectType,
    attemptNo: cleanInteger(a.attemptNo, { min: 1, max: 1000, allowEmpty: true }),
    result,
    standing
  };
}

function cleanRuleSnapshot(v) {
  const r = isPlainObject(v) ? v : {};
  return {
    minPassingScore: cleanNumber(r.minPassingScore, { min: 0, max: 100, allowEmpty: true }),
    minPassingAverage: cleanNumber(r.minPassingAverage, { min: 0, max: 100, allowEmpty: true }),
    mustPass: r.mustPass === true || String(r.mustPass) === 'true',
    allowCompensation: r.allowCompensation === true || String(r.allowCompensation) === 'true'
  };
}

function cleanSource(v) {
  const s = isPlainObject(v) ? v : {};
  return {
    module: cleanString(s.module, { max: 80, allowEmpty: false }) || 'school_academic',
    eventType: cleanString(s.eventType, { max: 80, allowEmpty: false }) || 'manual_event',
    eventId: cleanId(s.eventId, { max: 120, allowEmpty: false }) || '',
    idempotencyKey: cleanString(s.idempotencyKey, { max: 180, allowEmpty: true })
  };
}

function cleanAudit(v) {
  const a = isPlainObject(v) ? v : {};
  return {
    createUser: cleanString(a.createUser, { max: 64, allowEmpty: true }),
    createDateTime: cleanDateTime(a.createDateTime, { allowEmpty: true }) || new Date().toISOString()
  };
}

function sanitizeEntry(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid academic ledger payload.');

  const entryType = cleanString(input.entryType, { max: 40, allowEmpty: false }).toLowerCase();
  if (!ENTRY_TYPES.has(entryType)) throw new Error('Invalid academic ledger entryType.');

  const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'posted';
  if (!ENTRY_STATUSES.has(status)) throw new Error('Invalid academic ledger status.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const studentId = cleanId(input.studentId, { max: 64, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  if (!studentId) throw new Error('studentId is required.');

  const out = {
    orgId,
    studentId,
    personId: cleanId(input.personId, { max: 64, allowEmpty: true }),
    programId: cleanId(input.programId, { max: 64, allowEmpty: true }),
    termId: cleanId(input.termId, { max: 64, allowEmpty: true }),
    classId: cleanId(input.classId, { max: 64, allowEmpty: true }),
    subjectId: cleanId(input.subjectId, { max: 64, allowEmpty: true }),
    enrollmentId: cleanId(input.enrollmentId, { max: 64, allowEmpty: true }),
    termRegistrationId: cleanId(input.termRegistrationId, { max: 64, allowEmpty: true }),
    programRegistrationId: cleanId(input.programRegistrationId, { max: 64, allowEmpty: true }),
    entryType,
    status,
    effectiveDate: cleanDateOnly(input.effectiveDate, { allowEmpty: false }) || new Date().toISOString().slice(0, 10),
    postedAt: cleanDateTime(input.postedAt, { allowEmpty: true }) || new Date().toISOString(),
    sequenceNo: cleanInteger(input.sequenceNo, { min: 1, max: 1000000000, allowEmpty: true }),
    quantities: cleanQuantities(input.quantities),
    academic: cleanAcademic(input.academic),
    ruleSnapshot: cleanRuleSnapshot(input.ruleSnapshot),
    source: cleanSource(input.source),
    memo: cleanString(input.memo, { max: 500, allowEmpty: true }),
    note: cleanString(input.note, { max: 2000, allowEmpty: true }),
    audit: cleanAudit(input.audit)
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 64, allowEmpty: false });
  }

  return out;
}

function generateEntryId(existingIds) {
  for (let i = 0; i < 50; i++) {
    const candidate = `ALD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `ALD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function getAllEntries() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve academic ledger.');
  }
}

async function getEntryById(id) {
  const all = await getAllEntries();
  return all.find((entry) => idsEqual(entry?.id, id)) || null;
}

async function addEntries(entries, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllEntries();
    const existingIds = new Set(all.map((entry) => String(entry.id)));
    const existingIdempotency = new Set(
      all
        .map((entry) => String(entry?.source?.idempotencyKey || '').trim())
        .filter(Boolean)
    );
    let nextSequenceNo = all.reduce((max, entry) => Math.max(max, Number(entry.sequenceNo || 0)), 0);

    const normalizedEntries = (Array.isArray(entries) ? entries : [entries]).map((entry) => sanitizeEntry(entry));

    normalizedEntries.forEach((entry) => {
      const idempotencyKey = String(entry?.source?.idempotencyKey || '').trim();
      if (idempotencyKey && existingIdempotency.has(idempotencyKey)) {
        throw new Error(`Duplicate academic idempotency key: ${idempotencyKey}`);
      }
      if (idempotencyKey) existingIdempotency.add(idempotencyKey);
      if (!entry.id) {
        entry.id = generateEntryId(existingIds);
      }
      existingIds.add(entry.id);
      nextSequenceNo += 1;
      entry.sequenceNo = nextSequenceNo;
      all.push(entry);
    });

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return normalizedEntries;
  });
}

async function addEntry(entry, options = {}) {
  const rows = await addEntries([entry], options);
  return rows[0];
}

async function updateEntryStatus(id, status, note = '', options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllEntries();
    const index = all.findIndex((entry) => idsEqual(entry?.id, id));
    if (index === -1) throw new Error('Academic ledger entry not found.');
    const nextStatus = cleanString(status, { max: 20, allowEmpty: false }).toLowerCase();
    if (!ENTRY_STATUSES.has(nextStatus)) throw new Error('Invalid academic ledger status.');
    all[index] = {
      ...all[index],
      status: nextStatus,
      note: note ? cleanString(note, { max: 2000, allowEmpty: true }) : all[index].note
    };
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function clearEntriesByOrg(orgId) {
  return queueWrite(async () => {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear academic ledger entries.');

    const all = await getAllEntries();
    const before = all.length;
    const filtered = all.filter((entry) => !idsEqual(entry?.orgId || '', targetOrgId));
    const removed = before - filtered.length;
    if (!removed) return { removed: 0, remaining: before };

    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

module.exports = {
  ENTRY_TYPES: Object.freeze([...ENTRY_TYPES]),
  ENTRY_STATUSES: Object.freeze([...ENTRY_STATUSES]),
  getAllEntries,
  getEntryById,
  addEntry,
  addEntries,
  updateEntryStatus,
  clearEntriesByOrg
};

