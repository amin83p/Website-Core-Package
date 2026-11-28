'use strict';

const schoolAiServiceExecutionService = require('./schoolAiServiceExecutionService');
const holidayAiObservancePreviewService = require('./holidayAiObservancePreviewService');
const { getAiServiceByKey } = require('../../config/schoolAiServiceRegistry');

const SERVICE_KEY = 'school.holiday_cultural_observances';
const USAGE_SOURCE = 'holiday_cultural_observances';

let dependencies = {
  schoolAiServiceExecutionService,
  getAiServiceByKey,
  holidayAiObservancePreviewService
};

function assignmentHintMessage(error) {
  const message = String(error?.message || '');
  if (/assignment|provider|model|resolve/i.test(message)) {
    return `${message} Assign a provider and model in AI Assist → Service assignments for Holiday Cultural Observances.`;
  }
  return message;
}

function normalizeAiOccasions(data) {
  const rows = Array.isArray(data?.occasions) ? data.occasions : [];
  return rows.map((row) => ({
    name: String(row?.name || '').trim(),
    startDate: String(row?.startDate || '').trim().slice(0, 10),
    endDate: String(row?.endDate || '').trim().slice(0, 10),
    calendarSystem: String(row?.calendarSystem || 'other').trim(),
    confidence: String(row?.confidence || 'medium').trim().toLowerCase(),
    notes: String(row?.notes || '').trim()
  })).filter((row) => row.name);
}

async function analyze({
  year,
  occasions,
  regionHint = '',
  calendarNotes,
  existingHolidays = [],
  requestingUser,
  accessContext = {}
} = {}) {
  const targetYear = holidayAiObservancePreviewService.assertYear(year);
  holidayAiObservancePreviewService.parseOccasionNames(occasions);
  if (!dependencies.getAiServiceByKey(SERVICE_KEY)) {
    throw new Error('Holiday cultural observances AI service is not registered.');
  }

  const inputs = {
    year: targetYear,
    occasions: String(occasions || '').trim(),
    regionHint: String(regionHint || '').trim(),
    calendarNotes: String(calendarNotes || '').trim()
      || 'School calendar uses Gregorian year boundaries. Return inclusive date ranges within the requested year only.'
  };

  let result;
  try {
    result = await dependencies.schoolAiServiceExecutionService.run({
      serviceKey: SERVICE_KEY,
      inputs,
      requestingUser,
      accessContext,
      usageMeta: { usageSource: USAGE_SOURCE }
    });
  } catch (error) {
    const wrapped = new Error(assignmentHintMessage(error));
    wrapped.statusCode = error?.statusCode || 400;
    throw wrapped;
  }

  if (!result?.ok) {
    const err = new Error(assignmentHintMessage(new Error(
      result?.error || 'AI analysis failed. Check the service definition and try again.'
    )));
    err.statusCode = 400;
    throw err;
  }

  const aiOccasions = normalizeAiOccasions(result.data);
  if (!aiOccasions.length) {
    throw new Error('AI did not return any resolvable occasions for that year. Adjust names or region hint and try again.');
  }

  const preview = holidayAiObservancePreviewService.buildPreviewFromAiOccasions({
    aiOccasions,
    year: targetYear,
    existingHolidays
  });

  return {
    ok: true,
    ...preview,
    aiOccasions,
    traceId: result.traceId || null,
    usageRecordId: result.usageRecordId || null,
    modelId: result.modelId || null
  };
}

function __setDependenciesForTest(next = {}) {
  dependencies = { ...dependencies, ...next };
}

function __resetDependenciesForTest() {
  dependencies = {
    schoolAiServiceExecutionService,
    getAiServiceByKey,
    holidayAiObservancePreviewService
  };
}

module.exports = {
  SERVICE_KEY,
  USAGE_SOURCE,
  analyze,
  normalizeAiOccasions,
  __setDependenciesForTest,
  __resetDependenciesForTest
};