// MVC/services/school/withdrawal/withdrawalPolicyService.js

const { WITHDRAWAL_REASONS, WITHDRAWAL_REASON_LABELS } = require('../../../../packages/school/MVC/models/school/withdrawalModel');

const REFUND_POLICIES = Object.freeze({
  FULL_REFUND: 'full_refund',
  PARTIAL_REFUND: 'partial_refund',
  PRORATED_REFUND: 'prorated_refund',
  NO_REFUND: 'no_refund',
  CREDIT_ONLY: 'credit_only'
});

const REFUND_POLICY_LABELS = Object.freeze({
  full_refund: 'Full Refund (100%)',
  partial_refund: 'Partial Refund',
  prorated_refund: 'Prorated Refund',
  no_refund: 'No Refund',
  credit_only: 'Credit to Account Only'
});

const GRADE_ASSIGNMENTS = Object.freeze({
  NONE: '',
  W: 'W',
  WF: 'WF',
  WP: 'WP',
  WN: 'WN'
});

const GRADE_LABELS = Object.freeze({
  '': 'No Grade (Before Census)',
  'W': 'W - Withdrawal',
  'WF': 'WF - Withdrawal Failing',
  'WP': 'WP - Withdrawal Passing',
  'WN': 'WN - Withdrawal Non-Punitive'
});

const CRITICAL_WITHDRAWAL_TERM_DATE_FIELDS = Object.freeze([
  'classesStartDate',
  'classesEndDate',
  'addDropDeadline',
  'withdrawWithoutPenaltyDeadline',
  'withdrawDeadline',
  'censusDate'
]);

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function getMissingCriticalDates(termRow) {
  if (!termRow || typeof termRow !== 'object') return [...CRITICAL_WITHDRAWAL_TERM_DATE_FIELDS];
  return CRITICAL_WITHDRAWAL_TERM_DATE_FIELDS.filter((field) => !String(termRow[field] || '').trim());
}

function calculateRefundPercentage(effectiveDate, termRow) {
  const today = effectiveDate || todayISO();
  const classesStartDate = termRow?.classesStartDate || '';
  const addDropDeadline = termRow?.addDropDeadline || '';
  const withdrawWithoutPenaltyDeadline = termRow?.withdrawWithoutPenaltyDeadline || '';
  const withdrawDeadline = termRow?.withdrawDeadline || '';
  const classesEndDate = termRow?.classesEndDate || '';

  if (classesStartDate && today < classesStartDate) {
    return { percentage: 100, policy: REFUND_POLICIES.FULL_REFUND, reason: 'Before classes start' };
  }

  if (addDropDeadline && today <= addDropDeadline) {
    return { percentage: 100, policy: REFUND_POLICIES.FULL_REFUND, reason: 'Within add/drop period' };
  }

  if (withdrawWithoutPenaltyDeadline && today <= withdrawWithoutPenaltyDeadline) {
    return { percentage: 80, policy: REFUND_POLICIES.PARTIAL_REFUND, reason: 'Before withdraw without penalty deadline' };
  }

  if (withdrawDeadline && today <= withdrawDeadline) {
    if (!classesStartDate || !classesEndDate) {
      return { percentage: 50, policy: REFUND_POLICIES.PARTIAL_REFUND, reason: 'Within withdrawal period (default 50%)' };
    }
    const start = parseDate(classesStartDate);
    const end = parseDate(classesEndDate);
    const current = parseDate(today);
    if (start && end && current) {
      const totalDays = Math.max(1, (end - start) / (1000 * 60 * 60 * 24));
      const elapsedDays = Math.max(0, (current - start) / (1000 * 60 * 60 * 24));
      const remainingPercent = Math.max(0, Math.min(100, Math.round((1 - elapsedDays / totalDays) * 100)));
      return { percentage: remainingPercent, policy: REFUND_POLICIES.PRORATED_REFUND, reason: `Prorated refund (${remainingPercent}% of term remaining)` };
    }
    return { percentage: 50, policy: REFUND_POLICIES.PRORATED_REFUND, reason: 'Within withdrawal period' };
  }

  if (withdrawDeadline && today > withdrawDeadline) {
    return { percentage: 0, policy: REFUND_POLICIES.NO_REFUND, reason: 'Past withdrawal deadline' };
  }

  return { percentage: 50, policy: REFUND_POLICIES.PARTIAL_REFUND, reason: 'Default policy (no deadlines configured)' };
}

function determineGradeAssignment(effectiveDate, termRow) {
  const today = effectiveDate || todayISO();
  const censusDate = termRow?.censusDate || '';
  const withdrawDeadline = termRow?.withdrawDeadline || '';
  const classesEndDate = termRow?.classesEndDate || '';

  if (censusDate && today < censusDate) {
    return { grade: GRADE_ASSIGNMENTS.NONE, appearsOnTranscript: false, reason: 'Before census date - no transcript record' };
  }

  if (withdrawDeadline && today <= withdrawDeadline) {
    return { grade: GRADE_ASSIGNMENTS.W, appearsOnTranscript: true, reason: 'Standard withdrawal grade' };
  }

  if (withdrawDeadline && today > withdrawDeadline) {
    return { grade: GRADE_ASSIGNMENTS.WF, appearsOnTranscript: true, reason: 'Late withdrawal - withdrawal failing' };
  }

  return { grade: GRADE_ASSIGNMENTS.W, appearsOnTranscript: true, reason: 'Default withdrawal grade' };
}

function calculateWithdrawalImpact({ type, termRow, originalAmount, effectiveDate }) {
  const refundCalc = calculateRefundPercentage(effectiveDate, termRow);
  const gradeCalc = determineGradeAssignment(effectiveDate, termRow);
  const missingCriticalDates = getMissingCriticalDates(termRow);
  
  const refundAmount = roundMoney((originalAmount || 0) * (refundCalc.percentage / 100));
  const penaltyAmount = roundMoney((originalAmount || 0) - refundAmount);

  return {
    financial: {
      refundPercentage: refundCalc.percentage,
      refundPolicy: refundCalc.policy,
      refundPolicyLabel: REFUND_POLICY_LABELS[refundCalc.policy] || refundCalc.policy,
      refundReason: refundCalc.reason,
      originalAmount: roundMoney(originalAmount || 0),
      refundAmount,
      penaltyAmount,
      currency: 'CAD'
    },
    academic: {
      gradeAssigned: gradeCalc.grade,
      gradeLabel: GRADE_LABELS[gradeCalc.grade] || gradeCalc.grade,
      appearsOnTranscript: gradeCalc.appearsOnTranscript,
      gradeReason: gradeCalc.reason
    },
    deadlines: {
      addDropDeadline: termRow?.addDropDeadline || '',
      withdrawWithoutPenaltyDeadline: termRow?.withdrawWithoutPenaltyDeadline || '',
      withdrawDeadline: termRow?.withdrawDeadline || '',
      censusDate: termRow?.censusDate || '',
      classesStartDate: termRow?.classesStartDate || '',
      classesEndDate: termRow?.classesEndDate || ''
    },
    policyWarnings: missingCriticalDates.length
      ? [`Program/term date setup is incomplete (${missingCriticalDates.join(', ')}). Admin review is recommended.`]
      : [],
    missingCriticalDates,
    effectiveDate: effectiveDate || todayISO()
  };
}

function canWithdraw({ type, status, termRow, effectiveDate }) {
  const today = effectiveDate || todayISO();
  const issues = [];
  const warnings = [];

  if (status && ['withdrawn', 'cancelled', 'completed', 'rolled_back'].includes(status.toLowerCase())) {
    issues.push(`Cannot withdraw: registration is already ${status}.`);
    return { canWithdraw: false, issues, warnings };
  }

  const withdrawDeadline = termRow?.withdrawDeadline || '';
  if (withdrawDeadline && today > withdrawDeadline) {
    warnings.push(`Warning: Past withdrawal deadline (${withdrawDeadline}). Late withdrawal fees may apply.`);
  }

  const classesEndDate = termRow?.classesEndDate || '';
  if (classesEndDate && today > classesEndDate) {
    issues.push(`Cannot withdraw: Term has already ended (${classesEndDate}).`);
    return { canWithdraw: false, issues, warnings };
  }

  return { canWithdraw: issues.length === 0, issues, warnings };
}

function getWithdrawalReasons() {
  return Object.entries(WITHDRAWAL_REASON_LABELS).map(([value, label]) => ({
    value,
    label
  }));
}

function getRefundPolicies() {
  return Object.entries(REFUND_POLICY_LABELS).map(([value, label]) => ({
    value,
    label
  }));
}

function getGradeOptions() {
  return Object.entries(GRADE_LABELS).map(([value, label]) => ({
    value,
    label
  }));
}

module.exports = {
  REFUND_POLICIES,
  REFUND_POLICY_LABELS,
  GRADE_ASSIGNMENTS,
  GRADE_LABELS,
  calculateRefundPercentage,
  determineGradeAssignment,
  calculateWithdrawalImpact,
  canWithdraw,
  getWithdrawalReasons,
  getRefundPolicies,
  getGradeOptions,
  todayISO,
  roundMoney,
  getMissingCriticalDates
};
