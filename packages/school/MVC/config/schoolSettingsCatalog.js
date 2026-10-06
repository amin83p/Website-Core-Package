'use strict';

const SCHOOL_SETTINGS_GROUPS = Object.freeze([
  Object.freeze({
    key: 'conduct-rating-scale',
    title: 'Conduct Rating Scale',
    description: 'Configure the qualitative labels and percentage ranges used by class conduct ratings.',
    icon: 'bi-emoji-smile',
    order: 10
  }),
  Object.freeze({
    key: 'attendance-matrix',
    title: 'Attendance Matrix Thresholds',
    description: 'Configure late and early-leave cutoffs for each scheduled session duration.',
    icon: 'bi-clock-history',
    order: 20
  }),
  Object.freeze({
    key: 'attendance-marks',
    title: 'Attendance Marks',
    description: 'Configure labels, icons, and colors for attendance matrix and report marks.',
    icon: 'bi-palette',
    order: 22
  }),
  Object.freeze({
    key: 'attendance-rollup',
    title: 'Attendance Rollup Formula',
    description: 'Configure how rollup % is calculated across matrix, reports, and exports.',
    icon: 'bi-percent',
    order: 25
  }),
  Object.freeze({
    key: 'autosave',
    title: 'Autosave',
    description: 'Configure default autosave intervals and per-section defaults for school pages.',
    icon: 'bi-arrow-repeat',
    order: 30
  }),
  Object.freeze({
    key: 'session-access',
    title: 'Session Access & Edit',
    description: 'Configure attendance edit windows after session completion and related session access options.',
    icon: 'bi-shield-lock',
    order: 35
  }),
  Object.freeze({
    key: 'enrollment-finish-alert',
    title: 'Enrollment Finish Alerts',
    description: 'Highlight rolling enrollments near expected finish on Manage Session attendance.',
    icon: 'bi-exclamation-circle',
    order: 36
  }),
  Object.freeze({
    key: 'student-attendance-report',
    title: 'Student Attendance Report',
    description: 'Choose report templates used for generated student attendance reports.',
    icon: 'bi-file-earmark-person',
    order: 40
  }),
  Object.freeze({
    key: 'school-semi-monthly-report',
    title: 'School Semi-Monthly Report',
    description: 'Choose which report templates appear on the School Semi-Monthly Report viewer.',
    icon: 'bi-calendar2-range',
    order: 41
  }),
  Object.freeze({
    key: 'timesheet-parameters',
    title: 'Timesheet Parameters',
    description: 'Configure how class sessions with no student enrollment appear on timesheets.',
    icon: 'bi-calendar2-week',
    order: 45
  }),
  Object.freeze({
    key: 'timesheet-import',
    title: 'Timesheet Import',
    description: 'Configure legacy Excel import activity and where import is allowed.',
    icon: 'bi-file-earmark-spreadsheet',
    order: 46
  }),
  Object.freeze({
    key: 'timesheet-display',
    title: 'Timesheet Display/Print',
    description: 'Configure how timesheet row descriptions appear in the editor and printouts.',
    icon: 'bi-layout-text-window-reverse',
    order: 46.5
  }),
  Object.freeze({
    key: 'duplicate-student-registrations',
    title: 'Duplicate Student Profiles',
    description: 'Find multiple student records linked to the same person in this organization.',
    icon: 'bi-people',
    order: 47
  }),
  Object.freeze({
    key: 'upload-limits',
    title: 'File Upload Limits',
    description: 'Configure maximum upload sizes for school library and other file workflows.',
    icon: 'bi-cloud-upload',
    order: 48
  }),
  Object.freeze({
    key: 'scheduling-time-policy',
    title: 'Scheduling Time Frames',
    description: 'Define standard daily time frames and earliest/latest class times for teacher availability.',
    icon: 'bi-clock',
    order: 49
  })
]);

function listSchoolSettingsGroups() {
  return SCHOOL_SETTINGS_GROUPS
    .map((row) => ({ ...row }))
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
}

module.exports = {
  SCHOOL_SETTINGS_GROUPS,
  listSchoolSettingsGroups
};
