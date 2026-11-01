'use strict';

const { allocateWithRetry } = require('./schoolEntityIdAllocationService');

function wrapAllocator(generateCandidate, contextKeys = []) {
  return async function allocateUnique(options = {}) {
    const payload = options.payload || options;
    return allocateWithRetry({
      collection: options.collection || null,
      existingIds: options.existingIds,
      reservedIds: options.reservedIds,
      maxAttempts: options.maxAttempts,
      generateCandidate: () => {
        if (contextKeys.length === 0) return generateCandidate();
        const args = contextKeys.map((key) => {
          if (key === 'deptCode') {
            return options.deptCode || payload.deptCode || payload?.academicUnit?.departmentCode;
          }
          return payload[key] ?? options[key];
        });
        return generateCandidate(...args);
      }
    });
  };
}

function candidateProgramId() {
  return `PRG${Math.floor(10000 + Math.random() * 90000)}`;
}

function candidateFunderId() {
  return `FUN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function candidateTermId() {
  return `TRM-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function candidateDepartmentId() {
  return `DEP_${Date.now()}`;
}

function candidateSubjectId(deptCode) {
  const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
  const dCode = String(deptCode || 'XXX').toUpperCase();
  return `SUB-${dCode}-${randomStr}`;
}

function candidateClassId() {
  const year = new Date().getFullYear();
  const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `CLS-${year}-${randomStr}`;
}

function candidateClassTemplateId() {
  return `CLT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function candidateSkillId() {
  const year = new Date().getFullYear();
  return `SKL-${year}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function candidateSessionStatusId() {
  const year = new Date().getFullYear();
  return `SSS-${year}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function candidateSchoolAccountId() {
  return `ACC_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function candidateTransactionDefinitionId() {
  return `TRX${Math.floor(10000 + Math.random() * 90000)}`;
}

function candidateTransactionJournalId() {
  const prefix = `JRN${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  return `${prefix}${Math.floor(10000 + Math.random() * 90000)}`;
}

function candidateStudentProgramRegistrationId() {
  return `SPR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function candidateStudentTermRegistrationId() {
  return `STR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function candidateStudentProgramPriorSubjectId() {
  return `SPPS-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function candidateClassEnrollmentPeriodId() {
  return `CEP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function candidateLeaveRequestId() {
  return `LR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function candidateTaskId() {
  return `STA-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function candidateTaskRoutingRuleId() {
  return `SNR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function candidateSessionStudentCaseId() {
  return `SSC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function candidateAttendanceChangeLogId() {
  return `ACL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function candidateTeachingOutlineLevelId() {
  return `TOL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function candidateTeachingOutlineTemplateId(skillId) {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TOST_${String(skillId || 'skill').toUpperCase()}_${rand}`;
}

function candidateTeachingOutlineItemId() {
  return `TOI-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function candidatePayRateId() {
  return `PR_${Date.now()}`;
}

function candidateTimesheetPeriodId() {
  return `TSP_${Date.now()}`;
}

function candidateTimesheetId() {
  return `TS_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function candidateHolidayId() {
  return `HOL-${Math.floor(10000 + Math.random() * 90000)}`;
}

function candidateGlobalTransactionId() {
  const prefix = `GTL${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  return `${prefix}${Math.floor(10000 + Math.random() * 90000)}`;
}

function candidateAcademicLedgerEntryId() {
  return `ALD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

module.exports = {
  candidateProgramId,
  candidateFunderId,
  candidateTermId,
  candidateDepartmentId,
  candidateSubjectId,
  candidateClassId,
  candidateClassTemplateId,
  candidateSkillId,
  candidateSessionStatusId,
  candidateSchoolAccountId,
  candidateTransactionDefinitionId,
  candidateTransactionJournalId,
  candidateStudentProgramRegistrationId,
  candidateStudentTermRegistrationId,
  candidateStudentProgramPriorSubjectId,
  candidateClassEnrollmentPeriodId,
  candidateLeaveRequestId,
  candidateTaskId,
  candidateTaskRoutingRuleId,
  candidateSessionStudentCaseId,
  candidateAttendanceChangeLogId,
  candidateTeachingOutlineLevelId,
  candidateTeachingOutlineTemplateId,
  candidateTeachingOutlineItemId,
  candidatePayRateId,
  candidateTimesheetPeriodId,
  candidateTimesheetId,
  candidateHolidayId,
  candidateGlobalTransactionId,
  candidateAcademicLedgerEntryId,
  wrapAllocator,
  allocateUniqueProgramId: wrapAllocator(candidateProgramId),
  allocateUniqueFunderId: wrapAllocator(candidateFunderId),
  allocateUniqueTermId: wrapAllocator(candidateTermId),
  allocateUniqueDepartmentId: wrapAllocator(candidateDepartmentId),
  allocateUniqueSubjectId: wrapAllocator(candidateSubjectId, ['deptCode']),
  allocateUniqueClassId: wrapAllocator(candidateClassId),
  allocateUniqueClassTemplateId: wrapAllocator(candidateClassTemplateId),
  allocateUniqueSkillId: wrapAllocator(candidateSkillId),
  allocateUniqueSessionStatusId: wrapAllocator(candidateSessionStatusId),
  allocateUniqueSchoolAccountId: wrapAllocator(candidateSchoolAccountId),
  allocateUniqueTransactionDefinitionId: wrapAllocator(candidateTransactionDefinitionId),
  allocateUniqueTransactionJournalId: wrapAllocator(candidateTransactionJournalId),
  allocateUniqueStudentProgramRegistrationId: wrapAllocator(candidateStudentProgramRegistrationId),
  allocateUniqueStudentTermRegistrationId: wrapAllocator(candidateStudentTermRegistrationId),
  allocateUniqueStudentProgramPriorSubjectId: wrapAllocator(candidateStudentProgramPriorSubjectId),
  allocateUniqueClassEnrollmentPeriodId: wrapAllocator(candidateClassEnrollmentPeriodId),
  allocateUniqueLeaveRequestId: wrapAllocator(candidateLeaveRequestId),
  allocateUniqueTaskId: wrapAllocator(candidateTaskId),
  allocateUniqueTaskRoutingRuleId: wrapAllocator(candidateTaskRoutingRuleId),
  allocateUniqueSessionStudentCaseId: wrapAllocator(candidateSessionStudentCaseId),
  allocateUniqueAttendanceChangeLogId: wrapAllocator(candidateAttendanceChangeLogId),
  allocateUniqueTeachingOutlineLevelId: wrapAllocator(candidateTeachingOutlineLevelId),
  allocateUniqueTeachingOutlineTemplateId: wrapAllocator(candidateTeachingOutlineTemplateId, ['skillId']),
  allocateUniqueTeachingOutlineItemId: wrapAllocator(candidateTeachingOutlineItemId),
  allocateUniquePayRateId: wrapAllocator(candidatePayRateId),
  allocateUniqueTimesheetPeriodId: wrapAllocator(candidateTimesheetPeriodId),
  allocateUniqueTimesheetId: wrapAllocator(candidateTimesheetId),
  allocateUniqueHolidayId: wrapAllocator(candidateHolidayId),
  allocateUniqueGlobalTransactionId: wrapAllocator(candidateGlobalTransactionId),
  allocateUniqueAcademicLedgerEntryId: wrapAllocator(candidateAcademicLedgerEntryId)
};
