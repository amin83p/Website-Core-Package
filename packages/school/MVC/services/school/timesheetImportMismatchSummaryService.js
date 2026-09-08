'use strict';

function normalizePersonNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTimesheetImportMismatchSummary(results = [], personName = '') {
  const rows = Array.isArray(results) ? results : [];
  const selectedNameKey = normalizePersonNameKey(personName);
  const issues = [];
  let blocking = false;

  rows.forEach((result) => {
    const fileName = String(result?.fileName || 'Unknown file').trim() || 'Unknown file';
    if (String(result?.status || '').toLowerCase() === 'error') {
      blocking = true;
      issues.push({
        fileName,
        type: 'compile_error',
        message: String(result?.error?.messages?.[0] || 'The file could not be compiled.'),
        blocking: true
      });
      return;
    }

    const matchStatus = String(result?.matchStatus || result?.matchedPeriod?.matchStatus || 'none').toLowerCase();
    const matchedPeriodId = String(result?.matchedPeriod?.id || '').trim();
    if (!matchedPeriodId || matchStatus === 'none') {
      blocking = true;
      issues.push({
        fileName,
        type: 'period_unmatched',
        message: 'No matching app timesheet period was found for this file.',
        blocking: true
      });
    } else if (matchStatus === 'partial') {
      issues.push({
        fileName,
        type: 'period_partial',
        message: String(result?.matchNote || 'Excel period dates do not exactly match the app period.'),
        blocking: false
      });
    }

    const employeeFromFile = String(result?.employeeNameFromFile || '').trim();
    if (
      employeeFromFile
      && selectedNameKey
      && normalizePersonNameKey(employeeFromFile) !== selectedNameKey
    ) {
      issues.push({
        fileName,
        type: 'name_mismatch',
        message: `Employee name in file (${employeeFromFile}) differs from selected teacher (${personName}).`,
        blocking: false
      });
    }
  });

  return {
    issues,
    blocking,
    hasWarnings: issues.some((issue) => !issue.blocking),
    hasIssues: issues.length > 0
  };
}

module.exports = {
  normalizePersonNameKey,
  buildTimesheetImportMismatchSummary
};
