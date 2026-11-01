'use strict';

const { createPrefixedRandomAllocator } = require('./schoolEntityIdAllocationService');

const allocateUniqueNotificationRuleId = createPrefixedRandomAllocator('SNCR', { style: 'notification' });
const allocateUniqueNotificationRunId = createPrefixedRandomAllocator('SNRUN', { style: 'notification' });

module.exports = {
  allocateUniqueNotificationRuleId,
  allocateUniqueNotificationRunId
};
