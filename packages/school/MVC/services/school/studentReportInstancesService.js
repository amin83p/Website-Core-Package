'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const reportViewService = require('./reportViewService');

function buildPersonReportsFullListUrl(personId) {
  const pid = toPublicId(personId);
  if (!pid) return '/school/reports/person-reports';
  const params = new URLSearchParams();
  params.set('scope', 'student');
  params.set('personId', pid);
  return `/school/reports/person-reports?${params.toString()}`;
}

function mapStudentReportInstanceRow(row = {}) {
  const instanceId = toPublicId(row?.id);
  const status = String(row?.status || 'draft').trim().toLowerCase() || 'draft';
  return {
    id: instanceId,
    assignmentId: toPublicId(row?.assignmentId),
    classId: toPublicId(row?.classId),
    classTitle: String(row?.classTitle || row?.classId || '-').trim(),
    sessionDate: String(row?.sessionDate || '').trim(),
    templateId: toPublicId(row?.templateId),
    templateTitle: String(row?.templateTitle || row?.templateId || '-').trim(),
    templateVersion: Number(row?.templateVersion || 1) || 1,
    teacherId: toPublicId(row?.teacherId),
    teacherName: String(row?.teacherName || row?.teacherId || '-').trim(),
    studentId: toPublicId(row?.studentId),
    studentName: String(row?.studentName || '').trim(),
    status,
    openUrl: instanceId ? `/school/reports/instances/edit/${encodeURIComponent(instanceId)}` : '',
    openV2Url: instanceId ? `/school/reports/instances/edit-v2/${encodeURIComponent(instanceId)}` : ''
  };
}

/**
 * List report instances for a student form tab.
 * Filters by person id (reportInstances.studentId), not the student record id.
 */
async function listStudentReportInstancesForForm({ reqUser, personId } = {}) {
  const requestedPersonId = toPublicId(personId);
  const empty = {
    rows: [],
    fullListUrl: buildPersonReportsFullListUrl(requestedPersonId),
    accessNote: '',
    isAdminViewer: false
  };
  if (!requestedPersonId) return empty;

  try {
    const context = await reportViewService.buildPersonReportListContext({
      reqUser,
      requestedScope: 'student',
      requestedPersonId
    });
    const isAdminViewer = context?.isAdminViewer === true;
    const effectivePersonId = toPublicId(context?.selectedPersonId);
    if (!isAdminViewer && (!effectivePersonId || !idsEqual(effectivePersonId, requestedPersonId))) {
      return {
        ...empty,
        isAdminViewer: false,
        accessNote: 'Report instances for this student are only listed for report administrators. Open the student reports page if you have access.'
      };
    }

    const rows = (Array.isArray(context?.rows) ? context.rows : [])
      .filter((row) => idsEqual(row?.studentId, requestedPersonId))
      .map(mapStudentReportInstanceRow);

    return {
      rows,
      fullListUrl: buildPersonReportsFullListUrl(requestedPersonId),
      accessNote: '',
      isAdminViewer
    };
  } catch (_) {
    return {
      ...empty,
      accessNote: 'Unable to load report instances for this student right now.'
    };
  }
}

module.exports = {
  buildPersonReportsFullListUrl,
  mapStudentReportInstanceRow,
  listStudentReportInstancesForForm
};
