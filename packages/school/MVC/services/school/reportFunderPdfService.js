'use strict';

const schoolDataService = require('./schoolDataService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const DEFAULT_PDF_KEY = 'default';
const SELF_FUNDER_KEY = rollingEnrollmentFunderService.SELF_FUNDER_ID || 'self';

function clean(value) {
  return String(value || '').trim();
}

function normalizeDateOnly(value) {
  const token = clean(value);
  if (!token) return '';
  const match = token.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function hasPdfPath(pdfTemplate = null) {
  return Boolean(clean(pdfTemplate?.path));
}

function listFunderPdfMappings(template = {}) {
  return (Array.isArray(template?.pdfTemplatesByFunder) ? template.pdfTemplatesByFunder : [])
    .filter((row) => row && hasPdfPath(row.pdfTemplate))
    .map((row) => ({
      funderKey: clean(row.funderKey),
      label: clean(row.label) || (clean(row.funderKey) === SELF_FUNDER_KEY ? 'Self Fund' : clean(row.funderKey)),
      pdfTemplate: row.pdfTemplate
    }))
    .filter((row) => row.funderKey);
}

function templateHasAnyPdf(template = {}) {
  if (hasPdfPath(template?.pdfTemplate)) return true;
  return listFunderPdfMappings(template).length > 0;
}

function buildAvailablePdfOptions(template = {}) {
  const options = [];
  if (hasPdfPath(template?.pdfTemplate)) {
    options.push({
      key: DEFAULT_PDF_KEY,
      label: 'Default',
      fileName: clean(template.pdfTemplate.originalName || template.pdfTemplate.fileName)
    });
  }
  listFunderPdfMappings(template).forEach((row) => {
    options.push({
      key: row.funderKey,
      label: row.label,
      fileName: clean(row.pdfTemplate.originalName || row.pdfTemplate.fileName)
    });
  });
  return options;
}

function resolvePdfTemplateForFunder({ template = {}, funderKey = '' } = {}) {
  const key = clean(funderKey) || DEFAULT_PDF_KEY;
  if (key && key !== DEFAULT_PDF_KEY) {
    const match = listFunderPdfMappings(template).find((row) => (
      idsEqual(row.funderKey, key) || String(row.funderKey).toLowerCase() === key.toLowerCase()
    ));
    if (match?.pdfTemplate) {
      return { pdfKey: match.funderKey, pdfTemplate: match.pdfTemplate, label: match.label };
    }
  }
  if (hasPdfPath(template?.pdfTemplate)) {
    return { pdfKey: DEFAULT_PDF_KEY, pdfTemplate: template.pdfTemplate, label: 'Default' };
  }
  const first = listFunderPdfMappings(template)[0] || null;
  if (first) {
    return { pdfKey: first.funderKey, pdfTemplate: first.pdfTemplate, label: first.label };
  }
  return { pdfKey: '', pdfTemplate: null, label: '' };
}

function suggestPdfKeyForFunder({ template = {}, funderKey = '' } = {}) {
  const key = clean(funderKey);
  if (key) {
    const mapped = listFunderPdfMappings(template).find((row) => (
      idsEqual(row.funderKey, key) || String(row.funderKey).toLowerCase() === key.toLowerCase()
    ));
    if (mapped) return mapped.funderKey;
  }
  if (hasPdfPath(template?.pdfTemplate)) return DEFAULT_PDF_KEY;
  const first = listFunderPdfMappings(template)[0];
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

  if (!matches.length) return { funderKey: '', funderType: '', funderId: '' };

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
  const rows = await schoolDataService.fetchAllData('funders', {}, reqUser);
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

async function buildExportPdfSuggestions({
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

  const availablePdfOptions = buildAvailablePdfOptions(template);
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
    return {
      studentId,
      personId,
      instanceId: clean(student.instanceId),
      studentName,
      funderKey: funderKey || '',
      funderLabel,
      suggestedPdfKey: suggestPdfKeyForFunder({ template, funderKey }),
      availablePdfOptions
    };
  });

  return {
    templateId: clean(template.id),
    reportStartDate: start,
    reportDueDate: end,
    availablePdfOptions,
    hasDefaultPdf: hasPdfPath(template.pdfTemplate),
    rows
  };
}

module.exports = {
  DEFAULT_PDF_KEY,
  SELF_FUNDER_KEY,
  hasPdfPath,
  templateHasAnyPdf,
  listFunderPdfMappings,
  buildAvailablePdfOptions,
  resolvePdfTemplateForFunder,
  suggestPdfKeyForFunder,
  resolveStudentFunderForReportPeriod,
  loadActiveFunderOptions,
  buildExportPdfSuggestions
};
