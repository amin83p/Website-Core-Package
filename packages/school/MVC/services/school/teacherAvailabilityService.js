'use strict';

const schoolDataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const schedulingTimePolicyModel = require('../../models/school/schedulingTimePolicyModel');
const schedulingTimePolicyService = require('./schedulingTimePolicyService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const teacherTeachingQualificationsService = require('./teacherTeachingQualificationsService');
const sessionConflictDetectionService = require('./sessionConflictDetectionService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function listDatesInclusive(startDate, endDate) {
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate) || start;
  if (!start || !end || start > end) return [];
  const out = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const endMs = new Date(`${end}T00:00:00Z`).getTime();
  while (cursor.getTime() <= endMs) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function clipFrameToDayBounds(frame, dayBounds) {
  const boundStart = schedulingTimePolicyService.timeToMinutes(dayBounds.earliestStart);
  const boundEnd = schedulingTimePolicyService.timeToMinutes(dayBounds.latestEnd);
  const frameStart = schedulingTimePolicyService.timeToMinutes(frame.startTime);
  const frameEnd = schedulingTimePolicyService.timeToMinutes(frame.endTime);
  const start = Math.max(frameStart, boundStart);
  const end = Math.min(frameEnd, boundEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  return {
    ...frame,
    startTime: schedulingTimePolicyService.minutesToClock(start),
    endTime: schedulingTimePolicyService.minutesToClock(end)
  };
}

async function buildTeacherDayBusyMap({ orgId, startDate, endDate, reqUser }) {
  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const teacherIdentityLookup = await sessionConflictDetectionService.buildTeacherIdentityLookup({
    activeOrgId: orgId,
    reqUser
  });
  const allClasses = await schoolDataService.fetchAllData('classes', {}, reqUser).catch(() => []);
  const scopedClasses = (Array.isArray(allClasses) ? allClasses : []).filter((row) => idsEqual(row?.orgId, orgId));
  const classSessionsBundle = await Promise.all(
    scopedClasses.map(async (row) => ({
      classId: toPublicId(row?.id),
      sessions: sessionConflictDetectionService.filterSessionsForConflictWindow(
        await schoolDataService.getClassSessions(row?.id, reqUser),
        startDate,
        endDate
      )
    }))
  );

  const teacherDayMap = new Map();
  classSessionsBundle.forEach((bundle) => {
    const sourceClassId = String(bundle?.classId || '').trim();
    const sourceClassRow = scopedClasses.find((row) => idsEqual(row?.id, sourceClassId));
    const classFallbackTeacherId = toPublicId(sourceClassRow?.instructors?.[0]?.personId);
    const sessionRows = Array.isArray(bundle?.sessions) ? bundle.sessions : [];
    sessionRows.forEach((sessionRow) => {
      if (sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
        status: sessionRow?.status,
        notes: sessionRow?.notes
      })) return;
      const date = String(sessionRow?.date || '').trim();
      const startTime = schedulingTimePolicyService.normalizeClockTime(sessionRow?.startTime);
      const endTime = schedulingTimePolicyService.normalizeClockTime(sessionRow?.endTime);
      if (!date || !startTime || !endTime) return;
      const deliveryPersonIds = sessionConflictDetectionService.resolveSessionDeliveryPersonIds(
        sessionRow,
        classFallbackTeacherId,
        teacherIdentityLookup
      );
      deliveryPersonIds.forEach((personId) => {
        if (!personId) return;
        const key = `${personId}::${date}`;
        if (!teacherDayMap.has(key)) teacherDayMap.set(key, []);
        teacherDayMap.get(key).push({ startTime, endTime });
      });
    });
  });
  return teacherDayMap;
}

async function rankTeachersByAvailability({
  orgId = '',
  startDate = '',
  endDate = '',
  departmentId = '',
  programId = '',
  teacherIds = null,
  reqUser = null
} = {}) {
  const activeOrgId = toPublicId(orgId);
  const rangeStart = normalizeDateOnly(startDate);
  const rangeEnd = normalizeDateOnly(endDate) || rangeStart;
  if (!activeOrgId) {
    const error = new Error('Organization is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
    const error = new Error('A valid start and end date are required.');
    error.statusCode = 400;
    throw error;
  }

  const policy = await schedulingTimePolicyModel.getPolicyForOrg(activeOrgId);
  if (!policy?.timeFrames?.length) {
    const error = new Error('Scheduling time frames are not configured for this organization.');
    error.statusCode = 400;
    throw error;
  }

  const frames = policy.timeFrames
    .map((frame) => clipFrameToDayBounds(frame, policy.dayBounds))
    .filter(Boolean);
  if (!frames.length) {
    const error = new Error('No usable scheduling time frames fall within day bounds.');
    error.statusCode = 400;
    throw error;
  }

  const teacherRows = await schoolDataService.fetchAllData('teachers', {}, reqUser).catch(() => []);
  const limitSet = Array.isArray(teacherIds) && teacherIds.length
    ? new Set(teacherIds.map((id) => toPublicId(id)).filter(Boolean))
    : null;

  let candidates = (Array.isArray(teacherRows) ? teacherRows : []).filter((row) => {
    if (!idsEqual(row?.orgId, activeOrgId)) return false;
    if (!teacherTeachingQualificationsService.isActiveTeacherRecord(row)) return false;
    if (limitSet && !limitSet.has(toPublicId(row?.id))) return false;
    return teacherTeachingQualificationsService.teacherMatchesQualificationFilter(row, {
      departmentId,
      programId,
      startDate: rangeStart,
      endDate: rangeEnd
    });
  });

  const teacherDayMap = await buildTeacherDayBusyMap({
    orgId: activeOrgId,
    startDate: rangeStart,
    endDate: rangeEnd,
    reqUser
  });

  const dates = listDatesInclusive(rangeStart, rangeEnd);
  const personIds = candidates.map((row) => toPublicId(row?.personId)).filter(Boolean);
  const personById = await schoolPersonAccessService.buildPersonByIdMap({ reqUser, personIds });

  const teachers = candidates.map((teacher) => {
    const personId = toPublicId(teacher?.personId);
    const byFrame = frames.map((frame) => {
      let freeMinutes = 0;
      dates.forEach((date) => {
        const busyKey = `${personId}::${date}`;
        const busyIntervals = teacherDayMap.get(busyKey) || [];
        freeMinutes += schedulingTimePolicyService.freeMinutesInFrame(frame, busyIntervals);
      });
      return { frameId: frame.id, label: frame.label, freeMinutes };
    });
    const totalFreeMinutes = byFrame.reduce((sum, row) => sum + Number(row.freeMinutes || 0), 0);
    let sessionCount = 0;
    dates.forEach((date) => {
      const busyKey = `${personId}::${date}`;
      sessionCount += (teacherDayMap.get(busyKey) || []).length;
    });
    const person = personById.get(personId);
    const displayName = person
      ? schoolPersonAccessService.formatPersonName(person, personId)
      : String(teacher?.employeeNumber || personId || teacher?.id || '').trim();
    return {
      teacherId: toPublicId(teacher?.id),
      personId,
      displayName,
      totalFreeMinutes,
      byFrame,
      sessionCount
    };
  }).sort((a, b) => b.totalFreeMinutes - a.totalFreeMinutes || String(a.displayName).localeCompare(String(b.displayName)));

  return {
    orgId: activeOrgId,
    startDate: rangeStart,
    endDate: rangeEnd,
    dayBounds: policy.dayBounds,
    timeFrames: frames,
    teachers
  };
}

module.exports = {
  rankTeachersByAvailability,
  listDatesInclusive,
  clipFrameToDayBounds
};
