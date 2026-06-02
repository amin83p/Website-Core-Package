const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
// MVC/models/school/withdrawalModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/withdrawals.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const WITHDRAWAL_TYPES = Object.freeze(['class', 'term', 'program']);

const WITHDRAWAL_STATUSES = Object.freeze([
  'draft',
  'submitted',
  'pending_approval',
  'pending_program_admin_approval',
  'approved',
  'processing',
  'completed',
  'rejected',
  'cancelled',
  'error'
]);

const WITHDRAWAL_REASONS = Object.freeze({
  PERSONAL: 'personal',
  FINANCIAL: 'financial',
  MEDICAL: 'medical',
  TRANSFER: 'transfer',
  EMPLOYMENT: 'employment',
  ACADEMIC: 'academic',
  DISCIPLINARY: 'disciplinary',
  NON_PAYMENT: 'non_payment',
  INELIGIBLE: 'ineligible',
  PROGRAM_CANCELLED: 'program_cancelled',
  SCHEDULING_CONFLICT: 'scheduling_conflict',
  MILITARY: 'military',
  FAMILY_EMERGENCY: 'family_emergency',
  OTHER: 'other'
});

const WITHDRAWAL_REASON_LABELS = Object.freeze({
  personal: 'Personal Reasons',
  financial: 'Financial Reasons',
  medical: 'Medical/Health',
  transfer: 'Transfer to Another Institution',
  employment: 'Employment Opportunity',
  academic: 'Academic Difficulties',
  disciplinary: 'Disciplinary Action',
  non_payment: 'Non-Payment of Fees',
  ineligible: 'No Longer Meets Requirements',
  program_cancelled: 'Program Discontinued',
  scheduling_conflict: 'Scheduling Conflict',
  military: 'Military Service',
  family_emergency: 'Family Emergency',
  other: 'Other'
});

const INITIATOR_TYPES = Object.freeze(['student', 'admin', 'system']);

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
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanDateOnly(v, { allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? '' : null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return s;
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function generateWithdrawalId(type) {
  const prefix = type === 'class' ? 'CWD' : type === 'term' ? 'TWD' : 'PWD';
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function sanitizeWithdrawalInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Invalid withdrawal payload.');

  const type = cleanString(input.type, { max: 20, allowEmpty: false })?.toLowerCase();
  if (!WITHDRAWAL_TYPES.includes(type)) {
    throw new Error('Invalid withdrawal type. Must be class, term, or program.');
  }

  const status = cleanString(input.status, { max: 30, allowEmpty: true })?.toLowerCase() || 'draft';
  if (!WITHDRAWAL_STATUSES.includes(status)) {
    throw new Error('Invalid withdrawal status.');
  }

  const reason = cleanString(input.reason, { max: 50, allowEmpty: true })?.toLowerCase() || '';
  const initiatorType = cleanString(input.initiatorType, { max: 20, allowEmpty: true })?.toLowerCase() || 'admin';
  if (!INITIATOR_TYPES.includes(initiatorType)) {
    throw new Error('Invalid initiator type.');
  }

  const out = {
    orgId: cleanId(input.orgId, { max: 64, allowEmpty: false }),
    type,
    status,
    studentId: cleanId(input.studentId, { max: 64, allowEmpty: false }),
    personId: cleanId(input.personId, { max: 64, allowEmpty: true }) || '',
    reason,
    reasonDetail: cleanString(input.reasonDetail, { max: 2000, allowEmpty: true }),
    initiatorType,
    initiatorId: cleanId(input.initiatorId, { max: 64, allowEmpty: true }) || '',
    requestDate: cleanDateOnly(input.requestDate, { allowEmpty: true }) || new Date().toISOString().slice(0, 10),
    effectiveDate: cleanDateOnly(input.effectiveDate, { allowEmpty: true }) || '',
    approvedDate: cleanDateOnly(input.approvedDate, { allowEmpty: true }) || '',
    completedDate: cleanDateOnly(input.completedDate, { allowEmpty: true }) || '',
    approvedBy: cleanId(input.approvedBy, { max: 64, allowEmpty: true }) || '',
    processedBy: cleanId(input.processedBy, { max: 64, allowEmpty: true }) || '',
    programRegistrationId: cleanId(input.programRegistrationId, { max: 64, allowEmpty: true }) || '',
    termRegistrationId: cleanId(input.termRegistrationId, { max: 64, allowEmpty: true }) || '',
    classEnrollmentId: cleanId(input.classEnrollmentId, { max: 64, allowEmpty: true }) || '',
    classId: cleanId(input.classId, { max: 64, allowEmpty: true }) || '',
    programId: cleanId(input.programId, { max: 64, allowEmpty: true }) || '',
    termId: cleanId(input.termId, { max: 64, allowEmpty: true }) || '',
    resolutionPlan: input.resolutionPlan || null,
    financialImpact: {
      refundAmount: roundMoney(input.financialImpact?.refundAmount || 0),
      penaltyAmount: roundMoney(input.financialImpact?.penaltyAmount || 0),
      totalAmount: roundMoney(input.financialImpact?.totalAmount || 0),
      currency: cleanString(input.financialImpact?.currency, { max: 3, allowEmpty: true }).toUpperCase() || 'CAD',
      refundTransactionIds: Array.isArray(input.financialImpact?.refundTransactionIds)
        ? input.financialImpact.refundTransactionIds.map(id => cleanId(id, { allowEmpty: true })).filter(Boolean)
        : [],
      refundPolicy: cleanString(input.financialImpact?.refundPolicy, { max: 50, allowEmpty: true }) || '',
      notes: cleanString(input.financialImpact?.notes, { max: 1000, allowEmpty: true })
    },
    academicImpact: {
      gradeAssigned: cleanString(input.academicImpact?.gradeAssigned, { max: 10, allowEmpty: true }) || '',
      appearsOnTranscript: input.academicImpact?.appearsOnTranscript !== false,
      voidedAcademicEntryIds: Array.isArray(input.academicImpact?.voidedAcademicEntryIds)
        ? input.academicImpact.voidedAcademicEntryIds.map(id => cleanId(id, { allowEmpty: true })).filter(Boolean)
        : [],
      notes: cleanString(input.academicImpact?.notes, { max: 1000, allowEmpty: true })
    },
    rosterImpact: {
      removedEnrollments: Array.isArray(input.rosterImpact?.removedEnrollments)
        ? input.rosterImpact.removedEnrollments
        : [],
      notes: cleanString(input.rosterImpact?.notes, { max: 1000, allowEmpty: true })
    },
    childWithdrawals: Array.isArray(input.childWithdrawals)
      ? input.childWithdrawals.map(id => cleanId(id, { allowEmpty: true })).filter(Boolean)
      : [],
    parentWithdrawalId: cleanId(input.parentWithdrawalId, { max: 64, allowEmpty: true }) || '',
    documentation: Array.isArray(input.documentation) ? input.documentation : [],
    notes: cleanString(input.notes, { max: 5000, allowEmpty: true }),
    internalNotes: cleanString(input.internalNotes, { max: 5000, allowEmpty: true }),
    errors: Array.isArray(input.errors) ? input.errors : [],
    warnings: Array.isArray(input.warnings) ? input.warnings : []
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 64, allowEmpty: false });
  }

  return out;
}

async function getAllWithdrawals() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const trimmed = (data || '').trim();
    if (!trimmed) return [];
    return JSON.parse(trimmed);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      console.error('Withdrawal JSON parse error:', error.message);
      return [];
    }
    console.error('Withdrawal read error:', error);
    throw new Error('Failed to retrieve withdrawals');
  }
}

async function getWithdrawalById(id) {
  const all = await getAllWithdrawals();
  return all.find(w => String(w.id) === String(id)) || null;
}

async function getWithdrawalsByOrg(orgId, filters = {}) {
  const all = await getAllWithdrawals();
  return all.filter(w => {
    if (String(w.orgId) !== String(orgId)) return false;
    if (filters.type && w.type !== filters.type) return false;
    if (filters.status && w.status !== filters.status) return false;
    if (filters.studentId && String(w.studentId) !== String(filters.studentId)) return false;
    return true;
  });
}

async function getWithdrawalsByStudentId(studentId, orgId) {
  const all = await getAllWithdrawals();
  return all.filter(w =>
    String(w.studentId) === String(studentId) &&
    String(w.orgId) === String(orgId)
  );
}

async function addWithdrawal(input) {
  return queueWrite(async () => {
    const all = await getAllWithdrawals();
    const sanitized = sanitizeWithdrawalInput(input, { isUpdate: false });
    
    sanitized.id = sanitized.id || generateWithdrawalId(sanitized.type);
    sanitized.audit = {
      createDateTime: new Date().toISOString(),
      createUser: input.audit?.createUser || ''
    };

    all.push(sanitized);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return sanitized;
  });
}

async function updateWithdrawal(id, updates) {
  return queueWrite(async () => {
    const all = await getAllWithdrawals();
    const index = all.findIndex(w => String(w.id) === String(id));
    if (index === -1) throw new Error('Withdrawal not found.');

    const existing = all[index];
    const merged = sanitizeWithdrawalInput({ ...existing, ...updates }, { isUpdate: true });
    merged.id = existing.id;
    merged.audit = {
      ...existing.audit,
      lastUpdateDateTime: new Date().toISOString(),
      lastUpdateUser: updates.audit?.lastUpdateUser || ''
    };

    all[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return merged;
  });
}

async function deleteWithdrawal(id) {
  return queueWrite(async () => {
    const all = await getAllWithdrawals();
    const filtered = all.filter(w => String(w.id) !== String(id));
    if (filtered.length === all.length) return false;
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return true;
  });
}

async function clearWithdrawalsByOrg(orgId) {
  return queueWrite(async () => {
    const targetOrgId = String(orgId || '').trim();
    if (!targetOrgId) throw new Error('orgId is required to clear withdrawals.');

    const all = await getAllWithdrawals();
    const before = all.length;
    const filtered = all.filter((row) => String(row?.orgId || '') !== targetOrgId);
    const removed = before - filtered.length;
    if (!removed) return { removed: 0, remaining: before };

    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

module.exports = {
  WITHDRAWAL_TYPES,
  WITHDRAWAL_STATUSES,
  WITHDRAWAL_REASONS,
  WITHDRAWAL_REASON_LABELS,
  INITIATOR_TYPES,
  getAllWithdrawals,
  getWithdrawalById,
  getWithdrawalsByOrg,
  getWithdrawalsByStudentId,
  addWithdrawal,
  updateWithdrawal,
  deleteWithdrawal,
  clearWithdrawalsByOrg,
  generateWithdrawalId
};
