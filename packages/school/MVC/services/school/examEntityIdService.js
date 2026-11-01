'use strict';

const { createPrefixedRandomAllocator } = require('./schoolEntityIdAllocationService');

const EXAM_PREFIXES = Object.freeze({
  examTemplates: 'EXMTPL',
  examRevisions: 'EXMREV',
  examQuestions: 'EXMQUE',
  examAllocations: 'EXMALC',
  examAssignments: 'EXMASG',
  examAttempts: 'EXMATP',
  examAnswers: 'EXMANS'
});

function allocateUniqueExamEntityId(entityKey, options = {}) {
  const prefix = EXAM_PREFIXES[entityKey];
  if (!prefix) throw new Error(`Unsupported exam entity key: ${entityKey}`);
  const allocator = createPrefixedRandomAllocator(prefix, { style: 'exam' });
  return allocator(options);
}

module.exports = {
  EXAM_PREFIXES,
  allocateUniqueExamEntityId
};
