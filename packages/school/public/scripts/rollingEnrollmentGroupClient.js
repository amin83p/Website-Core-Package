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

  function roundEnrollmentHours(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function computeDurationHoursFromTimes(startTime, endTime) {
    const start = String(startTime || '').trim();
    const end = String(endTime || '').trim();
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return 0;
    const hours = (eh + em / 60) - (sh + sm / 60);
    return hours > 0 ? roundEnrollmentHours(hours) : 0;
  }

  function resolveSessionDurationHours(session = {}) {
    const stored = Number(session?.durationHours);
    if (Number.isFinite(stored) && stored > 0) return roundEnrollmentHours(stored);
    return computeDurationHoursFromTimes(session.startTime || session.start, session.endTime || session.end);
  }

  function sumSelectedSessionHours(sessions = []) {
    const total = (Array.isArray(sessions) ? sessions : []).reduce(
      (sum, row) => sum + resolveSessionDurationHours(row),
      0
    );
    return roundEnrollmentHours(total);
  }

  function buildMasterScheduleEnrollmentSettings(options = {}) {
    const startDate = String(options.startDate || '').trim();
    const endDate = String(options.endDate || '').trim();
    const sessionCapacityType = normalizeSessionCapacityTypeValue(options.sessionCapacityType);
    const minTargetHours = roundEnrollmentHours(
      options.minTargetHours != null && options.minTargetHours !== ''
        ? normalizeTargetHoursValue(options.minTargetHours)
        : sumSelectedSessionHours(options.sessions)
    );
    let targetHours = normalizeTargetHoursValue(options.targetHoursOverride);
    if (!targetHours) targetHours = minTargetHours;
    if (minTargetHours > 0 && targetHours < minTargetHours) {
      targetHours = minTargetHours;
    }
    return {
      startDate,
      endDate,
      status: String(options.status || 'active').trim(),
      funderType: String(options.funderType || 'self').trim(),
      funderId: String(options.funderId || 'self').trim(),
      claimNumber: String(options.claimNumber || '').trim(),
      claimNumberId: String(options.claimNumberId || '').trim(),
      reasonStart: String(options.reasonStart || '').trim(),
      targetSessionCount: '',
      targetHours: targetHours > 0 ? String(targetHours) : '',
      minTargetHours,
      sessionCapacityType
    };
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
    normalizeTargetHoursValue,
    computeDurationHoursFromTimes,
    resolveSessionDurationHours,
    sumSelectedSessionHours,
    buildMasterScheduleEnrollmentSettings,
    groupEnrollmentSettingsFromEntry,
    buildGroupEnginePayload,
    inferGroupEnrollmentMode
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.RollingEnrollmentGroupClient = api;
})(typeof window !== 'undefined' ? window : global);
