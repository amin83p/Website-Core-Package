// MVC/services/school/reportFunderDocxService.js
'use strict';

const schoolDataService = require('./schoolDataService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const DEFAULT_DOCX_KEY = 'default';
const SELF_FUNDER_KEY = rollingEnrollmentFunderService.SELF_FUNDER_ID || 'self';

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  const match = token.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function clean(value) {
  return String(value || '').trim();
}

function hasDocxPath(docxTemplate = null) {
  return Boolean(clean(docxTemplate?.path));
}

function listFunderDocxMappings(template = {}) {
  return (Array.isArray(template?.docxTemplatesByFunder) ? template.docxTemplatesByFunder : [])
    .filter((row) => row && hasDocxPath(row.docxTemplate))
    .map((row) => ({
      funderKey: clean(row.funderKey),
      label: clean(row.label) || (clean(row.funderKey) === SELF_FUNDER_KEY ? 'Self Fund' : clean(row.funderKey)),
      docxTemplate: row.docxTemplate
    }))
    .filter((row) => row.funderKey);
}

function templateHasAnyDocx(template = {}) {
  if (hasDocxPath(template?.docxTemplate)) return true;
  return listFunderDocxMappings(template).length > 0;
}

function buildAvailableDocxOptions(template = {}) {
  const options = [];
  if (hasDocxPath(template?.docxTemplate)) {
    options.push({
      key: DEFAULT_DOCX_KEY,
      label: 'Default',
      fileName: clean(template.docxTemplate.originalName || template.docxTemplate.fileName)
    });
  }
  listFunderDocxMappings(template).forEach((row) => {
    options.push({
      key: row.funderKey,
      label: row.label,
      fileName: clean(row.docxTemplate.originalName || row.docxTemplate.fileName)
    });
  });
  return options;
}

function resolveDocxTemplateForFunder({ template = {}, funderKey = '' } = {}) {
  const key = clean(funderKey) || DEFAULT_DOCX_KEY;
  if (key && key !== DEFAULT_DOCX_KEY) {
    const match = listFunderDocxMappings(template).find((row) => (
      idsEqual(row.funderKey, key) || String(row.funderKey).toLowerCase() === key.toLowerCase()
    ));
    if (match?.docxTemplate) {
      return { docxKey: match.funderKey, docxTemplate: match.docxTemplate, label: match.label };
    }
  }
  if (hasDocxPath(template?.docxTemplate)) {
    return { docxKey: DEFAULT_DOCX_KEY, docxTemplate: template.docxTemplate, label: 'Default' };
  }
  const first = listFunderDocxMappings(template)[0] || null;
  if (first) {
    return { docxKey: first.funderKey, docxTemplate: first.docxTemplate, label: first.label };
  }
  return { docxKey: '', docxTemplate: null, label: '' };
}

function suggestDocxKeyForFunder({ template = {}, funderKey = '' } = {}) {
  const key = clean(funderKey);
  if (key) {
    const mapped = listFunderDocxMappings(template).find((row) => (
      idsEqual(row.funderKey, key) || String(row.funderKey).toLowerCase() === key.toLowerCase()
    ));
    if (mapped) return mapped.funderKey;
  }
  if (hasDocxPath(template?.docxTemplate)) return DEFAULT_DOCX_KEY;
  const first = listFunderDocxMappings(template)[0];
  return first ? first.funderKey : '';
}

function resolveStudentFunderForReportPeriod({
  periodRows = [],
  studentId = '',
  personId = '',
  studentToPersonMap = null,
  windowStart = '',
  windowEnd = ''
} = {}) {
  const sid = clean(studentId);
  const pid = clean(personId);
  const matches = (Array.isArray(periodRows) ? periodRows : []).filter((row) => {
    const rowStudentId = clean(row?.studentId);
    if (sid && idsEqual(rowStudentId, sid)) return true;
    if (!pid || !studentToPersonMap) return false;
    const mappedPersonId = clean(studentToPersonMap.get?.(rowStudentId) || studentToPersonMap[rowStudentId]);
    return mappedPersonId && idsEqual(mappedPersonId, pid);
  });

  if (!matches.length) {
    return { funderKey: '', funderType: '', funderId: '' };
  }

  const ws = normalizeDateOnly(windowStart) || '0000-01-01';
  const we = normalizeDateOnly(windowEnd) || '9999-12-31';
  const overlapping = matches.filter((row) => {
    const start = normalizeDateOnly(row?.startDate) || '0000-01-01';
    const effectiveEnd = classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(row) || '9999-12-31';
    return start <= we && effectiveEnd >= ws;
  });
  const pool = (overlapping.length ? overlapping : matches).slice().sort((a, b) => (
    String(b?.startDate || '').localeCompare(String(a?.startDate || ''))
  ));
  const chosen = pool[0] || null;
  if (!chosen) return { funderKey: '', funderType: '', funderId: '' };

  const normalized = rollingEnrollmentFunderService.normalizeEnrollmentFunderSelection({
    funderId: chosen.funderId,
    funderType: chosen.funderType
  });
  return {
    funderKey: normalized.funderId,
    funderType: normalized.funderType,
    funderId: normalized.funderId
  };
}

async function loadActiveFunderOptions(reqUser, orgId) {
  const orgToken = toPublicId(orgId);
  if (!orgToken) return [];
  const rows = await schoolDataService.fetchData('funders', {}, reqUser);
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!idsEqual(row?.orgId, orgToken)) return false;
    return String(row?.status || '').trim().toLowerCase() === 'active';
  });
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: scoped.map((row) => row.personId)
  });
  return scoped
    .map((row) => {
      const id = toPublicId(row?.id);
      if (!id) return null;
      const personId = toPublicId(row?.personId);
      const label = schoolPersonAccessService.formatPersonName(personById.get(personId), id)
        || String(personById.get(personId)?.organizationProfile?.legalName || '').trim()
        || id;
      return { id, label, personId };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
}

function buildFunderPickerOptions(activeFunders = []) {
  return [
    { id: SELF_FUNDER_KEY, label: 'Self Fund' },
    ...(Array.isArray(activeFunders) ? activeFunders : []).map((row) => ({
      id: clean(row.id),
      label: clean(row.label) || clean(row.id)
    })).filter((row) => row.id && row.id !== SELF_FUNDER_KEY)
  ];
}

async function buildExportDocxSuggestions({
  template,
  assignment = null,
  students = [],
  reqUser,
  windowStart = '',
  windowEnd = ''
} = {}) {
  if (!template) throw new Error('Report template is required.');
  const start = normalizeDateOnly(windowStart)
    || normalizeDateOnly(assignment?.reportStartDate);
  const end = normalizeDateOnly(windowEnd)
    || normalizeDateOnly(assignment?.reportDueDate);
  const classId = clean(assignment?.classId);
  const orgId = clean(template.orgId || assignment?.orgId || reqUser?.activeOrgId);

  const [periodRows, funderOptions] = await Promise.all([
    classId
      ? schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser).catch(() => [])
      : Promise.resolve([]),
    loadActiveFunderOptions(reqUser, orgId).catch(() => [])
  ]);

  const labelById = new Map(
    funderOptions.map((row) => [String(row.id), String(row.label || row.id)])
  );
  labelById.set(SELF_FUNDER_KEY, 'Self Fund');

  const availableDocxOptions = buildAvailableDocxOptions(template);
  const rows = (Array.isArray(students) ? students : []).map((student) => {
    const studentId = clean(student.studentId || student.id);
    const personId = clean(student.personId);
    const studentName = clean(student.studentName || student.name || studentId);
    const funder = resolveStudentFunderForReportPeriod({
      periodRows,
      studentId,
      personId,
      windowStart: start,
      windowEnd: end
    });
    const funderKey = funder.funderKey || '';
    const funderLabel = funderKey
      ? rollingEnrollmentFunderService.resolveEnrollmentFunderLabel(
        { funderId: funder.funderId, funderType: funder.funderType },
        labelById
      )
      : 'Default / unknown';
    const suggestedDocxKey = suggestDocxKeyForFunder({ template, funderKey });
    return {
      studentId,
      personId,
      instanceId: clean(student.instanceId),
      studentName,
      funderKey: funderKey || '',
      funderLabel,
      suggestedDocxKey,
      availableDocxOptions
    };
  });

  return {
    templateId: clean(template.id),
    reportStartDate: start,
    reportDueDate: end,
    availableDocxOptions,
    hasDefaultDocx: hasDocxPath(template.docxTemplate),
    rows
  };
}

module.exports = {
  DEFAULT_DOCX_KEY,
  SELF_FUNDER_KEY,
  hasDocxPath,
  templateHasAnyDocx,
  listFunderDocxMappings,
  buildAvailableDocxOptions,
  resolveDocxTemplateForFunder,
  suggestDocxKeyForFunder,
  resolveStudentFunderForReportPeriod,
  loadActiveFunderOptions,
  buildFunderPickerOptions,
  buildExportDocxSuggestions
};
