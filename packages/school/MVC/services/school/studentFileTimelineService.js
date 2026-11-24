'use strict';

const dataService = require('./schoolDataService');
const reportService = require('./reportService');
const termRegistrationViewService = require('./termRegistrationViewService');
const studentReportInstancesService = require('./studentReportInstancesService');
const sessionStudentCaseWorkspaceService = require('./sessionStudentCaseWorkspaceService');
const reportHubStudentDirectoryService = require('./reportHubStudentDirectoryService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CASE_ROWS = 400;
const MAX_ACTIVITY_ROWS = 200;

function normalizeText(value) {
  return String(value || '').trim();
}

function isValidTimelineDate(value) {
  const text = normalizeText(value);
  return DATE_RE.test(text);
}

function sortTimelineEvents(events) {
  return [...(Array.isArray(events) ? events : [])].sort((a, b) => {
    const dateCmp = String(a?.date || '').localeCompare(String(b?.date || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(a?.type || '').localeCompare(String(b?.type || ''))
      || String(a?.label || '').localeCompare(String(b?.label || ''))
      || String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

function computeTimelineDateRange(events) {
  const dates = (Array.isArray(events) ? events : [])
    .map((row) => normalizeText(row?.date))
    .filter(isValidTimelineDate)
    .sort();
  if (!dates.length) {
    return { minDate: '', maxDate: '' };
  }
  return { minDate: dates[0], maxDate: dates[dates.length - 1] };
}

function makeEventId(parts) {
  return parts.map((part) => normalizeText(part)).filter(Boolean).join(':');
}

function pushEvent(bag, event) {
  if (!event || !isValidTimelineDate(event.date)) return;
  bag.push(event);
}

function readActivityFirstDate(row) {
  const entries = Array.isArray(row?.entries) ? row.entries : [];
  const dates = entries
    .map((entry) => normalizeText(entry?.date || entry?.activityDate || entry?.startDate))
    .filter(isValidTimelineDate)
    .sort();
  if (dates.length) return dates[0];
  const direct = normalizeText(row?.date || row?.activityDate || row?.startDate || row?.firstDate);
  return isValidTimelineDate(direct) ? direct : '';
}

function readActivityLastDate(row, firstDate) {
  const entries = Array.isArray(row?.entries) ? row.entries : [];
  const dates = entries
    .map((entry) => normalizeText(entry?.date || entry?.activityDate || entry?.startDate))
    .filter(isValidTimelineDate)
    .sort();
  if (dates.length) return dates[dates.length - 1];
  const last = normalizeText(row?.lastDate || row?.endDate);
  if (isValidTimelineDate(last)) return last;
  return firstDate;
}

function activityAssignsPerson(row, personId) {
  const target = toPublicId(personId);
  if (!target) return false;
  const assignees = Array.isArray(row?.assignees) ? row.assignees : [];
  return assignees.some((assignee) => {
    const pid = toPublicId(assignee?.personId || assignee?.legacyImportPersonId || assignee?.id);
    return pid && idsEqual(pid, target);
  });
}

function withSmEmbed(url) {
  const raw = normalizeText(url);
  if (!raw) return '';
  if (/[?&]smEmbed=/.test(raw)) return raw;
  const join = raw.includes('?') ? '&' : '?';
  return `${raw}${join}smEmbed=1`;
}

const CLB_SKILLS = ['listening', 'speaking', 'reading', 'writing'];

function formatClbBand(bucket, title) {
  if (!bucket || typeof bucket !== 'object') return '';
  const parts = CLB_SKILLS.map((skill) => {
    const value = normalizeText(bucket[skill]);
    if (!value) return '';
    return `${skill.charAt(0).toUpperCase() + skill.slice(1)}: ${value}`;
  }).filter(Boolean);
  return parts.length ? `${title}: ${parts.join(', ')}` : '';
}

function buildClbTooltipLines(entry) {
  const lines = [];
  const goal = formatClbBand(entry?.goal, 'Goal');
  const current = formatClbBand(entry?.current, 'Current');
  const result = formatClbBand(entry?.result, 'Result');
  if (goal) lines.push(goal);
  if (current) lines.push(current);
  if (result) lines.push(result);
  const note = normalizeText(entry?.note);
  if (note) lines.push(`Note: ${note}`);
  return lines;
}

function buildEnrollmentTooltipLines(row) {
  const lines = [];
  const classTitle = normalizeText(row?.classTitle || row?.classId);
  const teacherName = normalizeText(row?.teacherName);
  if (classTitle) lines.push(`Class: ${classTitle}`);
  if (teacherName) lines.push(`Teacher: ${teacherName}`);
  const termLabel = normalizeText(row?.termLabel);
  if (termLabel) lines.push(`Term: ${termLabel}`);
  return lines;
}

function resolveActivitySkillLabels(row, skillLabelById) {
  const ids = Array.isArray(row?.skillIds) ? row.skillIds : [];
  const names = ids.map((rawId) => {
    const id = toPublicId(rawId);
    return skillLabelById.get(id) || normalizeText(rawId);
  }).filter(Boolean);
  return names;
}

async function buildSkillLabelMap(req) {
  const map = new Map();
  try {
    const skills = await dataService.fetchAllData(
      'skills',
      {},
      req.user,
      dataService.buildRouteAccessContext(req)
    );
    (Array.isArray(skills) ? skills : []).forEach((row) => {
      const id = toPublicId(row?.id);
      if (!id) return;
      map.set(id, normalizeText(row?.name || row?.code || row?.label || id));
    });
  } catch (_) {
    /* optional */
  }
  return map;
}

async function buildStudentFileTimeline(studentId, req) {
  const normalizedStudentId = toPublicId(studentId);
  if (!normalizedStudentId) {
    const error = new Error('Student is required.');
    error.statusCode = 400;
    throw error;
  }

  const profile = await reportHubStudentDirectoryService.buildPersonalProfile(normalizedStudentId, req);
  const personId = toPublicId(profile?.personId);
  const skillLabelById = await buildSkillLabelMap(req);
  const events = [];
  let truncated = false;

  pushEvent(events, {
    id: makeEventId(['student_enrollment', normalizedStudentId]),
    date: normalizeText(profile?.enrollmentDate),
    type: 'student_enrollment_start',
    label: 'Student enrollment',
    sublabel: '',
    tooltipLines: ['School enrollment date'],
    action: { kind: 'noop' }
  });

  (Array.isArray(profile?.programRegistrations) ? profile.programRegistrations : []).forEach((row) => {
    const regId = normalizeText(row?.id);
    pushEvent(events, {
      id: makeEventId(['program_registration', regId]),
      date: normalizeText(row?.registrationDate),
      type: 'program_registration',
      label: 'Program registration',
      sublabel: normalizeText(row?.programLabel || row?.programId),
      tooltipLines: [
        `Program: ${normalizeText(row?.programLabel || row?.programId || '-')}`
      ],
      action: {
        kind: 'embed_url',
        title: 'Program registration',
        url: regId ? withSmEmbed(`/school/programs/registrations/${encodeURIComponent(regId)}`) : ''
      }
    });
  });

  const activeOrgId = getActiveOrgIdOrThrow(req.user);
  let termRows = [];
  try {
    termRows = await termRegistrationViewService.buildRegistrationSummaries(req.user, activeOrgId, {
      filters: { studentId: normalizedStudentId }
    });
  } catch (_) {
    termRows = [];
  }
  (Array.isArray(termRows) ? termRows : []).forEach((row) => {
    const regId = normalizeText(row?.id);
    pushEvent(events, {
      id: makeEventId(['term_registration', regId]),
      date: normalizeText(row?.registrationDate),
      type: 'term_registration',
      label: 'Term registration',
      sublabel: [row?.programLabel, row?.termLabel].map(normalizeText).filter(Boolean).join(' · '),
      tooltipLines: [
        `Program: ${normalizeText(row?.programLabel || row?.programId || '-')}`,
        `Term: ${normalizeText(row?.termLabel || row?.termId || '-')}`
      ].filter((line) => !line.endsWith(': -')),
      action: {
        kind: 'embed_url',
        title: 'Term registration',
        url: regId ? withSmEmbed(`/school/programs/term-registrations/${encodeURIComponent(regId)}`) : ''
      }
    });
  });

  (Array.isArray(profile?.classEnrollments) ? profile.classEnrollments : []).forEach((row) => {
    const enrollmentId = normalizeText(row?.id);
    const classTitle = normalizeText(row?.classTitle || row?.classId);
    const actionRow = {
      id: enrollmentId,
      classId: normalizeText(row?.classId),
      classTitle,
      teacherName: normalizeText(row?.teacherName),
      programLabel: normalizeText(row?.programLabel),
      termLabel: normalizeText(row?.termLabel),
      startDate: normalizeText(row?.startDate),
      endDate: normalizeText(row?.endDate),
      status: normalizeText(row?.status),
      editUrl: normalizeText(row?.editUrl)
    };
    const enrollmentTip = buildEnrollmentTooltipLines(actionRow);
    pushEvent(events, {
      id: makeEventId(['class_enrollment_start', enrollmentId]),
      date: normalizeText(row?.startDate),
      type: 'class_enrollment_start',
      label: 'Enrollment start',
      sublabel: classTitle,
      tooltipLines: enrollmentTip,
      action: {
        kind: 'enrollment_edit_embed',
        title: classTitle || 'Class enrollment',
        url: actionRow.editUrl ? withSmEmbed(actionRow.editUrl) : '',
        enrollmentRow: actionRow
      }
    });
    pushEvent(events, {
      id: makeEventId(['class_enrollment_end', enrollmentId]),
      date: normalizeText(row?.endDate),
      type: 'class_enrollment_end',
      label: 'Enrollment end',
      sublabel: classTitle,
      tooltipLines: enrollmentTip,
      action: {
        kind: 'enrollment_close',
        enrollmentRow: actionRow
      }
    });
  });

  const clbHistory = reportService.getSortedClbLevelHistory({ clbLevelHistory: profile?.clbLevelHistory });
  clbHistory.forEach((entry) => {
    const entryId = normalizeText(entry?.id);
    const recordedAt = normalizeText(entry?.recordedAt);
    const resultRecordedAt = normalizeText(entry?.resultRecordedAt);
    pushEvent(events, {
      id: makeEventId(['clb_recorded', entryId]),
      date: recordedAt,
      type: 'clb_recorded',
      label: 'CLB recorded',
      sublabel: entryId,
      tooltipLines: buildClbTooltipLines(entry),
      action: { kind: 'manager_clb', studentId: normalizedStudentId, entryId }
    });
    if (resultRecordedAt && resultRecordedAt !== recordedAt) {
      pushEvent(events, {
        id: makeEventId(['clb_result', entryId]),
        date: resultRecordedAt,
        type: 'clb_result',
        label: 'CLB result',
        sublabel: entryId,
        tooltipLines: buildClbTooltipLines(entry),
        action: { kind: 'manager_clb', studentId: normalizedStudentId, entryId }
      });
    }
  });

  (Array.isArray(profile?.referralLinks) ? profile.referralLinks : []).forEach((link, index) => {
    const linkKey = normalizeText(link?.id) || String(index);
    pushEvent(events, {
      id: makeEventId(['referral_link', linkKey]),
      date: normalizeText(link?.linkDate),
      type: 'referral_link',
      label: 'Referral',
      sublabel: normalizeText(link?.referralLabel || link?.referralId || ''),
      tooltipLines: [
        `Referrer: ${normalizeText(link?.referralLabel || link?.referralName || link?.referralId || '-')}`,
        link?.programLabel ? `Program: ${normalizeText(link.programLabel)}` : ''
      ].filter(Boolean),
      action: { kind: 'manager_referrals', studentId: normalizedStudentId, linkId: linkKey }
    });
  });

  if (personId) {
    try {
      const reportBundle = await studentReportInstancesService.listStudentReportInstancesForForm({
        reqUser: req.user,
        personId
      });
      (Array.isArray(reportBundle?.rows) ? reportBundle.rows : []).forEach((row) => {
        const instanceId = normalizeText(row?.id);
        const sessionDate = normalizeText(row?.sessionDate);
        if (!isValidTimelineDate(sessionDate)) return;
        const embedUrl = normalizeText(row?.openV2Url || row?.openUrl);
        pushEvent(events, {
          id: makeEventId(['report_instance', instanceId]),
          date: sessionDate,
          type: 'report_instance',
          label: 'Report',
          sublabel: normalizeText(row?.templateTitle || row?.classTitle || instanceId),
          tooltipLines: [
            `Report: ${normalizeText(row?.templateTitle || row?.templateId || '-')}`,
            row?.classTitle ? `Class: ${normalizeText(row.classTitle)}` : '',
            row?.teacherName ? `Teacher: ${normalizeText(row.teacherName)}` : ''
          ].filter(Boolean),
          action: {
            kind: 'embed_url',
            title: 'Report',
            url: embedUrl ? withSmEmbed(embedUrl) : ''
          }
        });
      });
    } catch (_) {
      /* reports optional on timeline */
    }
  }

  if (personId) {
    try {
      const caseWorkspace = await sessionStudentCaseWorkspaceService.listSessionStudentCasesForRequest(req, {
        queryInput: { studentPersonId: personId },
        searchQuery: '',
        applyAccessScope: true,
        accessContext: dataService.buildRouteAccessContext(req)
      });
      const caseRows = Array.isArray(caseWorkspace?.rows) ? caseWorkspace.rows : [];
      if (caseRows.length > MAX_CASE_ROWS) truncated = true;
      caseRows.slice(0, MAX_CASE_ROWS).forEach((row) => {
        const caseId = normalizeText(row?.id);
        const sessionDate = normalizeText(row?.sessionDate);
        const reviewHref = normalizeText(row?.actions?.[0]?.href || row?.reviewHref);
        pushEvent(events, {
          id: makeEventId(['session_case', caseId]),
          date: sessionDate,
          type: 'session_case',
          label: 'Session case',
          sublabel: normalizeText(row?.summary || row?.category || caseId),
          tooltipLines: [
            `Category: ${normalizeText(row?.category || '-')}`,
            `Summary: ${normalizeText(row?.summary || '-')}`
          ],
          action: reviewHref
            ? { kind: 'embed_url', title: 'Student case', url: withSmEmbed(reviewHref) }
            : {
              kind: 'session_cases_day',
              personId,
              date: sessionDate
            }
        });
      });
    } catch (_) {
      /* cases optional */
    }
  }

  if (personId) {
    try {
      const activities = await dataService.fetchAllData(
        'activities',
        {},
        req.user,
        dataService.buildRouteAccessContext(req)
      );
      const activityRows = (Array.isArray(activities) ? activities : [])
        .filter((row) => activityAssignsPerson(row, personId));
      if (activityRows.length > MAX_ACTIVITY_ROWS) truncated = true;
      activityRows.slice(0, MAX_ACTIVITY_ROWS).forEach((row) => {
        const activityId = normalizeText(row?.id);
        const firstDate = readActivityFirstDate(row);
        const lastDate = readActivityLastDate(row, firstDate);
        const title = normalizeText(row?.title || row?.name || activityId || 'Activity');
        const skillNames = resolveActivitySkillLabels(row, skillLabelById);
        const activityTip = [
          `Activity: ${title}`,
          skillNames.length ? `Skills: ${skillNames.join(', ')}` : ''
        ].filter(Boolean);
        const editUrl = activityId ? `/school/activities/edit/${encodeURIComponent(activityId)}` : '';
        pushEvent(events, {
          id: makeEventId(['activity', activityId, firstDate]),
          date: firstDate,
          type: 'activity',
          label: 'Activity',
          sublabel: title,
          tooltipLines: activityTip,
          action: {
            kind: 'embed_url',
            title: 'Activity',
            url: editUrl ? withSmEmbed(editUrl) : ''
          }
        });
        if (lastDate && lastDate !== firstDate) {
          pushEvent(events, {
            id: makeEventId(['activity_end', activityId, lastDate]),
            date: lastDate,
            type: 'activity',
            label: 'Activity (last day)',
            sublabel: title,
            tooltipLines: activityTip,
            action: {
              kind: 'embed_url',
              title: 'Activity',
              url: editUrl ? withSmEmbed(editUrl) : ''
            }
          });
        }
      });
    } catch (_) {
      /* activities optional */
    }
  }

  const sorted = sortTimelineEvents(events);
  const range = computeTimelineDateRange(sorted);

  return {
    student: {
      id: normalizedStudentId,
      personId: personId || '',
      name: normalizeText(profile?.name)
    },
    range,
    events: sorted,
    truncated: truncated === true
  };
}

module.exports = {
  buildStudentFileTimeline,
  sortTimelineEvents,
  computeTimelineDateRange,
  isValidTimelineDate,
  buildClbTooltipLines,
  buildEnrollmentTooltipLines
};