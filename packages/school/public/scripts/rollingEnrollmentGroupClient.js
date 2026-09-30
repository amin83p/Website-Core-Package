(function (global) {
  'use strict';

  function normalizeSessionCapacityTypeValue(value) {
    const token = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (token === 'one_on_one' || token === '1_on_1' || token === 'oneonone') return 'one_on_one';
    return 'group';
  }

  function normalizeTargetSessionCountValue(value) {
    const n = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function normalizeTargetHoursValue(value) {
    const n = Number.parseFloat(String(value || '').trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function groupEnrollmentSettingsFromEntry(entry = {}) {
    return {
      startDate: String(entry.startDate || '').trim(),
      endDate: String(entry.endDate || '').trim(),
      status: String(entry.status || 'active').trim(),
      funderType: String(entry.funderType || 'self').trim(),
      funderId: String(entry.funderId || 'self').trim(),
      claimNumber: String(entry.claimNumber || '').trim(),
      claimNumberId: String(entry.claimNumberId || '').trim(),
      reasonStart: String(entry.reasonStart || '').trim(),
      targetSessionCount: String(entry.targetSessionCount || '').trim(),
      targetHours: String(entry.targetHours || '').trim(),
      sessionCapacityType: normalizeSessionCapacityTypeValue(entry.sessionCapacityType)
    };
  }

  function inferGroupEnrollmentMode(settings = {}) {
    if (normalizeTargetHoursValue(settings.targetHours) > 0) return 'hour_cap';
    if (normalizeTargetSessionCountValue(settings.targetSessionCount) > 0) return 'session_cap';
    return 'date_window';
  }

  function buildGroupEnginePayload(classId, studentId, settings = {}) {
    const payload = {
      classId: String(classId || '').trim(),
      students: [{
        studentId: String(studentId || '').trim(),
        sessionCapacityType: normalizeSessionCapacityTypeValue(settings.sessionCapacityType)
      }],
      enrollmentMode: inferGroupEnrollmentMode(settings),
      startDate: settings.startDate,
      endDate: settings.endDate,
      status: settings.status,
      funderType: settings.funderType,
      funderId: settings.funderId,
      claimNumberId: settings.claimNumberId,
      claimNumber: settings.claimNumber,
      reasonStart: settings.reasonStart,
      sessionCountPolicy: 'all_non_na',
      sessionCapacityType: normalizeSessionCapacityTypeValue(settings.sessionCapacityType)
    };
    if (normalizeTargetSessionCountValue(settings.targetSessionCount) > 0) {
      payload.targetSessionCount = normalizeTargetSessionCountValue(settings.targetSessionCount);
    }
    if (normalizeTargetHoursValue(settings.targetHours) > 0) {
      payload.targetHours = normalizeTargetHoursValue(settings.targetHours);
    }
    return payload;
  }

  const api = {
    normalizeSessionCapacityTypeValue,
    groupEnrollmentSettingsFromEntry,
    buildGroupEnginePayload,
    inferGroupEnrollmentMode
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.RollingEnrollmentGroupClient = api;
})(typeof window !== 'undefined' ? window : global);
