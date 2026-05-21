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
  '../../../data/school/backfillClassEnrollmentPeriods.report.json'
);

function parseArgs(argv = []) {
  const flags = new Set(argv.filter((arg) => /^--/.test(arg)));
  const getArgValue = (prefix) => {
    const token = argv.find((arg) => String(arg || '').startsWith(`${prefix}=`));
    if (!token) return '';
    return String(token.slice(prefix.length + 1)).trim();
  };

  return {
    apply: flags.has('--apply'),
    orgId: getArgValue('--org'),
    reportPath: getArgValue('--report') || REPORT_PATH_DEFAULT
  };
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
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
  if (!token) return 'active';
  if (token === 'enrolled') return 'active';
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

function buildCandidateFromClassEnrollment({
  classRow,
  enrollmentRow,
  rowIndex = 0,
  nowIso,
  sourceTag = 'class_enrollment_snapshot'
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
  const cycleEndDate = asDateOnly(classRow?.cycleEndDate);
  const legacyStatus = String(enrollmentRow?.status || '').trim().toLowerCase();
  const status = mapLegacyStatusToPeriodStatus(legacyStatus || 'active');
  const endDate = withdrawnAt || ((status === 'completed' || status === 'withdrawn' || status === 'cancelled') ? (cycleEndDate || startDate) : '');
  if (endDate && endDate < startDate) {
    return { skip: true, reason: 'end_before_start' };
  }

  const enrollmentId = String(enrollmentRow?.enrollmentId || '').trim();
  const termRegistrationId = String(enrollmentRow?.termRegistrationId || '').trim();
  const naturalKey = [
    orgId,
    classId,
    studentId,
    enrollmentId || `row-${rowIndex + 1}`,
    termRegistrationId,
    startDate
  ];
  const id = stablePeriodId(naturalKey);
  const sequenceNo = Number.parseInt(String(enrollmentRow?.sequenceNo || '').trim(), 10) || (rowIndex + 1);
  const actor = String(classRow?.audit?.lastUpdateUser || classRow?.audit?.createUser || 'system').trim() || 'system';

  const reasonStart = sourceTag === 'class_enrollment_snapshot'
    ? `Backfilled from class enrollment snapshot${termRegistrationId ? ` (term registration ${termRegistrationId})` : ''}.`
    : 'Backfilled from legacy registration summary.';
  const reasonEnd = status === 'withdrawn' || status === 'cancelled'
    ? String(enrollmentRow?.notes || 'Legacy enrollment marked as ended.').trim()
    : '';

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
    reasonStart,
    reasonEnd,
    sequenceNo,
    createdBy: actor,
    updatedBy: actor,
    sourceTag,
    legacyRefs: {
      enrollmentId,
      termRegistrationId
    }
  };
}

function stripInternalFields(row) {
  const next = { ...(row || {}) };
  delete next._id;
  delete next.sourceTag;
  delete next.legacyRefs;
  return next;
}

function buildComparable(row) {
  return JSON.stringify({
    orgId: String(row?.orgId || ''),
    classId: String(row?.classId || ''),
    studentId: String(row?.studentId || ''),
    status: String(row?.status || ''),
    startDate: String(row?.startDate || ''),
    endDate: String(row?.endDate || ''),
    funderType: String(row?.funderType || ''),
    funderId: String(row?.funderId || ''),
    authorizationRef: String(row?.authorizationRef || ''),
    reasonStart: String(row?.reasonStart || ''),
    reasonEnd: String(row?.reasonEnd || ''),
    sequenceNo: Number(row?.sequenceNo || 1)
  });
}

async function ensureReportDirectory(reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAtIso = new Date().toISOString();
  const nowIso = new Date().toISOString();

  const settings = await systemSettingsRepository.getSettings({ backendMode: 'json' });
  const backend = resolveDataBackendConfig(process.env, {
    preferredMode: 'mongo',
  });
  setActiveDataBackendConfig(backend);
  const mongoConfig = backend.mongo || {};
  const mongoUri = String(mongoConfig.uri || '').trim();
  if (backend.mode !== 'mongo' || !mongoUri) {
    throw new Error('Backfill requires Mongo mode and a configured Mongo URI.');
  }

  await connectMongo({ uri: mongoUri });
  const classCollection = getMongoCollection('schoolClasses');
  const termRegistrationCollection = getMongoCollection('schoolStudentTermRegistrations');
  const periodCollection = getMongoCollection('schoolClassEnrollmentPeriods');

  const baseFilter = args.orgId ? { orgId: String(args.orgId).trim() } : {};
  const classes = await classCollection.find(baseFilter).toArray();
  const termRegistrations = await termRegistrationCollection.find(baseFilter).toArray();
  const existingPeriods = await periodCollection.find(baseFilter).toArray();
  const existingById = new Map(existingPeriods.map((row) => [String(row?.id || '').trim(), row]).filter(([id]) => id));

  const candidateMap = new Map();
  const skipped = [];
  let classSnapshotRowsScanned = 0;
  let termSummaryRowsScanned = 0;

  classes.forEach((classRow) => {
    const enrollmentRows = Array.isArray(classRow?.enrollment?.students) ? classRow.enrollment.students : [];
    enrollmentRows.forEach((enrollmentRow, index) => {
      classSnapshotRowsScanned += 1;
      const candidate = buildCandidateFromClassEnrollment({
        classRow,
        enrollmentRow,
        rowIndex: index,
        nowIso,
        sourceTag: 'class_enrollment_snapshot'
      });
      if (candidate.skip) {
        skipped.push({
          source: 'class_enrollment_snapshot',
          classId: String(classRow?.id || ''),
          rowIndex: index + 1,
          reason: candidate.reason
        });
        return;
      }
      candidateMap.set(candidate.id, candidate);
    });
  });

  termRegistrations.forEach((registration) => {
    const rows = Array.isArray(registration?.classEnrollmentSummary?.rows)
      ? registration.classEnrollmentSummary.rows
      : (Array.isArray(registration?.rosterSummary?.rows) ? registration.rosterSummary.rows : []);
    rows.forEach((row, index) => {
      termSummaryRowsScanned += 1;
      const classId = String(row?.classId || '').trim();
      const studentId = String(registration?.studentId || '').trim();
      if (!classId || !studentId) {
        skipped.push({
          source: 'term_registration_summary',
          registrationId: String(registration?.id || ''),
          rowIndex: index + 1,
          reason: 'missing_class_or_student'
        });
        return;
      }
      const classRow = classes.find((entry) => String(entry?.id || '').trim() === classId);
      const syntheticEnrollment = {
        enrollmentId: String(row?.enrollmentId || '').trim(),
        studentId,
        termRegistrationId: String(registration?.id || '').trim(),
        programRegistrationId: String(registration?.programRegistrationId || '').trim(),
        status: String(registration?.status || '').trim().toLowerCase() === 'registered' ? 'enrolled' : String(registration?.status || ''),
        enrolledAt: String(registration?.registrationDate || ''),
        notes: String(registration?.note || ''),
        feeCategory: String(registration?.feeCategorySnapshot || '')
      };
      const candidate = buildCandidateFromClassEnrollment({
        classRow: classRow || {
          id: classId,
          orgId: String(registration?.orgId || ''),
          cycleStartDate: '',
          cycleEndDate: '',
          audit: registration?.audit || {}
        },
        enrollmentRow: syntheticEnrollment,
        rowIndex: index,
        nowIso,
        sourceTag: 'term_registration_summary'
      });
      if (candidate.skip) {
        skipped.push({
          source: 'term_registration_summary',
          registrationId: String(registration?.id || ''),
          rowIndex: index + 1,
          reason: candidate.reason
        });
        return;
      }

      if (!candidateMap.has(candidate.id)) {
        candidateMap.set(candidate.id, candidate);
      }
    });
  });

  const candidates = [...candidateMap.values()];
  let wouldInsert = 0;
  let wouldUpdate = 0;
  let unchanged = 0;
  const updateOps = [];
  const nowForAudit = new Date().toISOString();

  candidates.forEach((candidate) => {
    const id = String(candidate.id || '').trim();
    if (!id) return;

    const existing = existingById.get(id);
    const actor = String(candidate.updatedBy || candidate.createdBy || 'system').trim() || 'system';
    let doc;

    if (existing) {
      doc = {
        ...existing,
        ...stripInternalFields(candidate),
        id,
        createdBy: String(existing?.createdBy || existing?.audit?.createUser || candidate.createdBy || 'system'),
        updatedBy: actor,
        audit: {
          ...(isObject(existing?.audit) ? existing.audit : {}),
          createUser: String(existing?.audit?.createUser || existing?.createdBy || candidate.createdBy || 'system'),
          createDateTime: String(existing?.audit?.createDateTime || nowForAudit),
          lastUpdateUser: actor,
          lastUpdateDateTime: nowForAudit
        }
      };
      if (buildComparable(existing) !== buildComparable(doc)) {
        wouldUpdate += 1;
      } else {
        unchanged += 1;
      }
    } else {
      wouldInsert += 1;
      doc = {
        ...stripInternalFields(candidate),
        createdBy: String(candidate.createdBy || 'system'),
        updatedBy: actor,
        audit: {
          createUser: String(candidate.createdBy || 'system'),
          createDateTime: nowForAudit,
          lastUpdateUser: actor,
          lastUpdateDateTime: nowForAudit
        }
      };
    }

    updateOps.push({
      replaceOne: {
        filter: { id },
        replacement: doc,
        upsert: true
      }
    });
  });

  let applied = false;
  let writeResult = null;
  if (args.apply && updateOps.length) {
    writeResult = await periodCollection.bulkWrite(updateOps, { ordered: false });
    applied = true;
  }

  const report = {
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry_run',
    orgFilter: args.orgId || null,
    scanned: {
      classes: classes.length,
      termRegistrations: termRegistrations.length,
      classSnapshotRows: classSnapshotRowsScanned,
      termSummaryRows: termSummaryRowsScanned
    },
    candidates: {
      total: candidates.length,
      fromClassSnapshot: candidates.filter((row) => row.sourceTag === 'class_enrollment_snapshot').length,
      fromTermSummaryOnly: candidates.filter((row) => row.sourceTag === 'term_registration_summary').length
    },
    diff: {
      wouldInsert,
      wouldUpdate,
      unchanged,
      skipped: skipped.length
    },
    apply: applied ? {
      matched: Number(writeResult?.matchedCount || 0),
      modified: Number(writeResult?.modifiedCount || 0),
      upserted: Number(writeResult?.upsertedCount || 0)
    } : null,
    skipped: skipped.slice(0, 200)
  };

  await ensureReportDirectory(args.reportPath);
  await fs.writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('[BackfillClassEnrollmentPeriods] Completed.');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(async () => {
    await disconnectMongo().catch(() => {});
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`[BackfillClassEnrollmentPeriods] Failed: ${error.message}`);
    await disconnectMongo().catch(() => {});
    process.exit(1);
  });
