'use strict';

const { resolveSchoolCreateId } = require('./schoolEntityIdAllocationService');

async function resolveReportCreateId(options = {}) {
  return resolveSchoolCreateId(options);
}

module.exports = {
  resolveReportCreateId,
  resolveSchoolCreateId
};
