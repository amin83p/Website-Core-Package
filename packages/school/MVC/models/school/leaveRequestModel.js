const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/leaveRequests.json');

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const LEAVE_REQUEST_STATUSES = Object.freeze([
  'submitted',
  'approved',
  'pending_reapproval',
  'rejected',
  'cancelled'
]);

const LEAVE_REQUEST_REASONS = Object.freeze({
  MEDICAL: 'medical',
  PERSONAL: 'personal',
  FAMILY: 'family',
  PROFESSIONAL: 'professional',
  SCHOOL: 'school',
  OTHER: 'other'
});

const LEAVE_REQUEST_REASON_LABELS = Object.freeze({
  medical: 'Medical',
  personal: 'Personal',
  family: 'Family',
  professional: 'Professional Development',
  school: 'School Activity',
  other: 'Other'
});

const REQUESTER_ROLES = Object.freeze(['student', 'teacher', 'staff', 'admin']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 5000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function cleanId(value, { max = 100, allowEmpty = false } = {}) {
  const text = cleanString(value, { max, allowEmpty });
  if (text === null) return null;
  if (!text) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9:_-]+$/.test(text)) throw new Error('Invalid id format.');
  return text;
}

function cleanDateOnly(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return text;
}

function cleanTime(value, { allowEmpty = true } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const text = String(value).trim();
  if (!/^\d{2}:\d{2}$/.test(text)) throw new Error('Invalid time format. Use HH:MM.');
  return text;
}

function cleanBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeStatus(value, fallback = 'submitted') {
  const status = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase() || fallback;
  if (!LEAVE_REQUEST_STATUSES.includes(status)) throw new Error('Invalid leave request status.');
  return status;
}

function normalizeReason(value) {
  const reason = cleanString(value, { max: 60, allowEmpty: true }).toLowerCase() || LEAVE_REQUEST_REASONS.OTHER;
  return Object.values(LEAVE_REQUEST_REASONS).includes(reason) ? reason : LEAVE_REQUEST_REASONS.OTHER;
}

function normalizeRole(value) {
  const role = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase() || 'staff';
  if (!REQUESTER_ROLES.includes(role)) throw new Error('Invalid leave requester role.');
  return role;
}

function generateLeaveRequestId(existingIds = new Set()) {
  for (let i = 0; i < 50; i++) {
    const candidate = `LR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `LR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function sanitizeLifecycleEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event) => ({
      at: cleanString(event?.at, { max: 40, allowEmpty: true }) || new Date().toISOString(),
      action: cleanString(event?.action, { max: 60, allowEmpty: true }),
      actorId: cleanId(event?.actorId, { max: 100, allowEmpty: true }) || '',
      actorName: cleanString(event?.actorName, { max: 160, allowEmpty: true }),
      oldStatus: cleanString(event?.oldStatus, { max: 40, allowEmpty: true }),
      newStatus: cleanString(event?.newStatus, { max: 40, allowEmpty: true }),
      note: cleanString(event?.note, { max: 1000, allowEmpty: true }),
      snapshot: isPlainObject(event?.snapshot) ? event.snapshot : {}
    }))
    .filter((event) => event.action || event.oldStatus || event.newStatus);
}

function sanitizeApproval(value) {
  const raw = isPlainObject(value) ? value : {};
  return {
    approvedBy: cleanId(raw.approvedBy, { max: 100, allowEmpty: true }) || '',
    approvedByName: cleanString(raw.approvedByName, { max: 160, allowEmpty: true }),
    approvedAt: cleanString(raw.approvedAt, { max: 40, allowEmpty: true }),
    rejectedBy: cleanId(raw.rejectedBy, { max: 100, allowEmpty: true }) || '',
    rejectedByName: cleanString(raw.rejectedByName, { max: 160, allowEmpty: true }),
    rejectedAt: cleanString(raw.rejectedAt, { max: 40, allowEmpty: true }),
    cancelledBy: cleanId(raw.cancelledBy, { max: 100, allowEmpty: true }) || '',
    cancelledByName: cleanString(raw.cancelledByName, { max: 160, allowEmpty: true }),
    cancelledAt: cleanString(raw.cancelledAt, { max: 40, allowEmpty: true }),
    note: cleanString(raw.note, { max: 2000, allowEmpty: true })
  };
}

function buildLeaveWindowSnapshot(row) {
  if (!row) return null;
  return {
    requestId: cleanId(row.id, { max: 100, allowEmpty: true }) || '',
    orgId: cleanId(row.orgId, { max: 100, allowEmpty: true }) || '',
    requesterPersonId: cleanId(row.requesterPersonId, { max: 100, allowEmpty: true }) || '',
    requesterName: cleanString(row.requesterName, { max: 160, allowEmpty: true }),
    requesterRole: normalizeRole(row.requesterRole || 'staff'),
    startDate: cleanDateOnly(row.startDate, { allowEmpty: false }),
    endDate: cleanDateOnly(row.endDate || row.startDate, { allowEmpty: false }),
    allDay: cleanBoolean(row.allDay, true),
    startTime: cleanTime(row.startTime, { allowEmpty: true }) || '',
    endTime: cleanTime(row.endTime, { allowEmpty: true }) || '',
    reason: normalizeReason(row.reason),
    details: cleanString(row.details, { max: 2000, allowEmpty: true }),
    approvedAt: cleanString(row.approval?.approvedAt, { max: 40, allowEmpty: true }),
    approvedBy: cleanId(row.approval?.approvedBy, { max: 100, allowEmpty: true }) || '',
    active: true
  };
}

function sanitizeApprovedSnapshot(value) {
  if (!isPlainObject(value)) return null;
  const active = value.active !== false;
  const requesterPersonId = cleanId(value.requesterPersonId, { max: 100, allowEmpty: true }) || '';
  const startDate = cleanDateOnly(value.startDate, { allowEmpty: true }) || '';
  const endDate = cleanDateOnly(value.endDate || value.startDate, { allowEmpty: true }) || '';
  if (!requesterPersonId || !startDate || !endDate) return null;
  return {
    requestId: cleanId(value.requestId || value.id, { max: 100, allowEmpty: true }) || '',
    orgId: cleanId(value.orgId, { max: 100, allowEmpty: true }) || '',
    requesterPersonId,
    requesterName: cleanString(value.requesterName, { max: 160, allowEmpty: true }),
    requesterRole: normalizeRole(value.requesterRole || 'staff'),
    startDate,
    endDate,
    allDay: cleanBoolean(value.allDay, true),
    startTime: cleanTime(value.startTime, { allowEmpty: true }) || '',
    endTime: cleanTime(value.endTime, { allowEmpty: true }) || '',
    reason: normalizeReason(value.reason),
    details: cleanString(value.details, { max: 2000, allowEmpty: true }),
    approvedAt: cleanString(value.approvedAt, { max: 40, allowEmpty: true }),
    approvedBy: cleanId(value.approvedBy, { max: 100, allowEmpty: true }) || '',
    active
  };
}

function validateDateWindow(out) {
  if (!out.startDate) throw new Error('Start date is required.');
  if (!out.endDate) out.endDate = out.startDate;
  if (out.endDate < out.startDate) throw new Error('End date cannot be before start date.');

  if (out.allDay) {
    out.startTime = '';
    out.endTime = '';
    return;
  }

  if (!out.startTime || !out.endTime) {
    throw new Error('Start time and end time are required for partial-day leave.');
  }
  if (out.startDate === out.endDate && out.endTime <= out.startTime) {
    throw new Error('End time must be after start time.');
  }
}

function sanitizeLeaveRequestInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid leave request payload.');

  const out = {
    orgId: cleanId(input.orgId, { max: 100, allowEmpty: isUpdate }) || '',
    requesterPersonId: cleanId(input.requesterPersonId, { max: 100, allowEmpty: isUpdate }) || '',
    requesterRecordId: cleanId(input.requesterRecordId, { max: 100, allowEmpty: true }) || '',
    requesterName: cleanString(input.requesterName, { max: 160, allowEmpty: true }),
    requesterRole: normalizeRole(input.requesterRole || 'staff'),
    status: normalizeStatus(input.status, 'submitted'),
    requestDate: cleanDateOnly(input.requestDate, { allowEmpty: true }) || new Date().toISOString().slice(0, 10),
    startDate: cleanDateOnly(input.startDate, { allowEmpty: isUpdate }) || '',
    endDate: cleanDateOnly(input.endDate || input.startDate, { allowEmpty: isUpdate }) || '',
    allDay: cleanBoolean(input.allDay, true),
    startTime: cleanTime(input.startTime, { allowEmpty: true }) || '',
    endTime: cleanTime(input.endTime, { allowEmpty: true }) || '',
    reason: normalizeReason(input.reason),
    details: cleanString(input.details, { max: 5000, allowEmpty: true }),
    adminNote: cleanString(input.adminNote, { max: 5000, allowEmpty: true }),
    lifecycle: sanitizeLifecycleEvents(input.lifecycle),
    approval: sanitizeApproval(input.approval),
    lastApprovedSnapshot: sanitizeApprovedSnapshot(input.lastApprovedSnapshot),
    revisionNo: Number.isFinite(Number(input.revisionNo)) ? Math.max(1, Math.floor(Number(input.revisionNo))) : 1
  };

  if (!isUpdate) {
    if (!out.orgId) throw new Error('Organization is required.');
    if (!out.requesterPersonId) throw new Error('Requester person is required.');
    validateDateWindow(out);
  } else if (out.startDate || out.endDate || out.startTime || out.endTime) {
    validateDateWindow(out);
  }

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 100, allowEmpty: false });
  }

  return out;
}

async function getAllLeaveRequests() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const trimmed = String(data || '').trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      console.error('Leave request JSON parse error:', error.message);
      return [];
    }
    throw new Error('Failed to retrieve leave requests.');
  }
}

async function saveAll(rows) {
  const payload = JSON.stringify(Array.isArray(rows) ? rows : [], null, 2);
  await queueWrite(dataPath, payload);
}

async function getLeaveRequestById(id) {
  const all = await getAllLeaveRequests();
  return all.find((row) => idsEqual(row?.id, id)) || null;
}

async function getLeaveRequestsByOrg(orgId, filters = {}) {
  const all = await getAllLeaveRequests();
  const targetOrgId = String(orgId || '').trim();
  return all.filter((row) => {
    if (targetOrgId && !idsEqual(row?.orgId, targetOrgId)) return false;
    if (filters.status && String(row?.status || '') !== String(filters.status)) return false;
    if (filters.requesterPersonId && !idsEqual(row?.requesterPersonId, filters.requesterPersonId)) return false;
    return true;
  });
}

async function addLeaveRequest(input) {
  const all = await getAllLeaveRequests();
  const existingIds = new Set(all.map((row) => String(row?.id || '').trim()).filter(Boolean));
  const sanitized = sanitizeLeaveRequestInput(input, { isUpdate: false });
  const now = new Date().toISOString();
  const row = {
    ...sanitized,
    id: sanitized.id || generateLeaveRequestId(existingIds),
    audit: {
      createDateTime: now,
      lastUpdateDateTime: now,
      createdBy: cleanId(input?.audit?.createdBy || input?.createdBy, { max: 100, allowEmpty: true }) || '',
      updatedBy: cleanId(input?.audit?.updatedBy || input?.updatedBy, { max: 100, allowEmpty: true }) || ''
    }
  };
  all.push(row);
  await saveAll(all);
  return row;
}

async function updateLeaveRequest(id, input) {
  const all = await getAllLeaveRequests();
  const idx = all.findIndex((row) => idsEqual(row?.id, id));
  if (idx === -1) return null;
  const existing = all[idx];
  const sanitized = sanitizeLeaveRequestInput(input, { isUpdate: true });
  const merged = {
    ...existing,
    ...Object.fromEntries(Object.entries(sanitized).filter(([, value]) => value !== '' && value !== null && value !== undefined)),
    id: existing.id,
    audit: {
      ...(existing.audit || {}),
      lastUpdateDateTime: new Date().toISOString(),
      updatedBy: cleanId(input?.audit?.updatedBy || input?.updatedBy, { max: 100, allowEmpty: true }) || existing.audit?.updatedBy || ''
    }
  };
  if (input?.status !== undefined) merged.status = normalizeStatus(input.status, existing.status || 'submitted');
  if (input?.allDay !== undefined) merged.allDay = cleanBoolean(input.allDay, existing.allDay !== false);
  validateDateWindow(merged);
  all[idx] = merged;
  await saveAll(all);
  return merged;
}

async function deleteLeaveRequest(id) {
  const all = await getAllLeaveRequests();
  const before = all.length;
  const kept = all.filter((row) => !idsEqual(row?.id, id));
  if (kept.length === before) return false;
  await saveAll(kept);
  return true;
}

async function clearLeaveRequestsByOrg(orgId) {
  const all = await getAllLeaveRequests();
  const kept = all.filter((row) => !idsEqual(row?.orgId, orgId));
  if (kept.length === all.length) return 0;
  await saveAll(kept);
  return all.length - kept.length;
}

module.exports = {
  LEAVE_REQUEST_STATUSES,
  LEAVE_REQUEST_REASONS,
  LEAVE_REQUEST_REASON_LABELS,
  REQUESTER_ROLES,
  buildLeaveWindowSnapshot,
  sanitizeLeaveRequestInput,
  getAllLeaveRequests,
  getLeaveRequestById,
  getLeaveRequestsByOrg,
  addLeaveRequest,
  updateLeaveRequest,
  deleteLeaveRequest,
  clearLeaveRequestsByOrg
};
