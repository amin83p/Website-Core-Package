'use strict';

const schoolDataService = require('./schoolDataService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const reportIntegrityService = require('./reportIntegrityService');
const reportFunderDocxService = require('./reportFunderDocxService');
const reportDocxRenderService = require('./reportDocxRenderService');

function cleanId(value = '') {
  return String(value ?? '').trim();
}

function createExportBatchCache() {
  return {
    classById: new Map(),
    templateById: new Map(),
    docxBufferByRef: new Map(),
    docxBufferLoadByRef: new Map(),
    studentsAll: null,
    personsAll: null,
    studentsPersonsLoading: null
  };
}

async function prewarmDocxTemplates(cache, templates = [], options = {}) {
  if (!cache?.docxBufferByRef) return 0;
  const strict = Boolean(options.strict);
  const unique = (Array.isArray(templates) ? templates : []).filter(Boolean);
  let warmed = 0;
  const failures = [];
  for (const template of unique) {
    const keys = reportFunderDocxService.buildAvailableDocxOptions(template)
      .map((row) => cleanId(row.key))
      .filter(Boolean);
  // eslint-disable-next-line no-await-in-loop
    for (const key of keys) {
      const resolved = reportFunderDocxService.resolveDocxTemplateForFunder({ template, funderKey: key });
      if (!resolved?.docxTemplate) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await reportDocxRenderService.readDocxTemplateBuffer(resolved.docxTemplate, { exportBatchCache: cache });
        warmed += 1;
      } catch (error) {
        failures.push(error);
        if (strict) throw error;
      }
    }
  }
  if (strict && warmed === 0 && unique.length) {
    const error = failures[0] || new Error('Could not prewarm any DOCX templates for export.');
    throw error;
  }
  return warmed;
}

function dedupeDocxLoadRefs(refs = []) {
  const unique = new Map();
  (Array.isArray(refs) ? refs : []).forEach((row) => {
    if (!row?.docxTemplate) return;
    const uploadRef = reportDocxRenderService.resolveDocxTemplateReadRef(row.docxTemplate);
    const key = `${cleanId(row.templateId)}|${cleanId(row.variantKey) || 'default'}|${uploadRef}`;
    if (!uploadRef || unique.has(key)) return;
    unique.set(key, {
      templateId: cleanId(row.templateId),
      variantKey: cleanId(row.variantKey) || 'default',
      uploadRef,
      label: String(row.label || '').trim(),
      docxTemplate: row.docxTemplate
    });
  });
  return [...unique.values()];
}

async function prewarmDocxRefs(cache, refs = [], options = {}) {
  if (!cache?.docxBufferByRef) return 0;
  const strict = Boolean(options.strict);
  const unique = dedupeDocxLoadRefs(refs);
  let warmed = 0;
  const failures = [];
  for (const row of unique) {
    if (!row?.docxTemplate) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await reportDocxRenderService.readDocxTemplateBuffer(row.docxTemplate, { exportBatchCache: cache });
      warmed += 1;
    } catch (error) {
      failures.push(error);
      if (strict) throw error;
    }
  }
  if (strict && warmed === 0 && unique.length) {
    const error = failures[0] || new Error('Could not prewarm any DOCX templates for export.');
    throw error;
  }
  return warmed;
}

async function getOrLoadClassBundle(cache, classId, reqUser) {
  const key = cleanId(classId);
  if (!key) return { classData: null, sessions: [] };
  if (cache?.classById?.has(key)) {
    return cache.classById.get(key);
  }
  const [classData, sessions] = await Promise.all([
    schoolDataService.getDataById('classes', key, reqUser),
    schoolDataService.getClassSessions(key, reqUser)
  ]);
  const bundle = {
    classData,
    sessions: Array.isArray(sessions) ? sessions : []
  };
  if (cache?.classById) {
    cache.classById.set(key, bundle);
  }
  return bundle;
}

async function getOrLoadTemplate(cache, templateId, reqUser) {
  const key = cleanId(templateId);
  if (!key) return null;
  if (cache?.templateById?.has(key)) {
    return cache.templateById.get(key);
  }
  const template = await reportIntegrityService.assertTemplateAccessible(key, reqUser);
  if (cache?.templateById) {
    cache.templateById.set(key, template);
  }
  return template;
}

async function ensureStudentsAndPersons(cache, reqUser) {
  if (!cache) {
    const [students, personsPayload] = await Promise.all([
      schoolDataService.fetchAllData('students', {}, reqUser),
      schoolIdentityLookupService.listSchoolPersonRecords({
        reqUser,
        requireSchoolRole: false,
        query: { limit: 5000 }
      })
    ]);
    return {
      students: Array.isArray(students) ? students : [],
      persons: personsPayload?.allRows || personsPayload?.rows || []
    };
  }
  if (cache.studentsAll && cache.personsAll) {
    return { students: cache.studentsAll, persons: cache.personsAll };
  }
  if (!cache.studentsPersonsLoading) {
    cache.studentsPersonsLoading = Promise.all([
      schoolDataService.fetchAllData('students', {}, reqUser),
      schoolIdentityLookupService.listSchoolPersonRecords({
        reqUser,
        requireSchoolRole: false,
        query: { limit: 5000 }
      })
    ]).then(([students, personsPayload]) => {
      cache.studentsAll = Array.isArray(students) ? students : [];
      cache.personsAll = personsPayload?.allRows || personsPayload?.rows || [];
      cache.studentsPersonsLoading = null;
      return { students: cache.studentsAll, persons: cache.personsAll };
    });
  }
  return cache.studentsPersonsLoading;
}

module.exports = {
  createExportBatchCache,
  getOrLoadClassBundle,
  getOrLoadTemplate,
  ensureStudentsAndPersons,
  prewarmDocxTemplates,
  dedupeDocxLoadRefs,
  prewarmDocxRefs
};
