'use strict';

function parseJsonField(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return fallback;
  }
}

function parseSnapshotBoolean(value, defaultValue = false) {
  if (value === true) return true;
  if (value === false) return false;
  if (value === undefined || value === null || value === '') return defaultValue;
  const token = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'off'].includes(token)) return false;
  return defaultValue;
}

function stripForbiddenSnapshotFields(snapshot = {}) {
  const next = { ...(snapshot && typeof snapshot === 'object' ? snapshot : {}) };
  delete next.id;
  delete next.orgId;
  delete next.instructors;
  delete next.sessions;
  delete next.previousClassId;
  delete next.nextClassId;
  delete next.cycleGroupId;
  if (next.enrollment && typeof next.enrollment === 'object') {
    next.enrollment = {
      ...next.enrollment,
      students: []
    };
  }
  return next;
}

function buildSnapshotFromClassFormBody(body = {}) {
  const enrollment = parseJsonField(body.enrollment, { maxCapacity: 30, students: [] });
  return stripForbiddenSnapshotFields({
    status: String(body.status || 'active').trim().toLowerCase() || 'active',
    registrationMode: String(body.registrationMode || 'term_based').trim().toLowerCase(),
    billingMode: String(body.billingMode || 'chargeable').trim().toLowerCase(),
    credits: body.credits,
    deliveryDepartmentId: String(body.deliveryDepartmentId || '').trim(),
    deliveryDepartmentName: String(body.deliveryDepartmentName || '').trim(),
    skillIds: parseJsonField(body.skillIds, []),
    curriculum: parseJsonField(body.curriculum, { subjects: [], totalHours: 0 }),
    pricing: parseJsonField(body.pricing, { mode: 'auto', feeRules: [] }),
    postingTemplates: parseJsonField(body.postingTemplates, []),
    allowedProgramTerms: parseJsonField(body.allowedProgramTerms, []),
    evaluation: parseJsonField(body.evaluation, { passingScore: 60, weights: {} }),
    enabledAttendanceStatuses: parseJsonField(body.enabledAttendanceStatuses, []),
    enrollment: {
      maxCapacity: Number(enrollment?.maxCapacity || 30),
      students: []
    },
    cycleStartDate: String(body.cycleStartDate || '').trim(),
    cycleEndDate: String(body.cycleEndDate || '').trim(),
    cycleNo: body.cycleNo,
    isClosedForNewEnrollment: parseSnapshotBoolean(body.isClosedForNewEnrollment, false),
    enforceEnrollmentSessionCount: false
  });
}

function snapshotToClassFormBody(snapshot = {}, overrides = {}) {
  const base = stripForbiddenSnapshotFields(snapshot);
  return {
    ...base,
    title: String(overrides.title || '').trim(),
    status: String(overrides.status || base.status || 'active').trim(),
    instructors: overrides.instructors || [],
    sessions: '[]',
    curriculum: JSON.stringify(base.curriculum || { subjects: [], totalHours: 0 }),
    pricing: JSON.stringify(base.pricing || { mode: 'auto', feeRules: [] }),
    postingTemplates: JSON.stringify(base.postingTemplates || []),
    allowedProgramTerms: JSON.stringify(base.allowedProgramTerms || []),
    evaluation: JSON.stringify(base.evaluation || { passingScore: 60, weights: {} }),
    enabledAttendanceStatuses: JSON.stringify(base.enabledAttendanceStatuses || []),
    enrollment: JSON.stringify(base.enrollment || { maxCapacity: 30, students: [] }),
    skillIds: JSON.stringify(base.skillIds || []),
    billingMode: base.billingMode || 'chargeable',
    registrationMode: base.registrationMode || 'term_based',
    deliveryDepartmentId: base.deliveryDepartmentId || '',
    deliveryDepartmentName: base.deliveryDepartmentName || '',
    credits: base.credits,
    cycleStartDate: overrides.cycleStartDate != null ? overrides.cycleStartDate : (base.cycleStartDate || ''),
    cycleEndDate: base.cycleEndDate || '',
    cycleNo: base.cycleNo,
    isClosedForNewEnrollment: parseSnapshotBoolean(base.isClosedForNewEnrollment, false)
  };
}

function applyStartDateToSnapshot(snapshot, startDate) {
  const date = String(startDate || '').trim();
  if (!date) return snapshot;
  const next = { ...snapshot };
  const mode = String(next.registrationMode || '').trim().toLowerCase();
  if (mode === 'rolling') {
    next.cycleStartDate = date;
  }
  if (Array.isArray(next.allowedProgramTerms)) {
    next.allowedProgramTerms = next.allowedProgramTerms.map((row) => ({
      ...row,
      classesStartDate: date,
      startDate: String(row?.startDate || '').trim() || date
    }));
  }
  return next;
}

module.exports = {
  stripForbiddenSnapshotFields,
  parseSnapshotBoolean,
  buildSnapshotFromClassFormBody,
  snapshotToClassFormBody,
  applyStartDateToSnapshot
};
