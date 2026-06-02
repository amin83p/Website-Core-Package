const schoolRepositories = require('../../repositories/school');
const academicSnapshotService = require('./academicSnapshotService');
const academicRuleResolverService = require('./academicRuleResolverService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { recordTransactionOperation } = requireCoreModule('MVC/services/transactionContextService');

function nowDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildCommonEntry({
  reqUser,
  orgId,
  studentId,
  personId,
  programId,
  termId = '',
  classId = '',
  subjectId = '',
  entryType,
  effectiveDate,
  memo,
  note = '',
  quantities = {},
  academic = {},
  ruleSnapshot = {},
  source
}) {
  return {
    orgId: String(orgId || ''),
    studentId: String(studentId || ''),
    personId: String(personId || ''),
    programId: String(programId || ''),
    termId: String(termId || ''),
    classId: String(classId || ''),
    subjectId: String(subjectId || ''),
    entryType,
    status: 'posted',
    effectiveDate: String(effectiveDate || nowDate()),
    postedAt: new Date().toISOString(),
    quantities,
    academic,
    ruleSnapshot,
    source: {
      module: String(source?.module || 'school_academic'),
      eventType: String(source?.eventType || entryType),
      eventId: String(source?.eventId || `${entryType}-${Date.now()}`),
      idempotencyKey: String(source?.idempotencyKey || `${entryType}|${studentId}|${programId}|${termId}|${classId}|${subjectId}|${effectiveDate || nowDate()}`)
    },
    memo: String(memo || '').trim(),
    note: String(note || '').trim(),
    audit: {
      createUser: String(reqUser?.id || reqUser?.username || 'system'),
      createDateTime: new Date().toISOString()
    }
  };
}

async function postEntriesAndRefresh(entries, options = {}) {
  const created = await schoolRepositories.academicLedger.addEntries(entries, options);
  recordTransactionOperation(options, {
    type: 'create',
    entityType: 'academicLedger',
    size: Array.isArray(created) ? created.length : 1
  });
  const rebuildTargets = new Set(
    created
      .filter((entry) => entry.studentId && entry.programId)
      .map((entry) => `${entry.studentId}::${entry.programId}`)
  );

  for (const target of rebuildTargets) {
    const [studentId, programId] = target.split('::');
    await academicSnapshotService.rebuildStudentProgramSnapshot(studentId, programId);
  }

  return created;
}

async function postProgramRegistration({ reqUser, student, program, effectiveDate, note = '', source = {}, options = {} }) {
  const entry = buildCommonEntry({
    reqUser,
    orgId: program.orgId || student.orgId,
    studentId: student.id,
    personId: student.personId,
    programId: program.id,
    entryType: 'program_registered',
    effectiveDate,
    memo: `Program registered: ${program.name || program.code || program.id}`,
    note,
    academic: { standing: 'active' },
    source: { module: 'school_program_registration', ...source }
  });
  return postEntriesAndRefresh([entry], options);
}

async function postTermRegistration({ reqUser, student, program, term, effectiveDate, note = '', source = {}, options = {} }) {
  const termRule = academicRuleResolverService.resolveTermRule(program, term.id || term.termId);
  const entry = buildCommonEntry({
    reqUser,
    orgId: program.orgId || student.orgId,
    studentId: student.id,
    personId: student.personId,
    programId: program.id,
    termId: term.id || term.termId,
    entryType: 'term_registered',
    effectiveDate,
    memo: `Term registered: ${term.name || term.termName || term.termId}`,
    note,
    academic: { standing: 'active' },
    ruleSnapshot: {
      minPassingScore: termRule?.minimumPassingScore ?? null,
      minPassingAverage: termRule?.minimumPassingAverage ?? null,
      mustPass: false,
      allowCompensation: false
    },
    source: { module: 'school_term_registration', ...source }
  });
  return postEntriesAndRefresh([entry], options);
}

async function postClassEnrollment({
  reqUser,
  student,
  program,
  termId,
  classItem,
  subjectId = '',
  subjectType = '',
  creditsAttempted = null,
  effectiveDate,
  note = '',
  source = {},
  options = {}
}) {
  const entry = buildCommonEntry({
    reqUser,
    orgId: program.orgId || student.orgId,
    studentId: student.id,
    personId: student.personId,
    programId: program.id,
    termId,
    classId: classItem.id,
    subjectId,
    entryType: 'class_enrolled',
    effectiveDate,
    memo: `Class enrolled: ${classItem.title || classItem.code || classItem.id}`,
    note,
    quantities: { creditsAttempted },
    academic: { subjectType, standing: 'active' },
    source: { module: 'school_class_enrollment', ...source }
  });
  return postEntriesAndRefresh([entry], options);
}

async function postScoreResult({
  reqUser,
  student,
  program,
  termId = '',
  classId = '',
  subjectId,
  score,
  average = null,
  result = '',
  creditsEarned = null,
  creditsAttempted = null,
  effectiveDate,
  note = '',
  source = {},
  options = {}
}) {
  const ruleSnapshot = academicRuleResolverService.buildRuleSnapshot({ program, termId, subjectId });
  const subjectRule = academicRuleResolverService.resolveProgramSubjectRule(program, subjectId);
  const posted = [];

  posted.push(buildCommonEntry({
    reqUser,
    orgId: program.orgId || student.orgId,
    studentId: student.id,
    personId: student.personId,
    programId: program.id,
    termId,
    classId,
    subjectId,
    entryType: 'score_posted',
    effectiveDate,
    memo: `Score posted for subject ${subjectId}`,
    note,
    quantities: { score, average, creditsAttempted },
    academic: {
      subjectType: subjectRule?.subjectType || '',
      result: result || '',
      standing: 'active'
    },
    ruleSnapshot,
    source: { module: 'school_gradebook', ...source }
  }));

  const normalizedResult = String(result || '').trim().toLowerCase();
  if (normalizedResult === 'pass' || normalizedResult === 'fail') {
    posted.push(buildCommonEntry({
      reqUser,
      orgId: program.orgId || student.orgId,
      studentId: student.id,
      personId: student.personId,
      programId: program.id,
      termId,
      classId,
      subjectId,
      entryType: normalizedResult === 'pass' ? 'subject_passed' : 'subject_failed',
      effectiveDate,
      memo: `Subject ${normalizedResult}: ${subjectId}`,
      quantities: {
        score,
        average,
        creditsAttempted,
        creditsEarned: normalizedResult === 'pass' ? creditsEarned : 0
      },
      academic: {
        subjectType: subjectRule?.subjectType || '',
        result: normalizedResult,
        standing: 'active'
      },
      ruleSnapshot,
      source: {
        module: 'school_gradebook',
        eventType: normalizedResult === 'pass' ? 'subject_passed' : 'subject_failed',
        eventId: `${source?.eventId || `score-${Date.now()}`}-${normalizedResult}`,
        idempotencyKey: `${source?.idempotencyKey || `score|${student.id}|${program.id}|${subjectId}|${effectiveDate || nowDate()}`}|${normalizedResult}`
      }
    }));

    if (normalizedResult === 'pass' && creditsEarned !== null && creditsEarned !== undefined) {
      posted.push(buildCommonEntry({
        reqUser,
        orgId: program.orgId || student.orgId,
        studentId: student.id,
        personId: student.personId,
        programId: program.id,
        termId,
        classId,
        subjectId,
        entryType: 'credits_awarded',
        effectiveDate,
        memo: `Credits awarded for ${subjectId}`,
        quantities: {
          creditsAttempted,
          creditsEarned
        },
        academic: {
          subjectType: subjectRule?.subjectType || '',
          result: 'pass',
          standing: 'active'
        },
        ruleSnapshot,
        source: {
          module: 'school_gradebook',
          eventType: 'credits_awarded',
          eventId: `${source?.eventId || `score-${Date.now()}`}-credits`,
          idempotencyKey: `${source?.idempotencyKey || `score|${student.id}|${program.id}|${subjectId}|${effectiveDate || nowDate()}`}|credits`
        }
      }));
    }
  }

  return postEntriesAndRefresh(posted, options);
}

module.exports = {
  postProgramRegistration,
  postTermRegistration,
  postClassEnrollment,
  postScoreResult
};
