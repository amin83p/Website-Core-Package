const schoolDataService = require('./schoolDataService');
const schoolRepositories = require('../../repositories/school');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const { requireCoreModule } = require('./schoolCoreContracts');
const {
  isRecordAccessibleByOrg,
  canBypassOrgScope
} = require('./schoolDataScopeBuilder');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function inferAssignmentReportScope(row) {
  const explicit = String(row?.reportScope || '').trim().toLowerCase();
  if (['class', 'each_student', 'selected_students'].includes(explicit)) return explicit;
  return 'class';
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

async function resolveClassStudentIds({
  classData,
  sessions = [],
  reqUser,
  referenceDate = '',
  strictCanonical = false
} = {}) {
  const classId = String(classData?.id || '').trim();
  if (!classId) return [];
  const snapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
    classId,
    classItem: classData,
    reqUser,
    activeOrgId: classData?.orgId,
    sessionDates: (Array.isArray(sessions) ? sessions : []).map((row) => String(row?.date || '').trim()).filter(Boolean),
    startDate: referenceDate,
    endDate: referenceDate,
    canonicalStatuses: classEnrollmentReadService.getReportRosterStatusesForClass(classData)
  });
  const activeStudentIds = snapshot?.studentIds instanceof Set ? [...snapshot.studentIds] : [];
  if (!activeStudentIds.length) return [];

  const allStudents = await schoolDataService.fetchData('students', {}, reqUser);
  const studentToPersonMap = new Map(
    (Array.isArray(allStudents) ? allStudents : [])
      .map((student) => [String(student?.id || '').trim(), String(student?.personId || '').trim()])
      .filter(([studentId, personId]) => Boolean(studentId && personId))
  );

  const resolvedSet = new Set();
  activeStudentIds.forEach((studentId) => {
    const personId = String(studentToPersonMap.get(String(studentId || '').trim()) || '').trim();
    if (personId) resolvedSet.add(personId);
  });

  return [...resolvedSet];
}

function getTargetDatesForValidation({
  hasSessionTargets = false,
  selectedSessionIds = [],
  sessions = [],
  selectedDateTargets = [],
  requestedReportDueDate = ''
} = {}) {
  const unique = new Set();
  const targetDates = [];
  const pushDate = (raw) => {
    const clean = normalizeDateOnly(raw);
    if (!clean || unique.has(clean)) return;
    unique.add(clean);
    targetDates.push(clean);
  };

  if (hasSessionTargets) {
    const selectedSessionSet = new Set(
      (Array.isArray(selectedSessionIds) ? selectedSessionIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    selectedSessionSet.forEach((sessionId) => {
      const session = (Array.isArray(sessions) ? sessions : [])
        .find((row) => String(row?.sessionId || '').trim() === sessionId);
      if (!session) throw new Error(`Selected session ${sessionId} was not found in this class.`);
      const sessionDate = normalizeDateOnly(session?.date);
      if (!sessionDate) throw new Error(`Selected session ${sessionId} is missing a valid date.`);
      pushDate(sessionDate);
    });
    return targetDates;
  }

  (Array.isArray(selectedDateTargets) ? selectedDateTargets : []).forEach((date) => pushDate(date));
  if (!targetDates.length && requestedReportDueDate) pushDate(requestedReportDueDate);
  return targetDates;
}

function normalizeTimeValue(value) {
  const raw = String(value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return '';
  const [hRaw, mRaw] = raw.split(':');
  const hour = Number(hRaw);
  const minute = Number(mRaw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return '';
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function toMinutes(timeValue) {
  const normalized = normalizeTimeValue(timeValue);
  if (!normalized) return null;
  const [hRaw, mRaw] = normalized.split(':');
  return (Number(hRaw) * 60) + Number(mRaw);
}

function windowsOverlap(aStart, aEnd, bStart, bEnd) {
  const aStartMin = toMinutes(aStart);
  const aEndMin = toMinutes(aEnd);
  const bStartMin = toMinutes(bStart);
  const bEndMin = toMinutes(bEnd);
  if ([aStartMin, aEndMin, bStartMin, bEndMin].some((v) => !Number.isInteger(v))) return false;
  if (aEndMin <= aStartMin || bEndMin <= bStartMin) return false;
  return aStartMin < bEndMin && bStartMin < aEndMin;
}

function inferAssignmentTargetType(row) {
  const explicit = String(row?.targetType || '').trim().toLowerCase();
  if (explicit === 'date') return 'date';
  if (explicit === 'session') return 'session';
  return String(row?.sessionId || '').trim() ? 'session' : 'date';
}

function resolveAssignmentDate(row) {
  const targetType = inferAssignmentTargetType(row);
  if (targetType === 'session') return String(row?.sessionDate || row?.dueDate || '').trim();
  return String(row?.dueDate || row?.sessionDate || '').trim();
}

function resolveAssignmentTimeWindow(row, classSessionsMap = new Map()) {
  const fromRecordStart = normalizeTimeValue(row?.taskStartTime);
  const fromRecordEnd = normalizeTimeValue(row?.taskEndTime);
  if (fromRecordStart && fromRecordEnd) return { start: fromRecordStart, end: fromRecordEnd };

  const classId = String(row?.classId || '').trim();
  const sessionId = String(row?.sessionId || '').trim();
  if (!classId || !sessionId) return { start: '', end: '' };

  const sessions = classSessionsMap.get(classId) || [];
  const session = sessions.find((item) => String(item?.sessionId || '').trim() === sessionId) || null;
  return {
    start: normalizeTimeValue(session?.startTime),
    end: normalizeTimeValue(session?.endTime)
  };
}

function isActiveAssignmentStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'active';
}

function buildClassInstructorSet(classRow) {
  const set = new Set();
  (Array.isArray(classRow?.instructors) ? classRow.instructors : []).forEach((inst) => {
    const personId = String(inst?.personId || '').trim();
    if (personId) set.add(personId);
  });
  return set;
}

function isArchivedInstance(instance) {
  return String(instance?.status || '').trim().toLowerCase() === 'archived';
}

function assertInstanceAssignmentConsistency(instance, assignment) {
  if (!assignment) {
    throw new Error('Report assignment for this instance is no longer available.');
  }
  if (!idsEqual(instance?.orgId, assignment?.orgId)) {
    throw new Error('Report instance no longer matches its assignment organization.');
  }
  if (!idsEqual(instance?.classId, assignment?.classId)) {
    throw new Error('Report instance no longer matches its assignment class.');
  }
  if (!idsEqual(instance?.templateId, assignment?.templateId)) {
    throw new Error('Report instance no longer matches its assignment template.');
  }
}

async function assertNoAssignmentScheduleConflicts({
  reqUser,
  classData,
  sessions = [],
  selectedSessionIds = [],
  selectedDateTargets = [],
  teacherIds = [],
  requestedTaskStartTime = '',
  requestedTaskEndTime = '',
  conflictPermitted = false,
  excludeAssignmentId = ''
}) {
  const taskStartTime = normalizeTimeValue(requestedTaskStartTime);
  const taskEndTime = normalizeTimeValue(requestedTaskEndTime);
  if (!taskStartTime || !taskEndTime) {
    throw new Error('Task start/end time are required for schedule conflict validation.');
  }
  if (taskStartTime >= taskEndTime) {
    throw new Error('Task end time must be later than task start time.');
  }
  if (Boolean(conflictPermitted)) return;

  const uniqueTeacherIds = [...new Set((Array.isArray(teacherIds) ? teacherIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!uniqueTeacherIds.length) return;

  const classId = String(classData?.id || classData?.classId || '').trim();
  const classTitle = String(classData?.title || classId || 'Class').trim() || 'Class';
  const selectedSessionSet = new Set((Array.isArray(selectedSessionIds) ? selectedSessionIds : []).map((id) => String(id || '').trim()).filter(Boolean));

  const candidateTargets = [];
  if (selectedSessionSet.size) {
    for (const sessionId of selectedSessionSet) {
      const session = (Array.isArray(sessions) ? sessions : []).find((row) => String(row?.sessionId || '').trim() === sessionId);
      if (!session) throw new Error(`Selected session ${sessionId} was not found in class ${classTitle}.`);
      const date = String(session?.date || '').trim();
      if (!date) throw new Error(`Selected session ${sessionId} is missing a valid date.`);
      candidateTargets.push({
        label: `${classTitle} ${sessionId}`,
        date,
        classId,
        sessionId,
        start: taskStartTime,
        end: taskEndTime
      });
    }
  } else {
    const uniqueDates = [...new Set((Array.isArray(selectedDateTargets) ? selectedDateTargets : []).map((d) => String(d || '').trim()).filter(Boolean))];
    uniqueDates.forEach((date) => {
      candidateTargets.push({
        label: `${classTitle} due ${date}`,
        date,
        classId,
        sessionId: '',
        start: taskStartTime,
        end: taskEndTime
      });
    });
  }

  if (!candidateTargets.length) return;

  const allClasses = await schoolDataService.fetchData('classes', {}, reqUser);
  const orgClasses = (Array.isArray(allClasses) ? allClasses : []).filter((row) => String(row?.orgId || '').trim() === String(classData?.orgId || '').trim());

  const classSessionsMap = new Map();
  const classInstructorMap = new Map();
  for (const row of orgClasses) {
    const rowClassId = String(row?.id || '').trim();
    if (!rowClassId) continue;
    classInstructorMap.set(rowClassId, buildClassInstructorSet(row));
    // eslint-disable-next-line no-await-in-loop
    const classSessions = rowClassId === classId ? sessions : await schoolDataService.getClassSessions(rowClassId, reqUser);
    classSessionsMap.set(rowClassId, Array.isArray(classSessions) ? classSessions : []);
  }

  const allAssignments = await schoolRepositories.reportAssignments.list({
    query: {},
    scope: { canViewAll: true }
  });
  const existingAssignments = (Array.isArray(allAssignments) ? allAssignments : [])
    .filter((row) => String(row?.orgId || '').trim() === String(classData?.orgId || '').trim())
    .filter((row) => isActiveAssignmentStatus(row?.status))
    .filter((row) => !excludeAssignmentId || String(row?.id || '').trim() !== String(excludeAssignmentId).trim());

  for (const teacherId of uniqueTeacherIds) {
    for (const target of candidateTargets) {
      for (const row of orgClasses) {
        const rowClassId = String(row?.id || '').trim();
        if (!rowClassId) continue;
        const instructorSet = classInstructorMap.get(rowClassId) || new Set();
        const classSessions = classSessionsMap.get(rowClassId) || [];

        for (const session of classSessions) {
          const sessionDate = String(session?.date || '').trim();
          if (!sessionDate || sessionDate !== target.date) continue;
          const deliveredBy = String(session?.delivery?.deliveredBy || '').trim();
          const teacherAssigned = deliveredBy ? deliveredBy === teacherId : instructorSet.has(teacherId);
          if (!teacherAssigned) continue;

          const sessionStart = normalizeTimeValue(session?.startTime);
          const sessionEnd = normalizeTimeValue(session?.endTime);
          if (!sessionStart || !sessionEnd) continue;
          if (!windowsOverlap(target.start, target.end, sessionStart, sessionEnd)) continue;

          throw new Error(
            `Schedule conflict for teacher ${teacherId}: ${target.label} (${target.date} ${target.start}-${target.end}) overlaps class session ` +
            `${row?.title || rowClassId} ${String(session?.sessionId || '').trim() || '(no id)'} (${sessionStart}-${sessionEnd}).`
          );
        }
      }

      for (const existing of existingAssignments) {
        if (Boolean(existing?.conflictPermitted) || inferAssignmentTargetType(existing) === 'session') continue;
        const existingTeachers = Array.isArray(existing?.teacherIds)
          ? existing.teacherIds.map((id) => String(id || '').trim()).filter(Boolean)
          : [];
        if (!existingTeachers.includes(teacherId)) continue;

        const existingDate = resolveAssignmentDate(existing);
        if (!existingDate || existingDate !== target.date) continue;
        const existingWindow = resolveAssignmentTimeWindow(existing, classSessionsMap);
        if (!existingWindow.start || !existingWindow.end) continue;
        if (!windowsOverlap(target.start, target.end, existingWindow.start, existingWindow.end)) continue;

        throw new Error(
          `Schedule conflict for teacher ${teacherId}: ${target.label} (${target.date} ${target.start}-${target.end}) overlaps ` +
          `report assignment ${existing.id} (${existingWindow.start}-${existingWindow.end}).`
        );
      }
    }

    for (let i = 0; i < candidateTargets.length; i += 1) {
      for (let j = i + 1; j < candidateTargets.length; j += 1) {
        const left = candidateTargets[i];
        const right = candidateTargets[j];
        if (left.date !== right.date) continue;
        if (!windowsOverlap(left.start, left.end, right.start, right.end)) continue;
        throw new Error(
          `Schedule conflict in selected targets for teacher ${teacherId}: "${left.label}" overlaps "${right.label}" on ${left.date}.`
        );
      }
    }
  }
}

async function assertTemplateAccessible(templateId, reqUser, { notFoundMessage = 'Template not found.' } = {}) {
  const template = await schoolRepositories.reportTemplates.getById(templateId);
  if (!template) throw new Error(notFoundMessage);
  if (!isRecordAccessibleByOrg(template, reqUser)) {
    throw new Error('Template is not accessible in this organization.');
  }
  return template;
}

const reportIntegrityService = {
  async assertTemplateAccessible(templateId, reqUser, options = {}) {
    return assertTemplateAccessible(templateId, reqUser, options);
  },

  async assertAssignmentAccessible(assignmentId, reqUser) {
    const assignment = await schoolRepositories.reportAssignments.getById(assignmentId);
    if (!assignment) throw new Error('Assignment not found.');
    if (!isRecordAccessibleByOrg(assignment, reqUser)) {
      throw new Error('Assignment is not accessible in this organization.');
    }
    return assignment;
  },

  async validateAssignmentCrossEntityContext({
    classId,
    templateId,
    reqUser,
    reportScope,
    hasSessionTargets,
    selectedSessionIds = [],
    selectedDateTargets = [],
    teacherIds = [],
    requestedTaskStartTime = '',
    requestedTaskEndTime = '',
    conflictPermitted = false,
    requestedReportStartDate = '',
    requestedReportDueDate = '',
    selectedTargetStudentIds = [],
    excludeAssignmentId = ''
  }) {
    const [classData, sessions, template] = await Promise.all([
      schoolDataService.getDataById('classes', classId, reqUser),
      schoolDataService.getClassSessions(classId, reqUser),
      assertTemplateAccessible(templateId, reqUser, { notFoundMessage: 'Template not found.' })
    ]);

    if (!classData) throw new Error('Class not found or inaccessible.');

    if (!['class', 'each_student', 'selected_students'].includes(String(reportScope || ''))) {
      throw new Error('Invalid report scope.');
    }

    const effectiveDateTargets = Array.isArray(selectedDateTargets)
      ? selectedDateTargets.map((d) => String(d || '').trim()).filter(Boolean)
      : [];
    if (!hasSessionTargets && !effectiveDateTargets.length && requestedReportDueDate) {
      effectiveDateTargets.push(String(requestedReportDueDate).trim());
    }
    if (!hasSessionTargets && !effectiveDateTargets.length) {
      throw new Error('Select at least one session, or provide due date (target date or report due date).');
    }

    if ((requestedReportStartDate && !requestedReportDueDate) || (!requestedReportStartDate && requestedReportDueDate)) {
      throw new Error('Provide both report start date and report due date, or leave both empty.');
    }

    const targetDates = getTargetDatesForValidation({
      hasSessionTargets,
      selectedSessionIds,
      sessions,
      selectedDateTargets: effectiveDateTargets,
      requestedReportDueDate
    });

    const studentIdsByTargetDate = new Map();
    for (const targetDate of targetDates) {
      // eslint-disable-next-line no-await-in-loop
      const studentIds = await resolveClassStudentIds({
        classData,
        sessions,
        reqUser,
        referenceDate: targetDate,
        strictCanonical: true
      });
      studentIdsByTargetDate.set(targetDate, new Set(studentIds));
    }

    if (reportScope === 'each_student') {
      const emptyDates = targetDates.filter((targetDate) => (studentIdsByTargetDate.get(targetDate)?.size || 0) === 0);
      if (emptyDates.length) {
        throw new Error(`No students with active enrollment on ${emptyDates.join(', ')} for "each student" scope.`);
      }
    }

    const selectedIds = Array.isArray(selectedTargetStudentIds) ? selectedTargetStudentIds : [];
    if (reportScope === 'selected_students' && !selectedIds.length) {
      throw new Error('Select at least one student for "specific students" scope.');
    }
    if (reportScope === 'selected_students') {
      for (const targetDate of targetDates) {
        const studentSet = studentIdsByTargetDate.get(targetDate) || new Set();
        const invalidIds = selectedIds.filter((studentId) => !studentSet.has(studentId));
        if (invalidIds.length) {
          throw new Error(`One or more selected students are not actively enrolled on ${targetDate}.`);
        }
      }
    }

    if (!hasSessionTargets && !Boolean(conflictPermitted)) {
      await assertNoAssignmentScheduleConflicts({
        reqUser,
        classData,
        sessions,
        selectedSessionIds,
        selectedDateTargets: effectiveDateTargets,
        teacherIds,
        requestedTaskStartTime,
        requestedTaskEndTime,
        conflictPermitted,
        excludeAssignmentId
      });
    }

    const classStudentIds = [...new Set(
      targetDates.flatMap((targetDate) => [...(studentIdsByTargetDate.get(targetDate) || new Set())])
    )];

    return {
      classData,
      sessions,
      template,
      classStudentIds,
      effectiveDateTargets,
      persistedTargetStudentIds: reportScope === 'selected_students' ? selectedTargetStudentIds : []
    };
  },

  async resolveStartInstanceContext({
    assignmentId,
    reqUser,
    requestedTeacherId = '',
    fallbackTeacherId = '',
    requestedStudentId = ''
  }) {
    const assignment = await this.assertAssignmentAccessible(assignmentId, reqUser);
    const template = await assertTemplateAccessible(assignment.templateId, reqUser, {
      notFoundMessage: 'Template not found for this assignment.'
    });

    const teacherId = String(requestedTeacherId || assignment.teacherIds?.[0] || fallbackTeacherId || '').trim();
    if (!teacherId) throw new Error('Unable to resolve teacher id for report instance.');
    if (!Array.isArray(assignment.teacherIds) || (!assignment.teacherIds.includes(teacherId) && !canBypassOrgScope(reqUser))) {
      throw new Error('Teacher is not listed in this assignment.');
    }

    const [classData, sessions] = await Promise.all([
      schoolDataService.getDataById('classes', assignment.classId, reqUser),
      schoolDataService.getClassSessions(assignment.classId, reqUser)
    ]);

    const reportScope = inferAssignmentReportScope(assignment);
    let referenceDate = String(assignment?.reportDueDate || assignment?.dueDate || assignment?.sessionDate || '').trim();
    if (!referenceDate && inferAssignmentTargetType(assignment) === 'session') {
      const sessionId = String(assignment?.sessionId || '').trim();
      if (sessionId) {
        const sessionMatch = (Array.isArray(sessions) ? sessions : [])
          .find((row) => String(row?.sessionId || '').trim() === sessionId);
        referenceDate = String(sessionMatch?.date || '').trim();
      }
    }
    const classStudentIds = await resolveClassStudentIds({
      classData,
      sessions,
      reqUser,
      referenceDate,
      strictCanonical: true
    });
    const classStudentSet = new Set(classStudentIds);

    let targetStudentIds = [];
    if (reportScope === 'class') {
      targetStudentIds = [''];
    } else if (reportScope === 'each_student') {
      targetStudentIds = classStudentIds;
      if (!targetStudentIds.length) throw new Error('No students found for this class assignment.');
    } else {
      const configured = Array.isArray(assignment.targetStudentIds)
        ? assignment.targetStudentIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
      targetStudentIds = configured.filter((id) => classStudentSet.has(id));
      if (!targetStudentIds.length) throw new Error('No valid selected students are available for this assignment.');
    }

    const cleanRequestedStudentId = String(requestedStudentId || '').trim();
    if (cleanRequestedStudentId) {
      if (!targetStudentIds.includes(cleanRequestedStudentId)) {
        throw new Error('Requested student is not part of this assignment target.');
      }
      targetStudentIds = [cleanRequestedStudentId];
    }

    return {
      assignment,
      template,
      classData,
      sessions,
      teacherId,
      targetStudentIds
    };
  },

  async getAccessibleInstanceOrThrow(instanceId, reqUser) {
    const instance = await schoolRepositories.reportInstances.getById(instanceId);
    if (!instance) throw new Error('Report instance not found.');
    if (isArchivedInstance(instance)) {
      throw new Error('This report instance has been archived and cannot be opened.');
    }
    if (!isRecordAccessibleByOrg(instance, reqUser)) {
      throw new Error('Instance is not accessible in this organization.');
    }
    const assignment = await schoolRepositories.reportAssignments.getById(instance.assignmentId);
    assertInstanceAssignmentConsistency(instance, assignment);
    return instance;
  },

  async getEditableInstanceOrThrow(instanceId, reqUser) {
    const instance = await this.getAccessibleInstanceOrThrow(instanceId, reqUser);
    if (String(instance.status || '') === 'locked') {
      throw new Error('This report is locked and cannot be edited.');
    }
    return instance;
  }
};

module.exports = reportIntegrityService;
