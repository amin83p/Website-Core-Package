const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const academicSnapshotModel = require('../../models/school/academicSnapshotModel');
const academicLedgerModel = require('../../models/school/academicLedgerModel');
const academicLedgerService = require('../../services/school/academicLedgerService');
const academicSnapshotService = require('../../services/school/academicSnapshotService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
const studentAcademicOverviewService = require('../../services/school/studentAcademicOverviewService');
const studentEnrollmentDetailService = require('../../services/school/studentEnrollmentDetailService');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');

function getProgramSubject(program, subjectId) {
  return (Array.isArray(program?.subjects) ? program.subjects : []).find((subject) => idsEqual(subject.subjectId || '', subjectId || '')) || null;
}

function normalizeMultiValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (value === undefined || value === null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function matchesAny(value, allowedValues) {
  if (!allowedValues.length) return true;
  return allowedValues.includes(String(value || ''));
}

function matchesAnyId(value, allowedValues) {
  if (!allowedValues.length) return true;
  return allowedValues.some((allowed) => idsEqual(value, allowed));
}

function hasLedgerFetchCriteria(filters) {
  if (String(filters.effectiveFrom || '').trim()) return true;
  if (String(filters.effectiveTo || '').trim()) return true;
  if (String(filters.postedFrom || '').trim()) return true;
  if (String(filters.postedTo || '').trim()) return true;
  if (String(filters.search || '').trim()) return true;
  if ((filters.programIds || []).length) return true;
  if ((filters.studentIds || []).length) return true;
  if ((filters.termIds || []).length) return true;
  if ((filters.classIds || []).length) return true;
  if ((filters.entryTypes || []).length) return true;
  if ((filters.statuses || []).length) return true;
  return false;
}

function formatStudentName(person, student) {
  return schoolPersonAccessService.formatPersonName(person, String(student?.id || ''));
}

function sendGuardedResponse(res, guardResult, duplicateMessage, duplicateStatus = 409) {
  if (!guardResult || guardResult.status === 'acquired') return false;
  if (guardResult.status === 'busy') {
    res.status(duplicateStatus).json({
      status: 'warning',
      message: duplicateMessage,
      idempotency: {
        state: 'busy',
        retryAfterMs: Number(guardResult.retryAfterMs || 0)
      }
    });
    return true;
  }
  if (guardResult.status === 'replay') {
    const payload = guardResult.payload && typeof guardResult.payload === 'object'
      ? { ...guardResult.payload }
      : { status: 'success' };
    payload.idempotency = { state: 'replayed' };
    res.json(payload);
    return true;
  }
  return false;
}

function enrichLedgerEntry(entry, maps) {
  const student = maps.studentMap.get(String(entry.studentId || '')) || null;
  const person = student?.personId ? maps.personMap.get(String(student.personId || '')) : null;
  const program = maps.programMap.get(String(entry.programId || '')) || null;
  const term = maps.termMap.get(String(entry.termId || '')) || null;
  const classItem = maps.classMap.get(String(entry.classId || '')) || null;
  const subject = maps.subjectMap.get(String(entry.subjectId || '')) || null;
  return {
    ...entry,
    __studentName: formatStudentName(person, student || entry),
    __programLabel: [String(program?.code || entry.programId || ''), String(program?.name || '')].filter(Boolean).join(' - '),
    __termLabel: [String(term?.code || entry.termId || ''), String(term?.name || '')].filter(Boolean).join(' - '),
    __classLabel: [String(classItem?.code || entry.classId || ''), String(classItem?.title || classItem?.name || '')].filter(Boolean).join(' - '),
    __subjectLabel: [String(subject?.code || entry.subjectId || ''), String(subject?.title || subject?.name || '')].filter(Boolean).join(' - '),
    __postedAtDisplay: entry.postedAt ? new Date(entry.postedAt).toLocaleString() : '-'
  };
}

exports.listLedger = async (req, res) => {
  try {
    const runRequested = String(req.query.run || '').trim() === '1';

    const filters = {
      effectiveFrom: String(req.query.effectiveFrom || '').trim(),
      effectiveTo: String(req.query.effectiveTo || '').trim(),
      postedFrom: String(req.query.postedFrom || '').trim(),
      postedTo: String(req.query.postedTo || '').trim(),
      search: String(req.query.search || '').trim(),
      programIds: normalizeMultiValue(req.query.programIds),
      studentIds: normalizeMultiValue(req.query.studentIds),
      termIds: normalizeMultiValue(req.query.termIds),
      classIds: normalizeMultiValue(req.query.classIds),
      entryTypes: normalizeMultiValue(req.query.entryTypes),
      statuses: normalizeMultiValue(req.query.statuses)
    };

    const criteriaOk = hasLedgerFetchCriteria(filters);
    const shouldFetch = runRequested || criteriaOk;
    const filterError = null;

    let entries = [];
    let students = [];
    let programs = [];
    let terms = [];
    let classes = [];
    let subjects = [];
    let persons = [];

    if (shouldFetch) {
      [entries, students, programs, terms, classes, subjects] = await Promise.all([
        dataService.fetchData('academicLedger', {}, req.user),
        dataService.fetchData('students', {}, req.user),
        dataService.fetchData('programs', {}, req.user),
        dataService.fetchData('terms', {}, req.user),
        dataService.fetchData('classes', {}, req.user),
        dataService.fetchData('subjects', {}, req.user)
      ]);
      const personById = await schoolPersonAccessService.buildPersonByIdMap({
        reqUser: req.user,
        personIds: (Array.isArray(students) ? students : []).map((student) => student.personId)
      });
      persons = [...personById.values()];
    }

    const maps = {
      studentMap: new Map(students.map((row) => [String(row.id || ''), row])),
      personMap: new Map(persons.map((row) => [String(row.id || ''), row])),
      programMap: new Map(programs.map((row) => [String(row.id || ''), row])),
      termMap: new Map(terms.map((row) => [String(row.id || ''), row])),
      classMap: new Map(classes.map((row) => [String(row.id || ''), row])),
      subjectMap: new Map(subjects.map((row) => [String(row.id || ''), row]))
    };

    const filteredRows = entries
      .map((entry) => enrichLedgerEntry(entry, maps))
      .filter((entry) => {
        if (!matchesAny(entry.programId, filters.programIds)) return false;
        if (!matchesAny(entry.studentId, filters.studentIds)) return false;
        if (!matchesAny(entry.termId, filters.termIds)) return false;
        if (!matchesAnyId(entry.classId, filters.classIds)) return false;
        if (!matchesAny(entry.entryType, filters.entryTypes)) return false;
        if (!matchesAny(entry.status, filters.statuses)) return false;

        if (filters.effectiveFrom && String(entry.effectiveDate || '') < filters.effectiveFrom) return false;
        if (filters.effectiveTo && String(entry.effectiveDate || '') > filters.effectiveTo) return false;

        const postedAtTs = entry.postedAt ? new Date(entry.postedAt).getTime() : null;
        if (filters.postedFrom) {
          const minTs = new Date(filters.postedFrom).getTime();
          if (Number.isFinite(minTs) && Number.isFinite(postedAtTs) && postedAtTs < minTs) return false;
        }
        if (filters.postedTo) {
          const maxTs = new Date(filters.postedTo).getTime();
          if (Number.isFinite(maxTs) && Number.isFinite(postedAtTs) && postedAtTs > maxTs) return false;
        }

        if (filters.search) {
          const haystack = [
            entry.id,
            entry.entryType,
            entry.studentId,
            entry.__studentName,
            entry.programId,
            entry.__programLabel,
            entry.termId,
            entry.__termLabel,
            entry.classId,
            entry.__classLabel,
            entry.subjectId,
            entry.__subjectLabel,
            entry.memo,
            entry.note,
            entry.source?.eventId,
            entry.academic?.result,
            entry.academic?.standing
          ].join(' ').toLowerCase();
          if (!haystack.includes(filters.search.toLowerCase())) return false;
        }

        return true;
      })
      .sort((a, b) =>
        String(a.effectiveDate || '').localeCompare(String(b.effectiveDate || '')) ||
        String(a.postedAt || '').localeCompare(String(b.postedAt || '')) ||
        Number(a.sequenceNo || 0) - Number(b.sequenceNo || 0)
      );

    const totalAttemptedCredits = filteredRows.reduce((sum, row) => sum + Number(row?.quantities?.creditsAttempted || 0), 0);
    const totalEarnedCredits = filteredRows.reduce((sum, row) => sum + Number(row?.quantities?.creditsEarned || 0), 0);
    const scoreRows = filteredRows.filter((row) => row?.quantities?.score !== null && row?.quantities?.score !== undefined);
    const averageScore = scoreRows.length
      ? Number((scoreRows.reduce((sum, row) => sum + Number(row?.quantities?.score || 0), 0) / scoreRows.length).toFixed(2))
      : null;

    const byProgramMap = new Map();
    const byStudentMap = new Map();
    filteredRows.forEach((row) => {
      const programKey = String(row.programId || '');
      if (programKey) {
        const current = byProgramMap.get(programKey) || {
          programId: row.programId,
          label: row.__programLabel || row.programId,
          entryCount: 0,
          attemptedCredits: 0,
          earnedCredits: 0,
          passCount: 0,
          failCount: 0
        };
        current.entryCount += 1;
        current.attemptedCredits += Number(row?.quantities?.creditsAttempted || 0);
        current.earnedCredits += Number(row?.quantities?.creditsEarned || 0);
        if (String(row?.academic?.result || '').toLowerCase() === 'pass') current.passCount += 1;
        if (String(row?.academic?.result || '').toLowerCase() === 'fail') current.failCount += 1;
        byProgramMap.set(programKey, current);
      }

      const studentKey = String(row.studentId || '');
      if (studentKey) {
        const current = byStudentMap.get(studentKey) || {
          studentId: row.studentId,
          name: row.__studentName || row.studentId,
          entryCount: 0,
          attemptedCredits: 0,
          earnedCredits: 0,
          scoreCount: 0
        };
        current.entryCount += 1;
        current.attemptedCredits += Number(row?.quantities?.creditsAttempted || 0);
        current.earnedCredits += Number(row?.quantities?.creditsEarned || 0);
        if (row?.quantities?.score !== null && row?.quantities?.score !== undefined) current.scoreCount += 1;
        byStudentMap.set(studentKey, current);
      }
    });

    const summary = {
      entryCount: filteredRows.length,
      studentCount: new Set(filteredRows.map((row) => String(row.studentId || '')).filter(Boolean)).size,
      programCount: new Set(filteredRows.map((row) => String(row.programId || '')).filter(Boolean)).size,
      totalAttemptedCredits: Number(totalAttemptedCredits.toFixed(2)),
      totalEarnedCredits: Number(totalEarnedCredits.toFixed(2)),
      averageScore
    };

    if (isAjax(req)) {
      return res.json({
        status: shouldFetch ? 'success' : 'idle',
        rows: filteredRows,
        summary,
        filterError,
        resultsLoaded: shouldFetch
      });
    }

    res.render('school/academicLedger/ledgerList', {
      title: 'Academic Ledger',
      filters,
      filterError,
      resultsLoaded: shouldFetch,
      rows: filteredRows,
      summary,
      byProgramSummary: Array.from(byProgramMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
      byStudentSummary: Array.from(byStudentMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      selectedPrograms: filters.programIds.map((id) => {
        const row = maps.programMap.get(String(id || ''));
        return {
          id: String(id || ''),
          label: row ? [String(row.code || row.id || ''), String(row.name || '')].filter(Boolean).join(' - ') : String(id || '')
        };
      }),
      selectedStudents: filters.studentIds.map((id) => {
        const row = maps.studentMap.get(String(id || ''));
        const person = row?.personId ? maps.personMap.get(String(row.personId || '')) : null;
        return {
          id: String(id || ''),
          label: row ? `${formatStudentName(person, row)} (${row.id})` : String(id || '')
        };
      }),
      selectedTerms: filters.termIds.map((id) => {
        const row = maps.termMap.get(String(id || ''));
        return {
          id: String(id || ''),
          label: row ? [String(row.code || row.id || ''), String(row.name || '')].filter(Boolean).join(' - ') : String(id || '')
        };
      }),
      selectedClasses: filters.classIds.map((id) => {
        const row = maps.classMap.get(String(id || ''));
        return {
          id: String(id || ''),
          label: row
            ? [String(row.code || row.id || ''), String(row.title || row.name || '')].filter(Boolean).join(' - ')
            : String(id || '')
        };
      }),
      entryTypes: academicLedgerModel.ENTRY_TYPES || [],
      entryStatuses: academicLedgerModel.ENTRY_STATUSES || [],
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showStudentStatement = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const student = await dataService.getDataById('students', req.params.studentId, req.user);
    if (!student) throw new Error('Student not found or inaccessible.');

    const programId = String(req.query.programId || '').trim();
    const entries = (await dataService.fetchData('academicLedger', {
      studentId: student.id,
      ...(programId ? { programId } : {})
    }, req.user)).sort((a, b) => String(a.postedAt || '').localeCompare(String(b.postedAt || '')) || Number(a.sequenceNo || 0) - Number(b.sequenceNo || 0));

    const programs = await dataService.fetchData('programs', {}, req.user);
    const snapshots = (await dataService.fetchData('academicSnapshots', { studentId: student.id }, req.user))
      .filter((row) => !programId || String(row.programId || '') === programId);
    const person = student.personId
      ? await schoolPersonAccessService.getPersonById({ reqUser: req.user, personId: student.personId })
      : null;

    res.render('school/academicLedger/studentStatement', {
      title: 'Student Academic Statement',
      activeOrgId,
      student,
      person,
      entries,
      programs,
      snapshots,
      selectedProgramId: programId,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showStudentOverview = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    res.render('school/academicLedger/studentOverview', {
      title: 'Student Registration Overview',
      activeOrgId,
      student: null,
      person: null,
      overview: null,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showStudentOverviewForStudent = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const overview = await studentAcademicOverviewService.buildStudentAcademicOverview({
      reqUser: req.user,
      activeOrgId,
      studentId: req.params.studentId
    });

    res.render('school/academicLedger/studentOverview', {
      title: 'Student Registration Overview',
      activeOrgId,
      student: overview.student,
      person: overview.person,
      overview,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.getStudentEnrollmentDetail = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const detail = await studentEnrollmentDetailService.buildEnrollmentDetail({
      reqUser: req.user,
      activeOrgId,
      studentId: req.params.studentId,
      enrollmentId: req.params.enrollmentId
    });
    return res.json({
      status: 'success',
      ...detail
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.postProgramRegistration = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'academic_post_program_registration',
      activeOrgId,
      String(req.body.studentId || '').trim(),
      String(req.body.programId || '').trim(),
      String(req.body.effectiveDate || '').trim(),
      String(req.body.eventId || '').trim(),
      String(req.body.idempotencyKey || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Program registration posting is already in progress. Please wait.')) return;

    const student = await dataService.getDataById('students', req.body.studentId, req.user);
    const program = await dataService.getDataById('programs', req.body.programId, req.user);
    if (!student) throw new Error('Student not found or inaccessible.');
    if (!program) throw new Error('Program not found or inaccessible.');

    const created = await academicLedgerService.postProgramRegistration({
      reqUser: req.user,
      student,
      program,
      effectiveDate: req.body.effectiveDate,
      note: req.body.note,
      source: {
        eventId: req.body.eventId || `PRGREG-${student.id}-${program.id}-${Date.now()}`,
        idempotencyKey: req.body.idempotencyKey || `PRGREG|${student.id}|${program.id}|${req.body.effectiveDate || ''}`
      }
    });

    const payloadOut = { status: 'success', message: 'Program registration posted to academic ledger.', results: created };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.postTermRegistration = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'academic_post_term_registration',
      activeOrgId,
      String(req.body.studentId || '').trim(),
      String(req.body.programId || '').trim(),
      String(req.body.termId || '').trim(),
      String(req.body.effectiveDate || '').trim(),
      String(req.body.eventId || '').trim(),
      String(req.body.idempotencyKey || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Term registration posting is already in progress. Please wait.')) return;

    const student = await dataService.getDataById('students', req.body.studentId, req.user);
    const program = await dataService.getDataById('programs', req.body.programId, req.user);
    const term = await dataService.getDataById('terms', req.body.termId, req.user);
    if (!student) throw new Error('Student not found or inaccessible.');
    if (!program) throw new Error('Program not found or inaccessible.');
    if (!term) throw new Error('Term not found or inaccessible.');

    const created = await academicLedgerService.postTermRegistration({
      reqUser: req.user,
      student,
      program,
      term,
      effectiveDate: req.body.effectiveDate,
      note: req.body.note,
      source: {
        eventId: req.body.eventId || `TRMREG-${student.id}-${program.id}-${term.id}-${Date.now()}`,
        idempotencyKey: req.body.idempotencyKey || `TRMREG|${student.id}|${program.id}|${term.id}|${req.body.effectiveDate || ''}`
      }
    });

    const payloadOut = { status: 'success', message: 'Term registration posted to academic ledger.', results: created };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.postClassEnrollment = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'academic_post_class_enrollment',
      activeOrgId,
      String(req.body.studentId || '').trim(),
      String(req.body.programId || '').trim(),
      String(req.body.classId || '').trim(),
      String(req.body.subjectId || '').trim(),
      String(req.body.effectiveDate || '').trim(),
      String(req.body.eventId || '').trim(),
      String(req.body.idempotencyKey || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Class enrollment posting is already in progress. Please wait.')) return;

    const student = await dataService.getDataById('students', req.body.studentId, req.user);
    const program = await dataService.getDataById('programs', req.body.programId, req.user);
    const classItem = await dataService.getDataById('classes', req.body.classId, req.user);
    if (!student) throw new Error('Student not found or inaccessible.');
    if (!program) throw new Error('Program not found or inaccessible.');
    if (!classItem) throw new Error('Class not found or inaccessible.');

    const subjectId = String(req.body.subjectId || '').trim();
    const programSubject = subjectId ? getProgramSubject(program, subjectId) : null;

    const created = await academicLedgerService.postClassEnrollment({
      reqUser: req.user,
      student,
      program,
      termId: req.body.termId,
      classItem,
      subjectId,
      subjectType: programSubject?.subjectType || '',
      creditsAttempted: programSubject?.programCredits ?? null,
      effectiveDate: req.body.effectiveDate,
      note: req.body.note,
      source: {
        eventId: req.body.eventId || `CLSENR-${student.id}-${classItem.id}-${Date.now()}`,
        idempotencyKey: req.body.idempotencyKey || `CLSENR|${student.id}|${program.id}|${classItem.id}|${subjectId}|${req.body.effectiveDate || ''}`
      }
    });

    const payloadOut = { status: 'success', message: 'Class enrollment posted to academic ledger.', results: created };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.postScore = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'academic_post_score',
      activeOrgId,
      String(req.body.studentId || '').trim(),
      String(req.body.programId || '').trim(),
      String(req.body.subjectId || '').trim(),
      String(req.body.classId || '').trim(),
      String(req.body.effectiveDate || '').trim(),
      String(req.body.eventId || '').trim(),
      String(req.body.idempotencyKey || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Score posting is already in progress. Please wait.')) return;

    const student = await dataService.getDataById('students', req.body.studentId, req.user);
    const program = await dataService.getDataById('programs', req.body.programId, req.user);
    if (!student) throw new Error('Student not found or inaccessible.');
    if (!program) throw new Error('Program not found or inaccessible.');
    const subjectId = String(req.body.subjectId || '').trim();
    if (!subjectId) throw new Error('subjectId is required.');

    const programSubject = getProgramSubject(program, subjectId);
    const created = await academicLedgerService.postScoreResult({
      reqUser: req.user,
      student,
      program,
      termId: req.body.termId,
      classId: req.body.classId,
      subjectId,
      score: req.body.score,
      average: req.body.average,
      result: req.body.result,
      creditsAttempted: req.body.creditsAttempted || programSubject?.programCredits || null,
      creditsEarned: req.body.creditsEarned || (String(req.body.result || '').trim().toLowerCase() === 'pass' ? programSubject?.programCredits || null : 0),
      effectiveDate: req.body.effectiveDate,
      note: req.body.note,
      source: {
        eventId: req.body.eventId || `SCR-${student.id}-${subjectId}-${Date.now()}`,
        idempotencyKey: req.body.idempotencyKey || `SCR|${student.id}|${program.id}|${subjectId}|${req.body.classId || ''}|${req.body.effectiveDate || ''}`
      }
    });

    const payloadOut = { status: 'success', message: 'Academic score/result posted to ledger.', results: created };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.rebuildSnapshot = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const studentId = String(req.body.studentId || req.params.studentId || '').trim();
    const programId = String(req.body.programId || req.params.programId || '').trim();
    if (!studentId || !programId) throw new Error('studentId and programId are required.');
    guardKey = idempotencyGuardService.createGuardKey([
      'academic_rebuild_snapshot',
      String(activeOrgId || '').trim(),
      studentId,
      programId
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 10000
    });
    if (sendGuardedResponse(res, guardResult, 'Academic snapshot rebuild is already in progress. Please wait.')) return;

    const snapshot = await academicSnapshotService.rebuildStudentProgramSnapshot(studentId, programId);
    const payloadOut = { status: 'success', message: 'Academic snapshot rebuilt.', result: snapshot };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
