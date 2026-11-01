'use strict';

const { allocateWithRetry } = require('./schoolEntityIdAllocationService');
const { generateStudentSystemIdCandidate } = require('./studentSystemIdGenerator');
const { generateRoleSystemIdCandidate } = require('./roleSystemIdGenerator');

async function allocateUniqueStudentSystemId(options = {}) {
  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: options.existingIds,
    reservedIds: options.reservedIds,
    maxAttempts: options.maxAttempts,
    generateCandidate: () => generateStudentSystemIdCandidate(new Set())
  });
}

async function allocateUniqueRoleSystemId(roleType, options = {}) {
  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: options.existingIds,
    reservedIds: options.reservedIds,
    maxAttempts: options.maxAttempts,
    generateCandidate: () => generateRoleSystemIdCandidate(roleType, new Set())
  });
}

module.exports = {
  allocateUniqueStudentSystemId,
  allocateUniqueTeacherSystemId: (options) => allocateUniqueRoleSystemId('teacher', options),
  allocateUniqueStaffSystemId: (options) => allocateUniqueRoleSystemId('staff', options)
};
