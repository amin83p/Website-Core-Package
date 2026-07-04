const SCHOOL_SETTINGS_DEFAULTS = Object.freeze({
  app: Object.freeze({
    schoolCanonicalEnrollmentRead: false,
    schoolCanonicalEnrollmentWrite: false,
    schoolIntentionalConflictMode: false,
    schoolReadModelsEnabled: false,
    enableRollingClassWorkflow: true,
    rollingWorkflowPilotOrgIds: '',
    rollingWorkflowPilotProgramIds: ''
  })
});

module.exports = {
  SCHOOL_SETTINGS_DEFAULTS,
  settingsDefaults: SCHOOL_SETTINGS_DEFAULTS
};
