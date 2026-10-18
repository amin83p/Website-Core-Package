const schoolDataService = require('./schoolDataService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const weeklyReportsHubService = require('./weeklyReportsHubService');
const { buildAttendanceMatrixPayload } = require('../../controllers/school/attendanceController');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function parseClassIdList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => toPublicId(item)).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => toPublicId(item.trim()))
    .filter(Boolean);
}

function roundOneDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function sessionSpanMinutesForRecord(record, classData, orgPolicyLayer) {
  const policy = attendanceMatrixMetricsService.resolvePolicyForScheduledMinutes(
    classData,
    orgPolicyLayer,
    record?.scheduledMinutes
  );
  const recSched = Number(record?.scheduledMinutes);
  const span = Number.isFinite(recSched) && recSched > 0
    ? recSched
    : Math.max(0, Number(policy?.scheduledMinutes) || 0);
  return { policy, span };
}

function summarizeEngagementFromStudentMatrixRow(studentRow = {}, classData = {}, orgPolicyLayer = {}) {
  const records = Array.isArray(studentRow?.records) ? studentRow.records : [];
  const totals = attendanceMatrixMetricsService.computeStudentEngagementMinutes(
    records,
    classData,
    orgPolicyLayer
  );

  return {
    presentMinutes: roundOneDecimal(totals.presentMinutes),
    scheduledMinutes: roundOneDecimal(totals.scheduledMinutes),
    percent: totals.percent != null ? roundOneDecimal(totals.percent) : null
  };
}

function summarizeEngagementFromMatrix(matrix = [], classData = {}, orgPolicyLayer = {}) {
  let presentMinutes = 0;
  let scheduledMinutes = 0;

  (Array.isArray(matrix) ? matrix : []).forEach((studentRow) => {
    const rowEngagement = summarizeEngagementFromStudentMatrixRow(studentRow, classData, orgPolicyLayer);
    presentMinutes += Number(rowEngagement.presentMinutes || 0);
    scheduledMinutes += Number(rowEngagement.scheduledMinutes || 0);
  });

  const percent = scheduledMinutes > 0
    ? roundOneDecimal((presentMinutes / scheduledMinutes) * 100)
    : null;

  return {
    presentMinutes: roundOneDecimal(presentMinutes),
    scheduledMinutes: roundOneDecimal(scheduledMinutes),
    percent
  };
}

function mergeEngagementTotals(target, addition) {
  const next = target || { presentMinutes: 0, scheduledMinutes: 0, percent: null };
  const add = addition || {};
  next.presentMinutes = roundOneDecimal(Number(next.presentMinutes || 0) + Number(add.presentMinutes || 0));
  next.scheduledMinutes = roundOneDecimal(Number(next.scheduledMinutes || 0) + Number(add.scheduledMinutes || 0));
  next.percent = next.scheduledMinutes > 0
    ? roundOneDecimal((next.presentMinutes / next.scheduledMinutes) * 100)
    : null;
  return next;
}

/** Teacher/group ring: simple average of each class percent (null counts as 0). */
function averageClassEngagementPercent(classResults = []) {
  const list = Array.isArray(classResults) ? classResults : [];
  if (!list.length) return null;
  const sum = list.reduce((total, row) => {
    const pct = row && row.percent != null ? Number(row.percent) : 0;
    return total + (Number.isFinite(pct) ? pct : 0);
  }, 0);
  return roundOneDecimal(sum / list.length);
}

async function buildEngagementForClasses({
  reqUser,
  classIds = [],
  startDate = '',
  endDate = ''
} = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const normalizedClassIds = parseClassIdList(classIds);
  const normalizedStartDate = String(startDate || '').trim();
  const normalizedEndDate = String(endDate || '').trim();

  if (!normalizedClassIds.length) {
    return {
      presentMinutes: 0,
      scheduledMinutes: 0,
      percent: null,
      classCount: 0,
      classes: []
    };
  }

  let totals = { presentMinutes: 0, scheduledMinutes: 0, percent: null };
  const classResults = [];
  let processedCount = 0;

  for (const classId of normalizedClassIds) {
    try {
      const classes = await weeklyReportsHubService.resolveWeeklyReportsClasses({
        reqUser,
        classIds: [classId],
        activeOrgId
      });
      const classRow = classes.find((row) => idsEqual(row?.id, classId)) || classes[0];
      if (!classRow) continue;

      const statusMap = await sessionStatusPolicyService.getStatusMap(
        classRow?.orgId || activeOrgId,
        { includeInactive: true }
      );
      const allSessions = await schoolDataService.getClassSessions(classId, reqUser);
      const filteredSessions = weeklyReportsHubService.filterSessionsForWeeklyReport({
        sessions: allSessions,
        statusMap,
        startDate: normalizedStartDate,
        endDate: normalizedEndDate
      });
      if (!filteredSessions.length) {
        classResults.push({
          classId,
          presentMinutes: 0,
          scheduledMinutes: 0,
          percent: null
        });
        processedCount += 1;
        continue;
      }

      const payload = await buildAttendanceMatrixPayload({
        user: reqUser,
        query: {
          classId,
          startDate: normalizedStartDate,
          endDate: normalizedEndDate
        }
      }, { applyWindow: false });

      const orgPolicyCatalog = await attendanceMatrixPolicyModel.getPolicyCatalogForOrg(
        classRow?.orgId || activeOrgId
      );

      const classEngagement = summarizeEngagementFromMatrix(
        payload?.matrix || [],
        classRow,
        orgPolicyCatalog
      );
      totals = mergeEngagementTotals(totals, classEngagement);
      classResults.push({
        classId,
        presentMinutes: classEngagement.presentMinutes,
        scheduledMinutes: classEngagement.scheduledMinutes,
        percent: classEngagement.percent
      });
      processedCount += 1;
    } catch (error) {
      console.warn(`[weeklyReportsEngagementService] Skipping class ${classId}: ${error.message}`);
    }
  }

  return {
    presentMinutes: totals.presentMinutes,
    scheduledMinutes: totals.scheduledMinutes,
    percent: averageClassEngagementPercent(classResults),
    classCount: processedCount,
    classes: classResults
  };
}

module.exports = {
  summarizeEngagementFromStudentMatrixRow,
  summarizeEngagementFromMatrix,
  mergeEngagementTotals,
  averageClassEngagementPercent,
  buildEngagementForClasses,
  parseClassIdList
};
