const POLICIES = Object.freeze({
  studentProgramRegistrations: 'void',
  studentTermRegistrations: 'void',
  classEnrollmentPeriods: 'void',
  subjects: 'void',
  departments: 'void',
  terms: 'void',
  programs: 'void',
  classes: 'void',
  activities: 'void',
  classSessions: 'physical',
  activityWorkSessions: 'physical',
  reportInstances: 'physical',
  reportAssignments: 'physical',
  examAllocations: 'physical',
  examAssignments: 'physical',
  examAttempts: 'physical',
  examAnswers: 'physical'
});

function getDeletionPolicy(entityType) {
  return POLICIES[String(entityType || '').trim()] || 'physical';
}

function isVoidPolicy(entityType) {
  return getDeletionPolicy(entityType) === 'void';
}

module.exports = { POLICIES, getDeletionPolicy, isVoidPolicy };
