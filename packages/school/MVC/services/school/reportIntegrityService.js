const schoolDataService = require('./schoolDataService');
const schoolRepositories = require('../../repositories/school');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
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
  const targetRow = reportAssignmentModel.findEffectiveTargetRow(row, row?.assignmentRowId || row?.rowId || '');
  if (targetRow) return String(targetRow.reportDueDate || targetRow.dueDate || targetRow.sessionDate || '').trim();
  const targetType = inferAssignmentTargetType(row);
  if (targetType === 'session') return String(row?.sessionDate || row?.dueDate || '').trim();
  return String(row?.dueDate || row?.sessionDate || '').trim();
}

function resolveAssignmentTimeWindow(row, classSessionsMap = new Map()) {
  const targetRow = reportAssignmentModel.findEffectiveTargetRow(row, row?.assignmentRowId || row?.rowId || '');
  if (targetRow) {
    return {
      start: normalizeTimeValue(targetRow.taskStartTime),
      end: normalizeTimeValue(targetRow.taskEndTime)
    };
  }
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

function getClassSessionDateBounds(sessions = []) {
  const dates = (Array.isArray(sessions) ? sessions : [])
    .map((row) => normalizeDateOnly(row?.date))
    .filter(Boolean)
    .sort();
  return {
    firstSessionDate: dates[0] || '',
    lastSessionDate: dates[dates.length - 1] || ''
  };
}

function validateAssignmentTargetRowsAgainstSessions({ targetRows = [], sessions = [], requireTeacher = true } = {}) {
  const sessionMap = new Map(
    (Array.isArray(sessions) ? sessions : [])
      .map((row) => [String(row?.sessionId || '').trim(), row])
      .filter(([id]) => Boolean(id))
  );
  const { firstSessionDate, lastSessionDate } = getClassSessionDateBounds(sessions);
  const rows = Array.isArray(targetRows) ? targetRows : [];
  if (!rows.length) throw new Error('Add at least one report assignment target row.');

  rows.forEach((row, index) => {
    const label = `Target row ${index + 1}`;
    const targetType = String(row?.targetType || '').trim().toLowerCase();
    const sessionId = String(row?.sessionId || '').trim();
    const teacherId = String(row?.teacherId || '').trim();
    if (requireTeacher && !teacherId) throw new Error(`${label}: select one teacher.`);
    if (targetType !== 'date') {
      if (!sessionId) throw new Error(`${label}: select exactly one class session.`);
      const session = sessionMap.get(sessionId);
      if (!session) throw new Error(`${label}: selected session was not found in this class.`);
      const sessionDate = normalizeDateOnly(session?.date);
      if (!sessionDate) throw new Error(`${label}: selected session is missing a valid date.`);
      if (String(row?.sessionDate || '').trim() && normalizeDateOnly(row?.sessionDate) !== sessionDate) {
        throw new Error(`${label}: session date does not match the selected class session.`);
      }
    }
    const reportStartDate = normalizeDateOnly(row?.reportStartDate);
    const reportDueDate = normalizeDateOnly(row?.reportDueDate);
    if (!reportStartDate || !reportDueDate) throw new Error(`${label}: report start date and due date are required.`);
    if (reportStartDate > reportDueDate) throw new Error(`${label}: report start date cannot be after due date.`);
    if (firstSessionDate && reportStartDate < firstSessionDate) {
      throw new Error(`${label}: report start date cannot be before the first class session (${firstSessionDate}).`);
    }
    if (lastSessionDate && reportDueDate > lastSessionDate) {
      throw new Error(`${label}: report due date cannot be beyond the last class session (${lastSessionDate}).`);
    }
    const start = normalizeTimeValue(row?.taskStartTime);
    const end = normalizeTimeValue(row?.taskEndTime);
    if (targetType !== 'date' || start || end) {
      if (!start || !end) throw new Error(`${label}: task start/end time are required.`);
      if (start >= end) throw new Error(`${label}: task end time must be later than task start time.`);
    }
    if (row?.timesheetReflection === true) {
      const allocated = Number(row?.allocatedHours);
      if (!Number.isFinite(allocated) || allocated <= 0) {
        throw new Error(`${label}: allocated hours must be greater than zero when Timesheet reflection is enabled.`);
      }
    }
  });
}

function buildFallbackAssignmentTargetRows({
  sessions = [],
  hasSessionTargets,
  selectedSessionIds = [],
  selectedDateTargets = [],
  requestedReportStartDate = '',
  requestedReportDueDate = '',
  requestedTaskStartTime = '',
  requestedTaskEndTime = '',
  conflictPermitted = false,
  teacherIds = []
} = {}) {
  const sessionMap = new Map(
    (Array.isArray(sessions) ? sessions : [])
      .map((row) => [String(row?.sessionId || '').trim(), row])
      .filter(([id]) => Boolean(id))
  );
  if (hasSessionTargets) {
    return [...new Set((Array.isArray(selectedSessionIds) ? selectedSessionIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean))]
      .map((sessionId) => {
        const sessionDate = normalizeDateOnly(sessionMap.get(sessionId)?.date);
        return {
          targetType: 'session',
          sessionId,
          sessionDate,
          dueDate: '',
          reportStartDate: normalizeDateOnly(requestedReportStartDate) || sessionDate,
          reportDueDate: normalizeDateOnly(requestedReportDueDate) || sessionDate,
          taskStartTime: normalizeTimeValue(requestedTaskStartTime),
          taskEndTime: normalizeTimeValue(requestedTaskEndTime),
          conflictPermitted: true,
          timesheetReflection: false,
          allocatedHours: 0,
          teacherId: String((Array.isArray(teacherIds) ? teacherIds[0] : '') || '').trim(),
          status: 'active'
        };
      });
  }

  const dates = [...new Set((Array.isArray(selectedDateTargets) ? selectedDateTargets : [])
    .map((date) => normalizeDateOnly(date))
    .filter(Boolean))];
  if (!dates.length && requestedReportDueDate) dates.push(normalizeDateOnly(requestedReportDueDate));
  return dates.filter(Boolean).map((date) => ({
    targetType: 'date',
    sessionId: '',
    sessionDate: date,
    dueDate: date,
    reportStartDate: normalizeDateOnly(requestedReportStartDate) || date,
    reportDueDate: normalizeDateOnly(requestedReportDueDate) || date,
    taskStartTime: normalizeTimeValue(requestedTaskStartTime),
    taskEndTime: normalizeTimeValue(requestedTaskEndTime),
    conflictPermitted: Boolean(conflictPermitted),
    timesheetReflection: false,
    allocatedHours: 0,
    teacherId: String((Array.isArray(teacherIds) ? teacherIds[0] : '') || '').trim(),
    status: 'active'
  }));
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
    targetRows = [],
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

    const effectiveTargetRows = Array.isArray(targetRows) && targetRows.length
      ? targetRows
      : buildFallbackAssignmentTargetRows({
        sessions,
        hasSessionTargets,
        selectedSessionIds,
        selectedDateTargets,
        requestedReportStartDate,
        requestedReportDueDate,
        requestedTaskStartTime,
        requestedTaskEndTime,
        conflictPermitted,
        teacherIds
      });

    const targetRowsProvided = Array.isArray(targetRows) && targetRows.length > 0;
    validateAssignmentTargetRowsAgainstSessions({ targetRows: effectiveTargetRows, sessions, requireTeacher: targetRowsProvided });

    const effectiveDateTargets = targetRowsProvided
      ? [...new Set(effectiveTargetRows
        .map((row) => String(row?.dueDate || row?.sessionDate || '').trim())
        .filter(Boolean))]
      : (Array.isArray(selectedDateTargets)
        ? selectedDateTargets.map((d) => String(d || '').trim()).filter(Boolean)
        : []);
    if (!targetRowsProvided && !hasSessionTargets && !effectiveDateTargets.length && requestedReportDueDate) {
      effectiveDateTargets.push(String(requestedReportDueDate).trim());
    }
    if (!targetRowsProvided && !hasSessionTargets && !effectiveDateTargets.length) {
      throw new Error('Select at least one session, or provide due date (target date or report due date).');
    }

    if ((requestedReportStartDate && !requestedReportDueDate) || (!requestedReportStartDate && requestedReportDueDate)) {
      throw new Error('Provide both report start date and report due date, or leave both empty.');
    }

    const targetDates = [...new Set(effectiveTargetRows
      .map((row) => String(row?.reportDueDate || row?.dueDate || row?.sessionDate || '').trim())
      .filter(Boolean))];

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

    for (const targetRow of effectiveTargetRows) {
      if (Boolean(targetRow?.conflictPermitted)) continue;
      // eslint-disable-next-line no-await-in-loop
      await assertNoAssignmentScheduleConflicts({
        reqUser,
        classData,
        sessions,
        selectedSessionIds: [targetRow.sessionId].filter(Boolean),
        selectedDateTargets: [targetRow.dueDate || targetRow.sessionDate].filter(Boolean),
        teacherIds: [targetRow.teacherId].filter(Boolean),
        requestedTaskStartTime: targetRow.taskStartTime,
        requestedTaskEndTime: targetRow.taskEndTime,
        conflictPermitted: Boolean(targetRow.conflictPermitted),
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
      effectiveTargetRows,
      persistedTargetStudentIds: reportScope === 'selected_students' ? selectedTargetStudentIds : []
    };
  },

  async previewAssignmentTargetRows({
    classId,
    targetRows = [],
    reqUser,
    excludeAssignmentId = ''
  }) {
    const cleanClassId = String(classId || '').trim();
    if (!cleanClassId) throw new Error('Class is required.');

    const [classData, sessions] = await Promise.all([
      schoolDataService.getDataById('classes', cleanClassId, reqUser),
      schoolDataService.getClassSessions(cleanClassId, reqUser)
    ]);
    if (!classData) throw new Error('Class not found or inaccessible.');

    const rows = Array.isArray(targetRows) ? targetRows : [];
    const results = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const errors = [];
      const conflicts = [];

      try {
        validateAssignmentTargetRowsAgainstSessions({
          targetRows: [row],
          sessions,
          requireTeacher: true
        });
      } catch (error) {
        errors.push(String(error?.message || error || 'Validation failed.'));
      }

      if (!errors.length && !Boolean(row?.conflictPermitted)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await assertNoAssignmentScheduleConflicts({
            reqUser,
            classData,
            sessions,
            selectedSessionIds: [row?.sessionId].filter(Boolean),
            selectedDateTargets: [row?.dueDate || row?.sessionDate].filter(Boolean),
            teacherIds: [row?.teacherId].filter(Boolean),
            requestedTaskStartTime: row?.taskStartTime,
            requestedTaskEndTime: row?.taskEndTime,
            conflictPermitted: Boolean(row?.conflictPermitted),
            excludeAssignmentId
          });
        } catch (error) {
          conflicts.push(String(error?.message || error || 'Schedule conflict detected.'));
        }
      }

      results.push({
        index,
        valid: !errors.length && !conflicts.length,
        errors,
        conflicts
      });
    }

    return { rows: results };
  },

  async resolveStartInstanceContext({
    assignmentId,
    assignmentRowId = '',
    reqUser,
    requestedTeacherId = '',
    fallbackTeacherId = '',
    requestedStudentId = ''
  }) {
    const baseAssignment = await this.assertAssignmentAccessible(assignmentId, reqUser);
    const targetRow = reportAssignmentModel.findEffectiveTargetRow(baseAssignment, assignmentRowId);
    if (!targetRow) throw new Error('Report assignment target row not found.');
    const assignment = reportAssignmentModel.applyTargetRowToAssignment(baseAssignment, targetRow);
    const template = await assertTemplateAccessible(assignment.templateId, reqUser, {
      notFoundMessage: 'Template not found for this assignment.'
    });

    const rowTeacherId = String(assignment?.teacherId || targetRow?.teacherId || '').trim();
    const teacherId = String(rowTeacherId || requestedTeacherId || assignment.teacherIds?.[0] || fallbackTeacherId || '').trim();
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
      assignmentRow: targetRow,
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
    const reportViewService = require('./reportViewService');
    const allowed = await reportViewService.canEditReportInstanceAnswers(instance, reqUser);
    if (!allowed) {
      const status = String(instance.status || '').trim().toLowerCase();
      if (status === 'locked') {
        const err = new Error('This report is locked and cannot be edited.');
        err.code = 'REPORT_INSTANCE_LOCKED';
        err.statusCode = 403;
        throw err;
      }
      if (status === 'submitted') {
        const err = new Error(
          'This report is submitted and can only be edited by an administrator. Ask an admin to reopen it as draft.'
        );
        err.code = 'REPORT_INSTANCE_SUBMITTED_READONLY';
        err.statusCode = 403;
        throw err;
      }
      const err = new Error('This report cannot be edited.');
      err.statusCode = 403;
      throw err;
    }
    return instance;
  },

  resolveInstanceDeleteEligibility(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'locked') {
      return {
        allowed: false,
        reason: 'Locked report instances cannot be deleted.'
      };
    }
    return { allowed: true, reason: '' };
  },

  resolveInstanceUnlockTargetStatus(_instance) {
    return 'submitted';
  },

  async assertInstanceUnlockable(instanceId, reqUser) {
    const instance = await this.getAccessibleInstanceOrThrow(instanceId, reqUser);
    if (String(instance.status || '').trim().toLowerCase() !== 'locked') {
      throw new Error('Only locked report instances can be unlocked.');
    }
    return instance;
  },

  async assertInstanceReopenable(instanceId, reqUser) {
    const instance = await this.getAccessibleInstanceOrThrow(instanceId, reqUser);
    if (String(instance.status || '').trim().toLowerCase() !== 'submitted') {
      throw new Error('Only submitted report instances can be reopened to draft.');
    }
    return instance;
  },

  async assertInstanceDeletable(instanceId, reqUser) {
    const instance = await this.getAccessibleInstanceOrThrow(instanceId, reqUser);
    const eligibility = this.resolveInstanceDeleteEligibility(instance.status);
    if (!eligibility.allowed) {
      throw new Error(eligibility.reason);
    }
    return instance;
  }
};

module.exports = reportIntegrityService;
