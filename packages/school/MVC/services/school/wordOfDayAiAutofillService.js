'use strict';

const schoolAiServiceExecutionService = require('./schoolAiServiceExecutionService');
const schoolAiOutputBindingService = require('./schoolAiOutputBindingService');
const { getAiServiceByKey } = require('../../config/schoolAiServiceRegistry');

const SERVICE_KEY = 'school.word_of_day_autofill';
const USAGE_SOURCE = 'word_of_day_autofill';
const FORM_CONSUMER_KEY = 'word_of_day.form';

let dependencies = {
  schoolAiServiceExecutionService,
  schoolAiOutputBindingService,
  getAiServiceByKey
};

function mapAutofillPayload(data) {
  return dependencies.schoolAiOutputBindingService.mapAiResultToFormValues(data, {
    serviceKey: SERVICE_KEY,
    consumerKey: FORM_CONSUMER_KEY
  });
}

function assignmentHintMessage(error) {
  const message = String(error?.message || '');
  if (/assignment|provider|model|resolve/i.test(message)) {
    return `${message} Assign a provider and model in AI Assist → Service assignments for Word of the Day Autofill.`;
  }
  return message;
}

async function autofill({ word, requestingUser, accessContext = {} } = {}) {
  const token = String(word || '').trim();
  if (!token) throw new Error('Word is required for AI autofill.');
  if (token.length > 200) throw new Error('Word must be 200 characters or fewer.');
  if (!dependencies.getAiServiceByKey(SERVICE_KEY)) {
    throw new Error('Word of the Day autofill service is not registered.');
  }

  let result;
  try {
    result = await dependencies.schoolAiServiceExecutionService.run({
      serviceKey: SERVICE_KEY,
      inputs: { word: token },
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
      result?.error || 'AI autofill failed. Check the service definition and try again.'
    )));
    err.statusCode = 400;
    throw err;
  }

  const fields = mapAutofillPayload(result.data);
  return {
    ok: true,
    fields,
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
    schoolAiOutputBindingService,
    getAiServiceByKey
  };
}

module.exports = {
  SERVICE_KEY,
  USAGE_SOURCE,
  FORM_CONSUMER_KEY,
  mapAutofillPayload,
  autofill,
  __setDependenciesForTest,
  __resetDependenciesForTest
};