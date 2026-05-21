/* eslint-disable no-console */
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { resolveDataBackendConfig } = require('../../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../MVC/infrastructure/mongo/mongoConnection');
const systemSettingsRepository = require('../../../MVC/repositories/systemSettingsRepository');

const REPORT_PATH_DEFAULT = path.join(
  __dirname,
  '../../../data/school/classRegistrationModeMigration.report.json'
);

function parseListArg(value) {
  return String(value || '')
    .split(',')
    .map((token) => String(token || '').trim())
    .filter(Boolean);
}

function parseArgs(argv = []) {
  const flags = new Set(argv.filter((arg) => /^--/.test(arg)));
  const getArgValue = (prefix) => {
    const token = argv.find((arg) => String(arg || '').startsWith(`${prefix}=`));
    if (!token) return '';
    return String(token.slice(prefix.length + 1)).trim();
  };

  const convertList = [
    ...parseListArg(getArgValue('--convert-rolling')),
    ...parseListArg(getArgValue('--rolling-classes'))
  ];

  return {
    apply: flags.has('--apply'),
    derivePeriods: flags.has('--derive-periods'),
    orgId: getArgValue('--org'),
    reportPath: getArgValue('--report') || REPORT_PATH_DEFAULT,
    convertRollingClassIds: [...new Set(convertList)]
  };
}

function normalizeRegistrationMode(value) {
  return String(value || '').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

function asDateOnly(value) {
  if (!value) return '';
  const token = String(value).trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function mapLegacyStatusToPeriodStatus(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token || token === 'enrolled') return 'active';
  if (token === 'waitlisted') return 'planned';
  if (token === 'withdrawn') return 'withdrawn';
  if (token === 'cancelled') return 'cancelled';
  if (token === 'completed') return 'completed';
  if (token === 'draft') return 'draft';
  if (token === 'planned') return 'planned';
  if (token === 'active') return 'active';
  if (token === 'archived') return 'archived';
  if (token === 'error') return 'error';
  return 'active';
}

function stablePeriodId(parts = []) {
  const digest = crypto
    .createHash('sha1')
    .update(parts.map((row) => String(row || '').trim()).join('|'))
    .digest('hex')
    .slice(0, 20)
    .toUpperCase();
  return `CEP-${digest}`;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(token);
}

function buildFirstPeriodCandidate({
  classRow,
  enrollmentRow,
  rowIndex = 0,
  nowIso,
  actor = 'system'
}) {
  const orgId = String(classRow?.orgId || '').trim();
  const classId = String(classRow?.id || '').trim();
  const studentId = String(enrollmentRow?.studentId || '').trim();
  if (!orgId || !classId || !studentId) {
    return { skip: true, reason: 'missing_org_class_or_student' };
  }

  const enrolledAt = asDateOnly(enrollmentRow?.enrolledAt);
  const pricingDate = asDateOnly(enrollmentRow?.pricing?.effectiveDate);
  const cycleStartDate = asDateOnly(classRow?.cycleStartDate);
  const startDate = enrolledAt || pricingDate || cycleStartDate || nowIso.slice(0, 10);
  const withdrawnAt = asDateOnly(enrollmentRow?.withdrawnAt);
  const legacyStatus = String(enrollmentRow?.status || '').trim().toLowerCase();
  const status = mapLegacyStatusToPeriodStatus(legacyStatus || 'active');
  const endDate = withdrawnAt || ((status === 'completed' || status === 'withdrawn' || status === 'cancelled') ? startDate : '');
  if (endDate && endDate < startDate) {
    return { skip: true, reason: 'end_before_start' };
  }

  const enrollmentId = String(enrollmentRow?.enrollmentId || '').trim();
  const naturalKey = [orgId, classId, studentId, enrollmentId || `row-${rowIndex + 1}`, startDate, 'rolling-conversion-first-period'];
  const id = stablePeriodId(naturalKey);

  return {
    skip: false,
    id,
    orgId,
    classId,
    studentId,
    status,
    startDate,
    endDate,
    funderType: String(enrollmentRow?.feeCategory || '').trim(),
    funderId: String(enrollmentRow?.funderId || '').trim(),
    authorizationRef: String(enrollmentRow?.authorizationRef || enrollmentRow?.programRegistrationId || '').trim(),
    reasonStart: 'Derived first period from class enrollment snapshot during rolling conversion.',
    reasonEnd: status === 'withdrawn' || status === 'cancelled'
      ? String(enrollmentRow?.notes || 'Legacy enrollment marked as ended.').trim()
      : '',
    sequenceNo: 1,
    createdBy: actor,
    updatedBy: actor
  };
}

async function ensureReportDirectory(reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
}

function summarizeTopRows(rows = [], limit = 200) {
  return Array.isArray(rows) ? rows.slice(0, limit) : [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAtIso = new Date().toISOString();
  const nowIso = new Date().toISOString();
  const rollingSet = new Set(args.convertRollingClassIds.map((id) => String(id || '').trim()).filter(Boolean));

  const settings = await systemSettingsRepository.getSettings({ backendMode: 'json' });
  const backend = resolveDataBackendConfig(process.env, {
    preferredMode: 'mongo',
  });
  setActiveDataBackendConfig(backend);
  const mongoConfig = backend.mongo || {};
  const mongoUri = String(mongoConfig.uri || '').trim();
  if (backend.mode !== 'mongo' || !mongoUri) {
    throw new Error('Migration requires Mongo mode and a configured Mongo URI.');
  }

  await connectMongo({ uri: mongoUri });
  const classCollection = getMongoCollection('schoolClasses');
  const periodCollection = getMongoCollection('schoolClassEnrollmentPeriods');

  const baseFilter = args.orgId ? { orgId: String(args.orgId).trim() } : {};
  const classes = await classCollection.find(baseFilter).toArray();
  const existingPeriods = await periodCollection.find(baseFilter).toArray();
  const existingPeriodKeySet = new Set(
    existingPeriods
      .map((row) => `${String(row?.orgId || '').trim()}::${String(row?.classId || '').trim()}::${String(row?.studentId || '').trim()}`)
      .filter((key) => key !== '::::')
  );

  const classOps = [];
  const classChanges = [];
  let classesAlreadyAligned = 0;
  const missingRollingClasses = [];

  const periodCandidates = [];
  const periodSkips = [];

  for (const classRow of classes) {
    const classId = String(classRow?.id || '').trim();
    const orgId = String(classRow?.orgId || '').trim();
    const currentMode = normalizeRegistrationMode(classRow?.registrationMode);
    const targetMode = rollingSet.has(classId) ? 'rolling' : 'term_based';
    const actor = String(classRow?.audit?.lastUpdateUser || classRow?.audit?.createUser || 'system').trim() || 'system';

    const setPatch = {};
    if (currentMode !== targetMode || String(classRow?.registrationMode || '').trim() !== targetMode) {
      setPatch.registrationMode = targetMode;
    }

    if (targetMode === 'rolling') {
      const cycleGroupId = String(classRow?.cycleGroupId || '').trim();
      const cycleNoRaw = Number.parseInt(String(classRow?.cycleNo || '').trim(), 10);
      if (!cycleGroupId) setPatch.cycleGroupId = classId;
      if (!Number.isFinite(cycleNoRaw) || cycleNoRaw <= 0) setPatch.cycleNo = 1;
      if (!asDateOnly(classRow?.cycleStartDate)) {
        const classStart = asDateOnly(classRow?.schedule?.current?.startDate);
        if (classStart) setPatch.cycleStartDate = classStart;
      }
      if (!Object.prototype.hasOwnProperty.call(classRow || {}, 'isClosedForNewEnrollment')) {
        setPatch.isClosedForNewEnrollment = toBoolean(classRow?.isClosedForNewEnrollment, false);
      }
    }

    if (Object.keys(setPatch).length) {
      classChanges.push({
        classId,
        orgId,
        fromMode: currentMode,
        toMode: targetMode,
        setPatch
      });
      classOps.push({
        updateOne: {
          filter: { id: classId, ...(orgId ? { orgId } : {}) },
          update: {
            $set: {
              ...setPatch,
              updatedBy: actor,
              'audit.lastUpdateUser': actor,
              'audit.lastUpdateDateTime': nowIso
            }
          }
        }
      });
    } else {
      classesAlreadyAligned += 1;
    }

    if (targetMode === 'rolling' && args.derivePeriods) {
      const enrollmentRows = Array.isArray(classRow?.enrollment?.students) ? classRow.enrollment.students : [];
      const candidateByStudent = new Map();
      enrollmentRows.forEach((enrollmentRow, index) => {
        const candidate = buildFirstPeriodCandidate({
          classRow,
          enrollmentRow,
          rowIndex: index,
          nowIso,
          actor
        });
        if (candidate.skip) {
          periodSkips.push({
            classId,
            studentId: String(enrollmentRow?.studentId || '').trim(),
            reason: candidate.reason
          });
          return;
        }

        const studentKey = `${candidate.orgId}::${candidate.classId}::${candidate.studentId}`;
        if (existingPeriodKeySet.has(studentKey)) {
          periodSkips.push({
            classId,
            studentId: candidate.studentId,
            reason: 'existing_period_for_student'
          });
          return;
        }

        const existingCandidate = candidateByStudent.get(studentKey);
        if (!existingCandidate || String(candidate.startDate || '') < String(existingCandidate.startDate || '')) {
          candidateByStudent.set(studentKey, candidate);
        }
      });

      periodCandidates.push(...candidateByStudent.values());
    }
  }

  for (const classId of rollingSet) {
    if (!classes.some((row) => String(row?.id || '').trim() === classId)) {
      missingRollingClasses.push(classId);
    }
  }

  const periodOps = periodCandidates.map((candidate) => ({
    updateOne: {
      filter: { id: candidate.id },
      update: {
        $setOnInsert: {
          ...candidate,
          audit: {
            createUser: String(candidate.createdBy || 'system'),
            createDateTime: nowIso,
            lastUpdateUser: String(candidate.updatedBy || 'system'),
            lastUpdateDateTime: nowIso
          }
        }
      },
      upsert: true
    }
  }));

  const dryRunPreview = {
    classes: {
      scanned: classes.length,
      wouldUpdate: classOps.length,
      alreadyAligned: classesAlreadyAligned,
      setTermBasedCount: classChanges.filter((row) => row.toMode === 'term_based').length,
      setRollingCount: classChanges.filter((row) => row.toMode === 'rolling').length
    },
    rollingConversion: {
      requestedClassCount: rollingSet.size,
      missingClassIds: missingRollingClasses,
      derivePeriodsEnabled: Boolean(args.derivePeriods),
      periodCandidates: periodCandidates.length,
      periodSkips: periodSkips.length
    }
  };

  let classWriteResult = null;
  let periodWriteResult = null;
  if (args.apply) {
    if (classOps.length) {
      classWriteResult = await classCollection.bulkWrite(classOps, { ordered: false });
    }
    if (periodOps.length) {
      periodWriteResult = await periodCollection.bulkWrite(periodOps, { ordered: false });
    }
  }

  const report = {
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry_run',
    orgFilter: args.orgId || null,
    dryRunPreview,
    apply: args.apply
      ? {
          classes: {
            matched: Number(classWriteResult?.matchedCount || 0),
            modified: Number(classWriteResult?.modifiedCount || 0),
            upserted: Number(classWriteResult?.upsertedCount || 0)
          },
          periods: {
            matched: Number(periodWriteResult?.matchedCount || 0),
            modified: Number(periodWriteResult?.modifiedCount || 0),
            upserted: Number(periodWriteResult?.upsertedCount || 0)
          }
        }
      : null,
    sample: {
      classChanges: summarizeTopRows(classChanges),
      periodCandidates: summarizeTopRows(periodCandidates),
      periodSkips: summarizeTopRows(periodSkips)
    }
  };

  await ensureReportDirectory(args.reportPath);
  await fs.writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('[MigrateClassRegistrationMode] Completed.');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(async () => {
    await disconnectMongo().catch(() => {});
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`[MigrateClassRegistrationMode] Failed: ${error.message}`);
    await disconnectMongo().catch(() => {});
    process.exit(1);
  });
