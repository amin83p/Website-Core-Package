'use strict';

const { createPrefixedRandomAllocator } = require('./schoolEntityIdAllocationService');

const allocateUniqueLibraryCopyId = createPrefixedRandomAllocator('LC');
const allocateUniqueLibraryPatronId = createPrefixedRandomAllocator('LP');
const allocateUniqueLibraryLoanId = createPrefixedRandomAllocator('LL');
const allocateUniqueLibraryLocationId = createPrefixedRandomAllocator('LLoc');
const allocateUniqueLibraryPolicyId = createPrefixedRandomAllocator('LPLY');
const allocateUniqueLibraryPatronOrgId = createPrefixedRandomAllocator('LPO');

module.exports = {
  allocateUniqueLibraryCopyId,
  allocateUniqueLibraryPatronId,
  allocateUniqueLibraryLoanId,
  allocateUniqueLibraryLocationId,
  allocateUniqueLibraryPolicyId,
  allocateUniqueLibraryPatronOrgId
};
