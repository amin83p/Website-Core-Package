const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => toPublicId(v)).filter(Boolean))];
}

/**
 * Active prior-learning / transfer / placement credits for this student+program
 * (stored in studentProgramPriorSubjects). Merged into snapshot passedSubjects for prerequisites.
 */
async function fetchActivePriorSubjectCreditsForSnapshot(studentId, programId) {
  const sid = toPublicId(studentId);
  const pid = toPublicId(programId);
  if (!sid || !pid) return { subjectIds: [], orgIdHint: '' };

  const rows = await schoolRepositories.studentProgramPriorSubjects.list({
    query: {
      studentId__eq: sid,
      programId__eq: pid,
      page: 1,
      limit: 2000
    },
    scope: { canViewAll: true }
  });

  const list = Array.isArray(rows) ? rows : [];
  const active = list.filter((row) => String(row?.status || '').trim().toLowerCase() === 'active');
  const orgIdHint = toPublicId(active.find((r) => r?.orgId)?.orgId) || '';
  return {
    subjectIds: unique(active.map((row) => row.subjectId)),
    orgIdHint
  };
}

async function rebuildStudentProgramSnapshot(studentId, programId) {
  const entries = await schoolRepositories.academicLedger.list({
    query: {
      studentId__eq: studentId,
      programId__eq: programId,
      sort: 'postedAt,sequenceNo',
      order: 'asc'
    },
    scope: { canViewAll: true }
  });

  const credits = entries.reduce((acc, entry) => {
    const subjectType = String(entry?.academic?.subjectType || '').trim().toLowerCase();
    const attempted = Number(entry?.quantities?.creditsAttempted || 0);
    const earned = Number(entry?.quantities?.creditsEarned || 0);
    if (Number.isFinite(attempted)) acc.attempted += attempted;
    if (Number.isFinite(earned)) acc.earned += earned;
    if (Number.isFinite(earned)) {
      if (subjectType === 'main') acc.mainEarned += earned;
      else if (subjectType === 'essential') acc.essentialEarned += earned;
      else if (subjectType === 'optional') acc.optionalEarned += earned;
    }
    return acc;
  }, {
    attempted: 0,
    earned: 0,
    mainEarned: 0,
    essentialEarned: 0,
    optionalEarned: 0
  });

  const latestEntry = entries[entries.length - 1] || null;
  const ledgerPassedSubjects = unique(
    entries
      .filter((entry) => String(entry?.academic?.result || '') === 'pass')
      .map((entry) => entry.subjectId)
  );
  const { subjectIds: priorSubjectIds, orgIdHint: priorOrgIdHint } = await fetchActivePriorSubjectCreditsForSnapshot(
    studentId,
    programId
  );

  const snapshot = {
    studentId: toPublicId(studentId),
    programId: toPublicId(programId),
    orgId: latestEntry?.orgId || priorOrgIdHint || '',
    personId: latestEntry?.personId || '',
    currentTermId: latestEntry?.termId || '',
    standing: String(latestEntry?.academic?.standing || 'pending'),
    credits: {
      attempted: Number(credits.attempted.toFixed(2)),
      earned: Number(credits.earned.toFixed(2)),
      mainEarned: Number(credits.mainEarned.toFixed(2)),
      essentialEarned: Number(credits.essentialEarned.toFixed(2)),
      optionalEarned: Number(credits.optionalEarned.toFixed(2))
    },
    results: {
      passedSubjects: unique([...ledgerPassedSubjects, ...priorSubjectIds]),
      failedSubjects: unique(entries.filter((entry) => String(entry?.academic?.result || '') === 'fail').map((entry) => entry.subjectId)),
      activeClasses: unique(entries.filter((entry) => String(entry.entryType || '') === 'class_enrolled').map((entry) => entry.classId))
    },
    latestEntryId: latestEntry?.id || '',
    lastRebuiltAt: new Date().toISOString()
  };

  const existingRows = await schoolRepositories.academicSnapshots.list({
    query: {
      studentId__eq: snapshot.studentId,
      programId__eq: snapshot.programId,
      page: 1,
      limit: 1
    },
    scope: { canViewAll: true }
  });
  const existing = Array.isArray(existingRows) && existingRows.length ? existingRows[0] : null;

  if (existing?.id) {
    return schoolRepositories.academicSnapshots.update(existing.id, snapshot);
  }
  return schoolRepositories.academicSnapshots.create(snapshot);
}

module.exports = {
  rebuildStudentProgramSnapshot
};
