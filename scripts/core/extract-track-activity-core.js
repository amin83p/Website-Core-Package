'use strict';

const fs = require('fs');
const path = require('path');

const servicePath = path.join(__dirname, '../../MVC/services/security/trackActivityService.js');
const outPath = path.join(__dirname, '../../MVC/services/security/trackActivityCore.js');
const src = fs.readFileSync(servicePath, 'utf8');
const start = src.indexOf('const DEFAULT_LOOKBACK_DAYS');
const end = src.indexOf('async function fetchCanonicalSourceRows');
const chunk = src.slice(start, end);

const header = `'use strict';

const { toPublicId } = require('../../utils/idAdapter');
const {
  resolveOrganizationTimezoneFromRow,
  getDateTimePartsInTimezone,
  getDateKeyInTimezone,
  getDayBoundsMs,
  toUtcMsFromTimezoneLocal,
  formatMsToDateTimeLocalInput
} = require('../../utils/timezoneUtils');

`;

const footer = `
function buildEventsFromSourceRecords({
  logs = [],
  actionStates = [],
  rawQuery = {},
  filters: presetFilters = null,
  timezone = DEFAULT_ORG_TIMEZONE,
  lookups = { sections: [], operations: [], organizations: [] },
  userRows = []
}) {
  const filters = presetFilters || parseTimelineFilters(rawQuery, timezone);
  const lookupMaps = {
    sectionMap: buildLookupMap(lookups.sections),
    operationMap: buildLookupMap(lookups.operations),
    orgMap: buildLookupMap(lookups.organizations),
    userMap: buildLookupMap(userRows)
  };
  const actionEvents = (Array.isArray(actionStates) ? actionStates : [])
    .map((row) => buildActionStateProjection(row, lookupMaps, timezone));
  const logEvents = (Array.isArray(logs) ? logs : [])
    .map((row) => buildLogEvent(row, lookupMaps, timezone));
  const enrichedEvents = attachActionEnrichment(logEvents, actionEvents);
  const filteredEvents = applyEventFilters(enrichedEvents, filters)
    .sort((a, b) => Number(b.occurredAtMs || 0) - Number(a.occurredAtMs || 0));
  return {
    filters,
    timezone,
    events: filteredEvents,
    summary: buildSummary(filteredEvents)
  };
}

module.exports = {
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MERGE_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  MAX_MERGE_LIMIT,
  MIN_MERGE_LIMIT,
  MAX_RANGE_DAYS,
  DEFAULT_ORG_TIMEZONE,
  parseTimelineFilters,
  buildDefaultPageFilters,
  buildEventsFromSourceRecords,
  buildSummary,
  applyEventFilters,
  sanitizeCsvCellForSpreadsheet,
  toEventRow,
  buildPagination,
  buildLogEvent,
  buildActionStateProjection,
  attachActionEnrichment,
  buildLookupMap,
  cleanText
};
`;

fs.writeFileSync(outPath, header + chunk + footer);
console.log('Wrote', outPath);
