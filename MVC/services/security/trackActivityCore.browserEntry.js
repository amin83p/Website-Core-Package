'use strict';

const core = require('./trackActivityCore');
const hourly = require('./trackActivityHourlyTimeline');

module.exports = {
  parseTimelineFilters: core.parseTimelineFilters,
  buildEventsFromSourceRecords: core.buildEventsFromSourceRecords,
  buildLookupMap: core.buildLookupMap,
  cleanText: core.cleanText,
  applyEventFilters: core.applyEventFilters,
  maskSensitiveObject: core.maskSensitiveObject,
  buildSafeFiltersForResponse: core.buildSafeFiltersForResponse,
  clamp: core.clamp,
  buildHourlyTimelineFromLogs: hourly.buildHourlyTimelineFromLogs,
  buildSummary: core.buildSummary,
  MAX_RANGE_DAYS: core.MAX_RANGE_DAYS
};
