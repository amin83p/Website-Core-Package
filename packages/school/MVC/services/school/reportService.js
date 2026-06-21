const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const reportRuleEngineService = require('./reportRuleEngineService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const { getPrefillValue, normalizePrefillKey } = require('./reportPrefillKeyUtils');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

/**
 * PREFILL_CATALOG - Curated list of template variable keys available for report prefill.
 * 
 * KEY BEHAVIOR & SCOPE:
 * - `common`: Available for all report types (class-scope and each-student-scope)
 * - `classOnly`: Behave differently depending on assignment.reportScope:
 *     * class-scope reports: Aggregate counts (e.g., class_attendance_present = total present count)
 *     * each-student-scope reports: Student-specific metrics (e.g., class_attendance_present = Attendance Matrix % for that student)
 * - `studentOnly`: Only available for each-student-scope reports; populated for target student
 * - `gradebookPeriodClass` / `gradebookPeriodStudent`: Period-based grade aggregates
 * - `examPeriodClass` / `examPeriodStudent`: Period-based exam stats
 * 
 * CRITICAL NOTES:
 * - Attendance Matrix percent treats missing/unmarked attendance marks as absent
 * - All keys must be produced by buildPrefillSnapshot(); audit test verifies this
 * - Keys are validated at template save-time via validateTemplatePrefillKeys()
 * - Type conversion applied at runtime (checkbox→boolean, number→finite)
 * - Braced keys {{key}} normalized to bare keys at save time
 */
const PREFILL_CATALOG = Object.freeze({
  common: Object.freeze([
    Object.freeze({ key: 'teacher_id', label: 'Teacher ID', description: 'Teacher person id assigned to this report instance.' }),
    Object.freeze({ key: 'teacher_name', label: 'Teacher Name', description: 'Teacher full name when available.' }),
    Object.freeze({ key: 'class_id', label: 'Class ID', description: 'Class identifier.' }),
    Object.freeze({ key: 'class_name', label: 'Class Name', description: 'Class title.' }),
    Object.freeze({ key: 'report_org_id', label: 'Report Organization ID', description: 'Organization id used for this report context.' }),
    Object.freeze({ key: 'report_org_name', label: 'Report Organization Name', description: 'Organization name used for this report context.' }),
    Object.freeze({ key: 'report_date', label: 'Report Date', description: 'Current date when report is generated/refreshed.' }),
    Object.freeze({ key: 'report_period_start_date', label: 'Report Period Start Date', description: 'Start date for report period-based calculations.' }),
    Object.freeze({ key: 'report_period_due_date', label: 'Report Period Due Date', description: 'End date for report period-based calculations.' }),
    Object.freeze({ key: 'report_period_days', label: 'Report Period Days', description: 'Total number of days in report period (inclusive).' }),
    Object.freeze({ key: 'session_id', label: 'Session ID', description: 'Selected session id (if available).' }),
    Object.freeze({ key: 'session_date', label: 'Session Date', description: 'Selected session date.' }),
    Object.freeze({ key: 'session_start_time', label: 'Session Start Time', description: 'Selected session start time.' }),
    Object.freeze({ key: 'session_end_time', label: 'Session End Time', description: 'Selected session end time.' })
  ]),
  classOnly: Object.freeze([
    Object.freeze({ key: 'class_attendance_total', label: 'Class Attendance Total', description: 'Class session roster count, or report-period session count for each-student reports.' }),
    Object.freeze({ key: 'class_attendance_present', label: 'Class Attendance Present', description: 'Class present count, or Attendance Matrix percent for each-student report periods.' }),
    Object.freeze({ key: 'class_attendance_late', label: 'Class Attendance Late', description: 'Class late count, or report-period late count for each-student reports.' }),
    Object.freeze({ key: 'class_attendance_excused', label: 'Class Attendance Excused', description: 'Class excused count, or report-period excused count for each-student reports.' }),
    Object.freeze({ key: 'class_attendance_absent', label: 'Class Attendance Absent', description: 'Class absent count, or missing/absent report-period session count for each-student reports.' }),
    Object.freeze({ key: 'class_attendance_span_sessions', label: 'Class Attendance Span Sessions', description: 'Number of sessions in the report period.' }),
    Object.freeze({ key: 'class_attendance_span_unique_students', label: 'Class Attendance Span Unique Students', description: 'Unique students observed across sessions in the report period.' }),
    Object.freeze({ key: 'class_attendance_span_total', label: 'Class Attendance Span Total', description: 'Total attendance rows across sessions in the report period.' }),
    Object.freeze({ key: 'class_attendance_span_present', label: 'Class Attendance Span Present', description: 'Present count across report-period sessions.' }),
    Object.freeze({ key: 'class_attendance_span_late', label: 'Class Attendance Span Late', description: 'Late count across report-period sessions.' }),
    Object.freeze({ key: 'class_attendance_span_excused', label: 'Class Attendance Span Excused', description: 'Excused count across report-period sessions.' }),
    Object.freeze({ key: 'class_attendance_span_absent', label: 'Class Attendance Span Absent', description: 'Absent count across report-period sessions.' }),
    Object.freeze({ key: 'class_attendance_span_percent', label: 'Class Attendance Span Percent', description: 'Computed attendance percentage across report-period sessions.' })
  ]),
  gradebookPeriodClass: Object.freeze([
    Object.freeze({ key: 'class_gradebook_period_sessions_count', label: 'Class Gradebook Period Sessions', description: 'Sessions in the report period (excludes sessions excluded from attendance matrix policy).' }),
    Object.freeze({ key: 'class_gradebook_period_activity_count', label: 'Class Gradebook Period Activities', description: 'Gradebook + quiz + in-session assignment columns in that period.' }),
    Object.freeze({ key: 'class_gradebook_period_avg_percent', label: 'Class Gradebook Period Avg %', description: 'Mean percentage over all scored, non-absent cells marked include-in-grade.' }),
    Object.freeze({ key: 'class_gradebook_period_points_earned', label: 'Class Gradebook Period Points Earned', description: 'Sum of raw scores (non-absent, numeric) for counted activities.' }),
    Object.freeze({ key: 'class_gradebook_period_points_possible', label: 'Class Gradebook Period Points Possible', description: 'Sum of max points for those cells.' })
  ]),
  examPeriodClass: Object.freeze([
    Object.freeze({ key: 'class_exam_period_assignment_count', label: 'Class Exam Period Assignments', description: 'Exam assignments for this class with window overlapping report period.' }),
    Object.freeze({ key: 'class_exam_period_graded_count', label: 'Class Exam Period Graded', description: 'Graded assignments in that set.' }),
    Object.freeze({ key: 'class_exam_period_submitted_count', label: 'Class Exam Period Submitted', description: 'Submitted, auto-submitted, or graded in that set.' }),
    Object.freeze({ key: 'class_exam_period_avg_percent', label: 'Class Exam Period Avg %', description: 'Average percentageComputed for submitted/auto-submitted/graded rows (numeric).' })
  ]),
  studentOnly: Object.freeze([
    Object.freeze({ key: 'student_id', label: 'Student ID', description: 'Student person id for student-target reports.' }),
    Object.freeze({ key: 'student_record_id', label: 'Student Record ID', description: 'Student record id from school/student registry.' }),
    Object.freeze({ key: 'student_local_id', label: 'Student Local ID', description: 'Student local id in the organization/school.' }),
    Object.freeze({ key: 'student_org_id', label: 'Student Org ID', description: 'Organization id on the student registry record.' }),
    Object.freeze({ key: 'student_org_name', label: 'Student Org Name', description: 'Organization name on the student registry record.' }),
    Object.freeze({ key: 'student_org_member_role', label: 'Student Org Member Role', description: 'Role of the student in the organization membership list.' }),
    Object.freeze({ key: 'student_org_member_status', label: 'Student Org Member Status', description: 'Membership status of the student in the organization.' }),
    Object.freeze({ key: 'student_first_name', label: 'Student First Name', description: 'Student first name from person profile.' }),
    Object.freeze({ key: 'student_middle_name', label: 'Student Middle Name', description: 'Student middle name from person profile.' }),
    Object.freeze({ key: 'student_last_name', label: 'Student Last Name', description: 'Student last name from person profile.' }),
    Object.freeze({ key: 'student_full_name', label: 'Student Full Name', description: 'Student full name from person profile.' }),
    Object.freeze({ key: 'student_preferred_name', label: 'Student Preferred Name', description: 'Student preferred display name.' }),
    Object.freeze({ key: 'student_active', label: 'Student Active', description: 'Whether student person profile is active.' }),
    Object.freeze({ key: 'student_gender', label: 'Student Gender', description: 'Student gender from person profile.' }),
    Object.freeze({ key: 'student_date_of_birth', label: 'Student Date Of Birth', description: 'Student date of birth from person profile.' }),
    Object.freeze({ key: 'student_email', label: 'Student Email', description: 'Primary student email address.' }),
    Object.freeze({ key: 'student_phone', label: 'Student Phone', description: 'Primary student phone number.' }),
    Object.freeze({ key: 'student_avatar_url', label: 'Student Avatar URL', description: 'Avatar/profile image URL on person record.' }),
    Object.freeze({ key: 'student_person_notes', label: 'Student Person Notes', description: 'Notes from person profile.' }),
    Object.freeze({ key: 'student_address_line1', label: 'Student Address Line 1', description: 'Student address line 1.' }),
    Object.freeze({ key: 'student_address_line2', label: 'Student Address Line 2', description: 'Student address line 2.' }),
    Object.freeze({ key: 'student_city', label: 'Student City', description: 'Student city.' }),
    Object.freeze({ key: 'student_province', label: 'Student Province', description: 'Student province/state.' }),
    Object.freeze({ key: 'student_postal_code', label: 'Student Postal Code', description: 'Student postal/zip code.' }),
    Object.freeze({ key: 'student_country', label: 'Student Country', description: 'Student country.' }),
    Object.freeze({ key: 'student_enrollment_date', label: 'Student Enrollment Date', description: 'Enrollment date from student registry.' }),
    Object.freeze({ key: 'student_country_of_origin', label: 'Student Country Of Origin', description: 'Student country of origin from school registry.' }),
    Object.freeze({ key: 'student_fee_category', label: 'Student Fee Category', description: 'Student fee category from school registry.' }),
    Object.freeze({ key: 'student_academic_status', label: 'Student Academic Status', description: 'Student academic status from school registry.' }),
    Object.freeze({ key: 'student_sending_organization', label: 'Student Sending Organization', description: 'Sending organization from student registry.' }),
    Object.freeze({ key: 'student_funder_organization', label: 'Student Funder Organization', description: 'Funder organization from student registry.' }),
    Object.freeze({ key: 'student_funder_account_id', label: 'Student Funder Account ID', description: 'Funder account id from student registry.' }),
    Object.freeze({ key: 'student_student_account_id', label: 'Student Account ID', description: 'Student account id from student registry.' }),
    Object.freeze({ key: 'student_id_at_funder', label: 'Student ID At Funder', description: 'Student id at funder from student registry.' }),
    Object.freeze({ key: 'student_self_fund', label: 'Student Self Fund', description: 'Whether student is self funded.' }),
    Object.freeze({ key: 'student_funder_note', label: 'Student Funder Note', description: 'Funder note from student registry.' }),
    Object.freeze({ key: 'student_record_notes', label: 'Student Record Notes', description: 'Notes from student registry record.' }),
    Object.freeze({ key: 'student_attendance_total_sessions', label: 'Student Attendance Total Sessions', description: 'Total tracked sessions for this student.' }),
    Object.freeze({ key: 'student_attendance_present', label: 'Student Attendance Present', description: 'Count of present sessions for this student.' }),
    Object.freeze({ key: 'student_attendance_late', label: 'Student Attendance Late', description: 'Count of late sessions for this student.' }),
    Object.freeze({ key: 'student_attendance_excused', label: 'Student Attendance Excused', description: 'Count of excused sessions for this student.' }),
    Object.freeze({ key: 'student_attendance_absent', label: 'Student Attendance Absent', description: 'Count of absent sessions for this student.' }),
    Object.freeze({ key: 'student_attendance_percent', label: 'Student Attendance Percent', description: 'Computed attendance percentage.' }),
    Object.freeze({ key: 'student_late_minutes', label: 'Student Late Minutes', description: 'Accumulated late minutes for this student.' }),
    Object.freeze({ key: 'student_early_leave_minutes', label: 'Student Early Leave Minutes', description: 'Accumulated early-leave minutes for this student.' }),
    Object.freeze({ key: 'student_attendance_span_total_sessions', label: 'Student Attendance Span Total Sessions', description: 'Total sessions for this student within report period.' }),
    Object.freeze({ key: 'student_attendance_span_present', label: 'Student Attendance Span Present', description: 'Present count for this student within report period.' }),
    Object.freeze({ key: 'student_attendance_span_late', label: 'Student Attendance Span Late', description: 'Late count for this student within report period.' }),
    Object.freeze({ key: 'student_attendance_span_excused', label: 'Student Attendance Span Excused', description: 'Excused count for this student within report period.' }),
    Object.freeze({ key: 'student_attendance_span_absent', label: 'Student Attendance Span Absent', description: 'Absent count for this student within report period.' }),
    Object.freeze({ key: 'student_attendance_span_percent', label: 'Student Attendance Span Percent', description: 'Attendance percentage for this student within report period.' }),
    Object.freeze({ key: 'student_attendance_span_late_minutes', label: 'Student Attendance Span Late Minutes', description: 'Late minutes for this student within report period.' }),
    Object.freeze({ key: 'student_attendance_span_early_leave_minutes', label: 'Student Attendance Span Early Leave Minutes', description: 'Early-leave minutes for this student within report period.' }),
    Object.freeze({ key: 'student_punctuality_span_attended_sessions', label: 'Student Punctuality Span Attended Sessions', description: 'Attended sessions used for punctuality within report period.' }),
    Object.freeze({ key: 'student_punctuality_span_on_time_sessions', label: 'Student Punctuality Span On-Time Sessions', description: 'Attended sessions with no late arrival and no left-early minutes within report period.' }),
    Object.freeze({ key: 'student_punctuality_span_late_sessions', label: 'Student Punctuality Span Late Sessions', description: 'Attended sessions with late-arrival minutes within report period.' }),
    Object.freeze({ key: 'student_punctuality_span_left_early_sessions', label: 'Student Punctuality Span Left-Early Sessions', description: 'Attended sessions with left-early minutes within report period.' }),
    Object.freeze({ key: 'student_punctuality_span_late_minutes', label: 'Student Punctuality Span Late Minutes', description: 'Total late-arrival minutes across attended sessions within report period.' }),
    Object.freeze({ key: 'student_punctuality_span_left_early_minutes', label: 'Student Punctuality Span Left-Early Minutes', description: 'Total left-early minutes across attended sessions within report period.' }),
    Object.freeze({ key: 'student_punctuality_span_total_issue_sessions', label: 'Student Punctuality Span Total Issue Sessions', description: 'Attended sessions with either late-arrival or left-early minutes within report period.' }),
    Object.freeze({ key: 'student_punctuality_span_percent', label: 'Student Punctuality Span Percent', description: 'On-time percentage across attended sessions within report period.' }),
    Object.freeze({ key: 'student_punctuality_span_label', label: 'Student Punctuality Span Label', description: 'Readable punctuality label for the report period.' }),
    Object.freeze({ key: 'student_session_rating_span_rated_sessions', label: 'Student Session Rating Span Rated Sessions', description: 'Attended sessions used for session rating averages within report period.' }),
    Object.freeze({ key: 'student_session_rating_span_class_effort_percent', label: 'Student Session Rating Span Class Effort %', description: 'Average class effort rating across attended sessions within report period.' }),
    Object.freeze({ key: 'student_session_rating_span_class_participation_percent', label: 'Student Session Rating Span Class Participation %', description: 'Average class participation rating across attended sessions within report period.' }),
    Object.freeze({ key: 'student_session_rating_span_respects_teachers_percent', label: 'Student Session Rating Span Respects The Teachers %', description: 'Average respects-the-teachers rating across attended sessions within report period.' }),
    Object.freeze({ key: 'student_session_rating_span_respects_students_percent', label: 'Student Session Rating Span Treats Other Students With Respect %', description: 'Average treats-other-students-with-respect rating across attended sessions within report period.' })
  ]),
  gradebookPeriodStudent: Object.freeze([
    Object.freeze({ key: 'student_gradebook_period_activity_count', label: 'Student Gradebook Period Activities', description: 'Include-in-grade activities in period where student not absent and has a score.' }),
    Object.freeze({ key: 'student_gradebook_period_avg_percent', label: 'Student Gradebook Period Avg %', description: 'Average percent on those activities.' }),
    Object.freeze({ key: 'student_gradebook_period_points_earned', label: 'Student Gradebook Period Points Earned', description: 'Sum of raw scores.' }),
    Object.freeze({ key: 'student_gradebook_period_points_possible', label: 'Student Gradebook Period Points Possible', description: 'Sum of activity totals.' })
  ]),
  examPeriodStudent: Object.freeze([
    Object.freeze({ key: 'student_exam_period_assignment_count', label: 'Student Exam Period Assignments', description: 'This student’s exam rows overlapping report period.' }),
    Object.freeze({ key: 'student_exam_period_graded_count', label: 'Student Exam Period Graded', description: 'Graded count in period.' }),
    Object.freeze({ key: 'student_exam_period_avg_percent', label: 'Student Exam Period Avg %', description: 'Average percentage (submitted, auto-submitted, or graded).' }),
    Object.freeze({ key: 'student_exam_period_total_score', label: 'Student Exam Period Total Score', description: 'Sum of scoreComputed.' }),
    Object.freeze({ key: 'student_exam_period_total_max_score', label: 'Student Exam Period Total Max Score', description: 'Sum of maxScoreComputed.' })
  ])
});

function toDateOnly(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseDateOnlyToUtcDay(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return NaN;
  return Date.parse(`${raw}T00:00:00.000Z`);
}

function normalizeDateRange(startDate, dueDate) {
  const startClean = String(startDate || '').trim();
  const dueClean = String(dueDate || '').trim();
  const startTs = parseDateOnlyToUtcDay(startClean);
  const dueTs = parseDateOnlyToUtcDay(dueClean);

  if (!Number.isFinite(startTs) && !Number.isFinite(dueTs)) {
    return { startDate: '', dueDate: '' };
  }
  if (!Number.isFinite(startTs)) {
    return { startDate: dueClean, dueDate: dueClean };
  }
  if (!Number.isFinite(dueTs)) {
    return { startDate: startClean, dueDate: startClean };
  }
  if (startTs <= dueTs) return { startDate: startClean, dueDate: dueClean };
  return { startDate: dueClean, dueDate: startClean };
}

function getRangeDaysInclusive(startDate, dueDate) {
  const startTs = parseDateOnlyToUtcDay(startDate);
  const dueTs = parseDateOnlyToUtcDay(dueDate);
  if (!Number.isFinite(startTs) || !Number.isFinite(dueTs)) return 0;
  return Math.floor((dueTs - startTs) / 86400000) + 1;
}

function filterSessionsByDateRange(sessions, startDate, dueDate) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const startTs = parseDateOnlyToUtcDay(startDate);
  const dueTs = parseDateOnlyToUtcDay(dueDate);
  if (!Number.isFinite(startTs) || !Number.isFinite(dueTs)) return rows;
  return rows.filter((session) => {
    const dateTs = parseDateOnlyToUtcDay(session?.date);
    if (!Number.isFinite(dateTs)) return false;
    return dateTs >= startTs && dateTs <= dueTs;
  });
}

function buildClassAttendanceSummary(session) {
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  const summary = {
    total: roster.length,
    present: 0,
    late: 0,
    excused: 0,
    absent: 0
  };

  roster.forEach((row) => {
    const status = String(row?.attendance || '').toLowerCase();
    if (status === 'present') summary.present += 1;
    else if (status === 'late') summary.late += 1;
    else if (status === 'excused') summary.excused += 1;
    else summary.absent += 1;
  });

  return summary;
}

async function buildStudentAttendanceSummary(sessions, studentId, statusMap = null, options = {}) {
  const out = {
    totalSessions: 0,
    present: 0,
    late: 0,
    excused: 0,
    absent: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0
  };

  const target = toPublicId(studentId);
  if (!target) return out;
  const effectiveStatusMap = statusMap instanceof Map ? statusMap : new Map();
  const countMissingAsAbsent = options?.countMissingAsAbsent === true;
  const classData = options?.classData && typeof options.classData === 'object' ? options.classData : {};
  const orgPolicyLayer = options?.orgPolicyLayer && typeof options.orgPolicyLayer === 'object' ? options.orgPolicyLayer : {};
  const matrixPolicy = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayer);
  const matrixRecords = [];

  sessions.forEach((session) => {
    if (sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(effectiveStatusMap, {
      status: session?.status,
      notes: session?.notes
    })) return;
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    const row = roster.find((item) => idsEqual(item?.personId, target));
    if (!row) {
      if (countMissingAsAbsent) {
        out.totalSessions += 1;
        out.absent += 1;
        matrixRecords.push({
          status: 'absent',
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          scheduledMinutes: attendanceMatrixMetricsService.scheduledMinutesFromSession(session, matrixPolicy.scheduledMinutes)
        });
      }
      return;
    }
    out.totalSessions += 1;

    const status = String(row?.attendance || '').toLowerCase();
    if (status === 'present') out.present += 1;
    else if (status === 'late') out.late += 1;
    else if (status === 'excused') out.excused += 1;
    else out.absent += 1;

    out.lateMinutes += normalizeNumber(row?.lateMinutes);
    out.earlyLeaveMinutes += normalizeNumber(row?.earlyLeaveMinutes);
    matrixRecords.push({
      status,
      lateMinutes: row?.lateMinutes || 0,
      earlyLeaveMinutes: row?.earlyLeaveMinutes || 0,
      scheduledMinutes: attendanceMatrixMetricsService.scheduledMinutesFromSession(session, matrixPolicy.scheduledMinutes)
    });
  });

  const matrixSummary = attendanceMatrixMetricsService.computeStudentMatrixSummary(matrixRecords, classData, orgPolicyLayer);
  out.attendancePercent = Number.isFinite(Number(matrixSummary.performancePercent))
    ? Number(matrixSummary.performancePercent)
    : (out.totalSessions > 0
    ? Number((((out.present + out.late + out.excused) / out.totalSessions) * 100).toFixed(2))
    : 0);
  out.matrixDisqualifiedSessionCount = Number(matrixSummary.disqualifiedSessionCount || 0);

  return out;
}

function getPunctualityLabel(percent, attendedSessions) {
  if (!Number.isFinite(Number(attendedSessions)) || Number(attendedSessions) <= 0) return 'Not available';
  const p = Number(percent);
  if (!Number.isFinite(p)) return 'Not available';
  if (p >= 95) return 'Excellent punctuality';
  if (p >= 85) return 'Good punctuality';
  if (p >= 70) return 'Needs attention';
  return 'Punctuality concern';
}

function buildStudentPunctualitySummary(sessions, studentId, statusMap = null, options = {}) {
  const out = {
    attendedSessions: 0,
    onTimeSessions: 0,
    lateSessions: 0,
    leftEarlySessions: 0,
    lateMinutes: 0,
    leftEarlyMinutes: 0,
    totalIssueSessions: 0,
    punctualityPercent: 'N/A',
    punctualityLabel: 'Not available'
  };

  const target = toPublicId(studentId);
  if (!target) return out;
  const effectiveStatusMap = statusMap instanceof Map ? statusMap : new Map();
  const classData = options?.classData && typeof options.classData === 'object' ? options.classData : {};
  const orgPolicyLayer = options?.orgPolicyLayer && typeof options.orgPolicyLayer === 'object' ? options.orgPolicyLayer : {};
  const matrixPolicy = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayer);

  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(effectiveStatusMap, {
      status: session?.status,
      notes: session?.notes
    })) return;
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    const row = roster.find((item) => idsEqual(item?.personId, target));
    if (!row) return;

    const normalized = attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules(row, matrixPolicy);
    const status = String(normalized?.attendance || '').trim().toLowerCase();
    if (status !== 'present' && status !== 'late' && status !== 'excused') return;

    const late = Math.max(0, normalizeNumber(normalized?.lateMinutes));
    const leftEarly = Math.max(0, normalizeNumber(normalized?.earlyLeaveMinutes));
    out.attendedSessions += 1;
    out.lateMinutes += late;
    out.leftEarlyMinutes += leftEarly;
    if (late > 0) out.lateSessions += 1;
    if (leftEarly > 0) out.leftEarlySessions += 1;
    if (late > 0 || leftEarly > 0) out.totalIssueSessions += 1;
    if (late <= 0 && leftEarly <= 0) out.onTimeSessions += 1;
  });

  if (out.attendedSessions > 0) {
    out.punctualityPercent = Number(((out.onTimeSessions / out.attendedSessions) * 100).toFixed(2));
  }
  out.punctualityLabel = getPunctualityLabel(out.punctualityPercent, out.attendedSessions);
  return out;
}

function normalizeSessionRatingPercent(value, fallback = 100) {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber) ? fallbackNumber : 100;
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(safeFallback * 100) / 100));
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

function averageSessionRating(values) {
  const rows = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!rows.length) return 'N/A';
  return Number((rows.reduce((sum, value) => sum + value, 0) / rows.length).toFixed(2));
}

function buildStudentSessionRatingSummary(sessions, studentId, statusMap = null, options = {}) {
  const ratings = {
    classEffort: [],
    classParticipation: [],
    respectsTeachers: [],
    respectsStudents: []
  };

  const target = toPublicId(studentId);
  if (!target) {
    return {
      ratedSessions: 0,
      classEffortPercent: 'N/A',
      classParticipationPercent: 'N/A',
      respectsTeachersPercent: 'N/A',
      respectsStudentsPercent: 'N/A'
    };
  }

  const effectiveStatusMap = statusMap instanceof Map ? statusMap : new Map();
  const classData = options?.classData && typeof options.classData === 'object' ? options.classData : {};
  const orgPolicyLayer = options?.orgPolicyLayer && typeof options.orgPolicyLayer === 'object' ? options.orgPolicyLayer : {};
  const matrixPolicy = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayer);

  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(effectiveStatusMap, {
      status: session?.status,
      notes: session?.notes
    })) return;
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    const row = roster.find((item) => idsEqual(item?.personId, target));
    if (!row) return;

    const normalized = attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules(row, matrixPolicy);
    const status = String(normalized?.attendance || '').trim().toLowerCase();
    if (status !== 'present' && status !== 'late' && status !== 'excused') return;

    ratings.classEffort.push(normalizeSessionRatingPercent(row?.classEffortPercent));
    ratings.classParticipation.push(normalizeSessionRatingPercent(row?.classParticipationPercent));
    ratings.respectsTeachers.push(normalizeSessionRatingPercent(row?.respectsTeachersPercent));
    ratings.respectsStudents.push(normalizeSessionRatingPercent(row?.respectsStudentsPercent));
  });

  return {
    ratedSessions: ratings.classEffort.length,
    classEffortPercent: averageSessionRating(ratings.classEffort),
    classParticipationPercent: averageSessionRating(ratings.classParticipation),
    respectsTeachersPercent: averageSessionRating(ratings.respectsTeachers),
    respectsStudentsPercent: averageSessionRating(ratings.respectsStudents)
  };
}

function toPrintableValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function isVisualOnlyField(field) {
  const type = String(field?.type || '').trim().toLowerCase();
  return type === 'section' || type === 'subheader' || type === 'row_break';
}

async function buildClassAttendanceSpanSummary(sessions, statusMap = null) {
  const out = {
    sessionCount: 0,
    uniqueStudents: 0,
    total: 0,
    present: 0,
    late: 0,
    excused: 0,
    absent: 0,
    attendancePercent: 0
  };
  const uniqueStudents = new Set();
  const effectiveStatusMap = statusMap instanceof Map ? statusMap : new Map();

  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(effectiveStatusMap, {
      status: session?.status,
      notes: session?.notes
    })) return;
    out.sessionCount += 1;
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    roster.forEach((row) => {
      const personId = String(row?.personId || '').trim();
      if (personId) uniqueStudents.add(personId);
      out.total += 1;
      const status = String(row?.attendance || '').toLowerCase();
      if (status === 'present') out.present += 1;
      else if (status === 'late') out.late += 1;
      else if (status === 'excused') out.excused += 1;
      else out.absent += 1;
    });
  });

  out.uniqueStudents = uniqueStudents.size;
  out.attendancePercent = out.total > 0
    ? Number((((out.present + out.late + out.excused) / out.total) * 100).toFixed(2))
    : 0;
  return out;
}

function filterPeriodSessionsForGradeMetrics(sessions, startDate, dueDate, statusMap) {
  const rangeFiltered = filterSessionsByDateRange(sessions, startDate, dueDate);
  const effectiveMap = statusMap instanceof Map ? statusMap : new Map();
  return rangeFiltered.filter((sessionRow) => !sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(effectiveMap, {
    status: sessionRow?.status,
    notes: sessionRow?.notes
  }));
}

function utcIsoToDateOnly(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function ymdRangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && aEnd >= bStart;
}

function getScoreFromScoresMap(scores, personId) {
  if (!scores || typeof scores !== 'object') return null;
  const pid = String(personId);
  let v = scores[pid];
  if (v === undefined) v = scores[personId];
  if (v === '' || v === undefined) return null;
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rosterAttendanceLower(session, personId) {
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  const row = roster.find((item) => idsEqual(item?.personId, personId));
  return String(row?.attendance || 'absent').trim().toLowerCase();
}

function collectPeriodGradeColumns(periodSessions) {
  const cols = [];
  (Array.isArray(periodSessions) ? periodSessions : []).forEach((ses) => {
    (Array.isArray(ses.gradebooks) ? ses.gradebooks : []).forEach((gb) => {
      cols.push({
        session: ses,
        totalScore: Number(gb?.totalScore) || 0,
        includeInCalc: gb?.includeInGradeCalculation !== false,
        scores: gb?.scores
      });
    });
    (Array.isArray(ses.quizzes) ? ses.quizzes : []).forEach((q, idx) => {
      cols.push({
        session: ses,
        totalScore: Number(q?.totalScore) || 0,
        includeInCalc: q?.includeInGradeCalculation !== false,
        scores: q?.scores
      });
    });
    (Array.isArray(ses.assignments) ? ses.assignments : []).forEach((a, idx) => {
      cols.push({
        session: ses,
        totalScore: Number(a?.totalScore) || 0,
        includeInCalc: a?.includeInGradeCalculation !== false,
        scores: a?.scores
      });
    });
  });
  return cols;
}

function averageRounded(arr) {
  if (!arr.length) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

function computeReportPeriodGradebookStats(periodSessions, studentPersonId) {
  const cols = collectPeriodGradeColumns(periodSessions);
  const classPercents = [];
  let classEarned = 0;
  let classPossible = 0;
  const studentPercents = [];
  let studentEarned = 0;
  let studentPossible = 0;
  let studentActivitySlots = 0;
  const targetStudent = toPublicId(studentPersonId);

  cols.forEach((col) => {
    const ses = col.session;
    const roster = Array.isArray(ses?.roster) ? ses.roster : [];
    roster.forEach((r) => {
      const pid = toPublicId(r?.personId);
      if (!pid) return;
      const att = rosterAttendanceLower(ses, pid);
      const absent = att === 'absent';
      const raw = absent ? null : getScoreFromScoresMap(col.scores, pid);
      const total = col.totalScore > 0 ? col.totalScore : 0;
      let pct = null;
      if (!absent && raw != null && total > 0) {
        pct = Math.round((raw / total) * 1000) / 10;
      }
      if (col.includeInCalc && !absent && raw != null && total > 0) {
        classPercents.push(pct);
        classEarned += raw;
        classPossible += total;
      }
      if (targetStudent && idsEqual(pid, targetStudent)) {
        if (col.includeInCalc && !absent && raw != null && total > 0) {
          studentActivitySlots += 1;
          studentPercents.push(pct);
          studentEarned += raw;
          studentPossible += total;
        }
      }
    });
  });

  return {
    class_gradebook_period_sessions_count: Array.isArray(periodSessions) ? periodSessions.length : 0,
    class_gradebook_period_activity_count: cols.length,
    class_gradebook_period_avg_percent: averageRounded(classPercents),
    class_gradebook_period_points_earned: Math.round(classEarned * 100) / 100,
    class_gradebook_period_points_possible: Math.round(classPossible * 100) / 100,
    student_gradebook_period_activity_count: studentActivitySlots,
    student_gradebook_period_avg_percent: averageRounded(studentPercents),
    student_gradebook_period_points_earned: Math.round(studentEarned * 100) / 100,
    student_gradebook_period_points_possible: Math.round(studentPossible * 100) / 100
  };
}

function computeReportPeriodExamStats(examRows, classOrgId, periodStart, periodEnd, studentRecordId) {
  const pStart = String(periodStart || '').trim();
  const pEnd = String(periodEnd || '').trim();
  const orgOk = (row) => !classOrgId || idsEqual(row?.orgId, classOrgId);
  const inPeriod = (row) => {
    const wStart = utcIsoToDateOnly(row?.startWindowUtc);
    const wEnd = utcIsoToDateOnly(row?.endWindowUtc);
    return ymdRangesOverlap(wStart, wEnd, pStart, pEnd);
  };
  const notCancelled = (row) => !['cancelled', 'archived'].includes(String(row?.status || '').trim().toLowerCase());

  const classFiltered = (Array.isArray(examRows) ? examRows : []).filter((row) => orgOk(row) && notCancelled(row) && inPeriod(row));
  const studentFiltered = studentRecordId
    ? classFiltered.filter((row) => idsEqual(row?.studentId, studentRecordId))
    : [];

  const classPercents = [];
  let classGraded = 0;
  let classSubmitted = 0;
  const submittedLike = (st) => st === 'submitted' || st === 'graded' || st === 'auto_submitted';
  const scoredLike = (st) => st === 'graded' || st === 'auto_submitted' || st === 'submitted';

  classFiltered.forEach((row) => {
    const st = String(row?.status || '').trim().toLowerCase();
    if (st === 'graded') classGraded += 1;
    if (submittedLike(st)) {
      classSubmitted += 1;
      const p = Number(row?.percentageComputed);
      if (Number.isFinite(p)) classPercents.push(p);
    }
  });

  const studentPercents = [];
  let studentGraded = 0;
  let scoreSum = 0;
  let maxSum = 0;
  studentFiltered.forEach((row) => {
    const st = String(row?.status || '').trim().toLowerCase();
    if (st === 'graded') studentGraded += 1;
    if (submittedLike(st)) {
      const p = Number(row?.percentageComputed);
      if (Number.isFinite(p)) studentPercents.push(p);
    }
    if (scoredLike(st)) {
      const sc = Number(row?.scoreComputed);
      const mx = Number(row?.maxScoreComputed);
      if (Number.isFinite(sc)) scoreSum += sc;
      if (Number.isFinite(mx)) maxSum += mx;
    }
  });

  return {
    class_exam_period_assignment_count: classFiltered.length,
    class_exam_period_graded_count: classGraded,
    class_exam_period_submitted_count: classSubmitted,
    class_exam_period_avg_percent: averageRounded(classPercents),
    student_exam_period_assignment_count: studentFiltered.length,
    student_exam_period_graded_count: studentGraded,
    student_exam_period_avg_percent: averageRounded(studentPercents),
    student_exam_period_total_score: Math.round(scoreSum * 100) / 100,
    student_exam_period_total_max_score: Math.round(maxSum * 100) / 100
  };
}

function getPreferredOrgName(org) {
  if (!org || typeof org !== 'object') return '';
  return String(org?.identity?.displayName || org?.name || org?.identity?.legalName || org?.id || '').trim();
}

function getPrimaryEmailFromPerson(person) {
  if (!person || typeof person !== 'object') return '';
  if (person?.contact?.email) return String(person.contact.email).trim();
  const emails = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
  const primary = emails.find((item) => item?.isPrimary && item?.email);
  const first = primary || emails[0];
  return String(first?.email || '').trim();
}

function getPrimaryPhoneFromPerson(person) {
  const phones = Array.isArray(person?.contact?.phones) ? person.contact.phones : [];
  return String(phones[0]?.number || '').trim();
}

function getAddressFromPerson(person) {
  const fromSingle = person?.address && typeof person.address === 'object' ? person.address : null;
  if (fromSingle) return fromSingle;
  const fromArray = Array.isArray(person?.addresses) && person.addresses.length ? person.addresses[0] : null;
  return fromArray && typeof fromArray === 'object' ? fromArray : {};
}

function findOrgMembership(person, orgId) {
  const memberships = Array.isArray(person?.organizations) ? person.organizations : [];
  const target = toPublicId(orgId);
  if (!target) return null;
  return memberships.find((row) => idsEqual(row?.orgId, target)) || null;
}

function resolveReportPeriod(assignment, session) {
  const explicitStart = String(assignment?.reportStartDate || '').trim();
  const explicitDue = String(assignment?.reportDueDate || '').trim();
  const fallbackStart = String(assignment?.sessionDate || session?.date || assignment?.dueDate || '').trim();
  const fallbackDue = String(assignment?.dueDate || assignment?.sessionDate || session?.date || '').trim();
  return normalizeDateRange(explicitStart || fallbackStart, explicitDue || fallbackDue);
}

async function buildPrefillSnapshot({ assignment, teacherId = '', studentId = '', reqUser }) {
  const classIdForQuery = toPublicId(assignment.classId);
  const [classData, sessions, students, persons, organizations, examAssignmentsForClass] = await Promise.all([
    schoolDataService.getDataById('classes', assignment.classId, reqUser),
    schoolDataService.getClassSessions(assignment.classId, reqUser),
    schoolDataService.fetchData('students', {}, reqUser),
    dataServiceGlobal.fetchData('persons', {}, reqUser, PERSON_QUERY_OPTIONS),
    dataServiceGlobal.fetchData('organizations', {}, reqUser),
    classIdForQuery
      ? schoolDataService.fetchData('examAssignments', { classId__eq: classIdForQuery }, reqUser)
      : Promise.resolve([])
  ]);
  const session = sessions.find((row) => idsEqual(row.sessionId, assignment.sessionId)) ||
    sessions.find((row) => String(row.date || '') === String(assignment.sessionDate || '')) ||
    null;

  const personMap = new Map();
  persons.forEach((person) => {
    const id = toPublicId(person?.id);
    if (!id) return;
    const fullName = `${person?.name?.first || ''} ${person?.name?.last || ''}`.trim();
    const preferred = String(person?.name?.preferred || '').trim();
    personMap.set(id, preferred || fullName || id);
  });
  const resolvedTeacherId = toPublicId(teacherId || session?.delivery?.deliveredBy || assignment?.teacherIds?.[0]);
  const resolvedTeacherName = personMap.get(resolvedTeacherId) || resolvedTeacherId || '';

  const reportPeriod = resolveReportPeriod(assignment, session);
  const studentPersonId = toPublicId(studentId);
  const studentRecord = students.find((row) => idsEqual(row?.personId, studentPersonId)) || null;
  const studentPerson = persons.find((row) => idsEqual(row?.id, studentPersonId)) || null;
  const reportOrgId = toPublicId(classData?.orgId || assignment?.orgId || studentRecord?.orgId);
  const statusMap = await sessionStatusPolicyService.getStatusMap(reportOrgId || reqUser?.activeOrgId || '', { includeInactive: true });
  const orgPolicyLayer = await attendanceMatrixPolicyModel.getPolicyForOrg(reportOrgId || reqUser?.activeOrgId || '');
  const classAttendance = buildClassAttendanceSummary(session);
  const studentAttendance = await buildStudentAttendanceSummary(sessions, studentId, statusMap, {
    classData,
    orgPolicyLayer
  });
  const periodSessions = filterSessionsByDateRange(sessions, reportPeriod.startDate, reportPeriod.dueDate);
  const periodSessionsGrade = filterPeriodSessionsForGradeMetrics(sessions, reportPeriod.startDate, reportPeriod.dueDate, statusMap);
  const gradebookPeriodStats = computeReportPeriodGradebookStats(periodSessionsGrade, studentPersonId);
  const examRows = Array.isArray(examAssignmentsForClass) ? examAssignmentsForClass : [];
  const examPeriodStats = computeReportPeriodExamStats(
    examRows,
    classData?.orgId,
    reportPeriod.startDate,
    reportPeriod.dueDate,
    studentRecord?.id
  );
  const classAttendanceSpan = await buildClassAttendanceSpanSummary(periodSessions, statusMap);
  const studentAttendanceSpan = await buildStudentAttendanceSummary(periodSessions, studentId, statusMap, {
    countMissingAsAbsent: true,
    classData,
    orgPolicyLayer
  });
  const studentPunctualitySpan = buildStudentPunctualitySummary(periodSessions, studentId, statusMap, {
    classData,
    orgPolicyLayer
  });
  const studentSessionRatingSpan = buildStudentSessionRatingSummary(periodSessions, studentId, statusMap, {
    classData,
    orgPolicyLayer
  });
  const primaryAttendance = studentPersonId
    ? {
        total: studentAttendanceSpan.totalSessions,
        present: studentAttendanceSpan.attendancePercent,
        late: studentAttendanceSpan.late,
        excused: studentAttendanceSpan.excused,
        absent: studentAttendanceSpan.absent
      }
    : classAttendance;
  const reportOrg = organizations.find((row) => idsEqual(row?.id, reportOrgId)) || null;
  const studentOrgId = toPublicId(studentRecord?.orgId || reportOrgId);
  const studentOrg = organizations.find((row) => idsEqual(row?.id, studentOrgId)) || null;
  const studentOrgMembership = findOrgMembership(studentPerson, studentOrgId);
  const studentAddress = getAddressFromPerson(studentPerson);
  const studentFullName = `${studentPerson?.name?.first || ''} ${studentPerson?.name?.last || ''}`.trim();

  const snapshot = {
    teacher_id: resolvedTeacherId,
    teacher_name: resolvedTeacherName,
    class_id: String(classData?.id || assignment.classId || ''),
    class_name: String(classData?.title || ''),
    report_org_id: reportOrgId,
    report_org_name: getPreferredOrgName(reportOrg),
    report_date: toDateOnly(new Date()),
    report_period_start_date: reportPeriod.startDate,
    report_period_due_date: reportPeriod.dueDate,
    report_period_days: getRangeDaysInclusive(reportPeriod.startDate, reportPeriod.dueDate),
    session_id: String(session?.sessionId || assignment.sessionId || ''),
    session_date: String(session?.date || assignment.sessionDate || ''),
    session_start_time: String(session?.startTime || ''),
    session_end_time: String(session?.endTime || ''),
    student_id: studentPersonId,
    student_record_id: String(studentRecord?.id || ''),
    student_local_id: String(studentRecord?.localId || ''),
    student_org_id: studentOrgId,
    student_org_name: getPreferredOrgName(studentOrg),
    student_first_name: String(studentPerson?.name?.first || ''),
    student_middle_name: String(studentPerson?.name?.middle || ''),
    student_last_name: String(studentPerson?.name?.last || ''),
    student_full_name: studentFullName,
    student_preferred_name: String(studentPerson?.name?.preferred || ''),
    student_active: studentPerson ? studentPerson?.active === true : '',
    student_gender: String(studentPerson?.demographics?.gender || ''),
    student_date_of_birth: String(studentPerson?.demographics?.dateOfBirth || ''),
    student_email: getPrimaryEmailFromPerson(studentPerson),
    student_phone: getPrimaryPhoneFromPerson(studentPerson),
    student_avatar_url: String(studentPerson?.avatarUrl || ''),
    student_person_notes: String(studentPerson?.notes || ''),
    student_address_line1: String(studentAddress?.line1 || ''),
    student_address_line2: String(studentAddress?.line2 || ''),
    student_city: String(studentAddress?.city || ''),
    student_province: String(studentAddress?.province || studentAddress?.state || ''),
    student_postal_code: String(studentAddress?.postalCode || studentAddress?.zipCode || ''),
    student_country: String(studentAddress?.country || ''),
    student_enrollment_date: String(studentRecord?.enrollmentDate || ''),
    student_country_of_origin: String(studentRecord?.countryOfOrigin || ''),
    student_fee_category: String(studentRecord?.feeCategory || ''),
    student_academic_status: String(studentRecord?.academicStatus || ''),
    student_sending_organization: String(studentRecord?.sendingOrganization || ''),
    student_funder_organization: String(studentRecord?.funderOrganization || ''),
    student_funder_account_id: String(studentRecord?.funderAccountId || ''),
    student_student_account_id: String(studentRecord?.studentAccountId || ''),
    student_id_at_funder: String(studentRecord?.studentIdAtFunder || ''),
    student_self_fund: studentRecord ? studentRecord?.selfFund === true : '',
    student_funder_note: String(studentRecord?.funderNote || ''),
    student_record_notes: String(studentRecord?.notes || ''),
    class_attendance_total: primaryAttendance.total,
    class_attendance_present: primaryAttendance.present,
    class_attendance_late: primaryAttendance.late,
    class_attendance_excused: primaryAttendance.excused,
    class_attendance_absent: primaryAttendance.absent,
    class_attendance_span_sessions: classAttendanceSpan.sessionCount,
    class_attendance_span_unique_students: classAttendanceSpan.uniqueStudents,
    class_attendance_span_total: classAttendanceSpan.total,
    class_attendance_span_present: classAttendanceSpan.present,
    class_attendance_span_late: classAttendanceSpan.late,
    class_attendance_span_excused: classAttendanceSpan.excused,
    class_attendance_span_absent: classAttendanceSpan.absent,
    class_attendance_span_percent: classAttendanceSpan.attendancePercent,
    student_attendance_total_sessions: studentAttendance.totalSessions,
    student_attendance_present: studentAttendance.present,
    student_attendance_late: studentAttendance.late,
    student_attendance_excused: studentAttendance.excused,
    student_attendance_absent: studentAttendance.absent,
    student_attendance_percent: studentAttendance.attendancePercent,
    student_late_minutes: studentAttendance.lateMinutes,
    student_early_leave_minutes: studentAttendance.earlyLeaveMinutes,
    student_attendance_span_total_sessions: studentAttendanceSpan.totalSessions,
    student_attendance_span_present: studentAttendanceSpan.present,
    student_attendance_span_late: studentAttendanceSpan.late,
    student_attendance_span_excused: studentAttendanceSpan.excused,
    student_attendance_span_absent: studentAttendanceSpan.absent,
    student_attendance_span_percent: studentAttendanceSpan.attendancePercent,
    student_attendance_span_late_minutes: studentAttendanceSpan.lateMinutes,
    student_attendance_span_early_leave_minutes: studentAttendanceSpan.earlyLeaveMinutes,
    student_punctuality_span_attended_sessions: studentPunctualitySpan.attendedSessions,
    student_punctuality_span_on_time_sessions: studentPunctualitySpan.onTimeSessions,
    student_punctuality_span_late_sessions: studentPunctualitySpan.lateSessions,
    student_punctuality_span_left_early_sessions: studentPunctualitySpan.leftEarlySessions,
    student_punctuality_span_late_minutes: studentPunctualitySpan.lateMinutes,
    student_punctuality_span_left_early_minutes: studentPunctualitySpan.leftEarlyMinutes,
    student_punctuality_span_total_issue_sessions: studentPunctualitySpan.totalIssueSessions,
    student_punctuality_span_percent: studentPunctualitySpan.punctualityPercent,
    student_punctuality_span_label: studentPunctualitySpan.punctualityLabel,
    student_session_rating_span_rated_sessions: studentSessionRatingSpan.ratedSessions,
    student_session_rating_span_class_effort_percent: studentSessionRatingSpan.classEffortPercent,
    student_session_rating_span_class_participation_percent: studentSessionRatingSpan.classParticipationPercent,
    student_session_rating_span_respects_teachers_percent: studentSessionRatingSpan.respectsTeachersPercent,
    student_session_rating_span_respects_students_percent: studentSessionRatingSpan.respectsStudentsPercent,
    student_org_member_role: String(studentOrgMembership?.role || ''),
    student_org_member_status: String(studentOrgMembership?.memberStatus || ''),
    ...gradebookPeriodStats,
    ...examPeriodStats
  };

  return snapshot;
}

function mergeTemplateData(template, instance, assignment = null) {
  const prefill = instance?.prefillSnapshot && typeof instance.prefillSnapshot === 'object' ? instance.prefillSnapshot : {};
  const answers = instance?.answers && typeof instance.answers === 'object' ? instance.answers : {};
  const sharedRaw = assignment?.sharedAnswers && typeof assignment.sharedAnswers === 'object' ? assignment.sharedAnswers : {};
  const eachStudent = String(assignment?.reportScope || '').trim().toLowerCase() === 'each_student';

  const merged = { ...prefill, ...answers };
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];

  fields.forEach((field) => {
    if (isVisualOnlyField(field) || !field?.id) {
      if (field?.id) delete merged[field.id];
      return;
    }
    if (field.readOnly === true) {
      const resolved = getPrefillValue(prefill, field.prefillKey);
      if (resolved.found) {
        merged[field.id] = resolved.value;
        return;
      }
    }
    const useShared = eachStudent && field.sharedAcrossStudents === true;
    if (useShared) {
      if (Object.prototype.hasOwnProperty.call(sharedRaw, field.id)) {
        merged[field.id] = sharedRaw[field.id];
        return;
      }
    } else {
      const answerValue = answers[field.id];
      const hasAnswer = answerValue !== undefined && answerValue !== null && String(answerValue) !== '';
      if (hasAnswer) {
        merged[field.id] = answerValue;
        return;
      }
    }
    const resolved = getPrefillValue(prefill, field.prefillKey);
    if (resolved.found) {
      merged[field.id] = resolved.value;
    }
  });

  const recalculated = reportRuleEngineService.recomputeCalculatedAnswers({
    template,
    mergedAnswers: merged,
    prefill
  });
  return recalculated.answers;
}

/**
 * Split full template answers for persistence: shared field values live on the assignment
 * when reportScope is each_student; otherwise all values stay on the instance.
 */
function partitionInstanceSave(template, assignment, fullAnswers) {
  const scope = String(assignment?.reportScope || '').trim().toLowerCase();
  const eachStudent = scope === 'each_student';
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const studentAnswers = {};
  const sharedAnswers = {};

  fields.forEach((field) => {
    if (isVisualOnlyField(field) || !field?.id) return;
    const val = fullAnswers[field.id];
    if (eachStudent && field.sharedAcrossStudents === true) {
      sharedAnswers[field.id] = val;
    } else {
      studentAnswers[field.id] = val;
    }
  });

  return { studentAnswers, sharedAnswers };
}

function buildPlaceholderPayloadDetailed(template, instance, assignment = null) {
  const merged = mergeTemplateData(template, instance, assignment);
  const placeholderMap = template?.placeholderMap && typeof template.placeholderMap === 'object'
    ? template.placeholderMap
    : {};
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const fieldMap = new Map(fields.map((field) => [String(field?.id || ''), field]));
  const prefill = instance?.prefillSnapshot && typeof instance.prefillSnapshot === 'object'
    ? instance.prefillSnapshot
    : {};

  const out = {};
  const conversionDiagnostics = [];
  Object.keys(placeholderMap).forEach((fieldId) => {
    const token = String(placeholderMap[fieldId] || '').trim();
    if (!token) return;
    const field = fieldMap.get(String(fieldId || '').trim());
    const conversion = reportRuleEngineService.convertFieldValueForExport({
      field,
      value: merged[fieldId],
      answers: merged,
      prefill
    });
    out[token] = toPrintableValue(conversion.value);
    if (conversion.diagnostic) {
      conversionDiagnostics.push({
        ...conversion.diagnostic,
        token
      });
    }
  });
  return { placeholders: out, conversionDiagnostics };
}

function buildPlaceholderPayload(template, instance, assignment = null) {
  return buildPlaceholderPayloadDetailed(template, instance, assignment).placeholders;
}

function getPrefillCatalog() {
  return {
    common: [...PREFILL_CATALOG.common],
    classOnly: [...PREFILL_CATALOG.classOnly],
    gradebookPeriodClass: [...PREFILL_CATALOG.gradebookPeriodClass],
    examPeriodClass: [...PREFILL_CATALOG.examPeriodClass],
    studentOnly: [...PREFILL_CATALOG.studentOnly],
    gradebookPeriodStudent: [...PREFILL_CATALOG.gradebookPeriodStudent],
    examPeriodStudent: [...PREFILL_CATALOG.examPeriodStudent]
  };
}

/**
 * validateTemplatePrefillKeys - Validates all prefill keys in template fields against PREFILL_CATALOG whitelist.
 * 
 * PURPOSE: Prevent templates from referencing undefined/non-existent prefill keys.
 * Called at template save-time (reportController.saveTemplate) to catch errors immediately.
 * 
 * KEY FEATURES:
 * - Returns array of invalid field entries (empty array = all valid)
 * - Normalizes braced keys {{key}} before validation
 * - Skips visual-only fields (section, divider) which cannot have prefillKey
 * - Each invalid entry includes: fieldId, label, prefillKey (for user messaging)
 * 
 * @param {Object} templateOrSchema - Full template object or just schema object
 * @returns {Array} Array of {fieldId, label, prefillKey} for invalid keys; empty if all valid
 */
function validateTemplatePrefillKeys(templateOrSchema) {
  const schema = templateOrSchema?.schema && typeof templateOrSchema.schema === 'object'
    ? templateOrSchema.schema
    : templateOrSchema;
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const allowed = new Set(
    Object.values(getPrefillCatalog())
      .flat()
      .map((item) => item.key)
  );
  const invalid = [];

  fields.forEach((field) => {
    if (isVisualOnlyField(field)) return;
    const key = normalizePrefillKey(field?.prefillKey || '');
    if (!key) return;
    if (allowed.has(key)) return;
    invalid.push({
      fieldId: String(field?.id || ''),
      label: String(field?.label || field?.id || ''),
      prefillKey: String(field?.prefillKey || '')
    });
  });

  return invalid;
}

module.exports = {
  buildPrefillSnapshot,
  // Runs dependency-aware calculated fields on merged answers.
  recomputeCalculatedAnswers: reportRuleEngineService.recomputeCalculatedAnswers,
  mergeTemplateData,
  partitionInstanceSave,
  buildPlaceholderPayloadDetailed,
  buildPlaceholderPayload,
  getPrefillCatalog,
  validateTemplatePrefillKeys,
  normalizePrefillKey
};
