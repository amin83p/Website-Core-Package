'use strict';

const schoolDataService = require('./schoolDataService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const reportIntegrityService = require('./reportIntegrityService');

function cleanId(value = '') {
  return String(value ?? '').trim();
}

function createExportBatchCache() {
  return {
    classById: new Map(),
    templateById: new Map(),
    studentsAll: null,
    personsAll: null,
    studentsPersonsLoading: null
  };
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
  ensureStudentsAndPersons
};
