const schoolDataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const academicSnapshotService = require('../../services/school/academicSnapshotService');
const registrationIntegrityService = require('../../services/school/registrationIntegrityService');
const studentProgramPriorSubjectModel = require('../../models/school/studentProgramPriorSubjectModel');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, normalizeSearchKeyword } = requireCoreModule('MVC/utils/generalTools');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');

const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

const PRIOR_LIST_SEARCHABLE_FIELDS = Object.freeze([
  'id',
  'studentId',
  'studentLabel',
  'programId',
  'programLabel',
  'subjectId',
  'subjectLabel',
  'source',
  'status',
  'evidenceNote'
]);

function asIdArray(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => toPublicId(item))
    .filter(Boolean)));
}

function buildPersonName(person) {
  if (!person || !person.name) return '';
  const n = person.name;
  return [n.first, n.last].filter(Boolean).join(' ').trim();
}

function subjectLabelMapFromList(subjectRows) {
  const m = new Map();
  (Array.isArray(subjectRows) ? subjectRows : []).forEach((s) => {
    const id = toPublicId(s?.id);
    if (!id) return;
    m.set(id, [s.code, s.name].filter(Boolean).join(' â€” ') || id);
  });
  return m;
}

function applyPriorListFilters(rows, query) {
  const q = normalizeSearchKeyword(query.q || '').trim().toLowerCase();
  const status = String(query.status || '').trim().toLowerCase();
  const programId = toPublicId(query.programId || '');

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (status && String(row.status || '').trim().toLowerCase() !== status) return false;
    if (programId && !idsEqual(row.programId, programId)) return false;
    if (q) {
      const hay = [
        row.id,
        row.studentId,
        row.studentLabel,
        row.programId,
        row.programLabel,
        row.subjectId,
        row.subjectLabel,
        row.source,
        row.status,
        row.evidenceNote
      ].map((v) => String(v || '').toLowerCase()).join(' | ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

async function buildEnrichedPriorRowsForOrg(reqUser, activeOrgId) {
  const [rawRows, students, persons, programs, subjects] = await Promise.all([
    schoolDataService.fetchData('studentProgramPriorSubjects', {
      orgId__eq: activeOrgId,
      page: 1,
      limit: 10000,
      sort: 'id',
      order: 'desc'
    }, reqUser),
    schoolDataService.fetchData('students', { page: 1, limit: 5000 }, reqUser),
    dataServiceGlobal.fetchData('persons', {}, reqUser, PERSON_QUERY_OPTIONS),
    schoolDataService.fetchData('programs', { page: 1, limit: 500 }, reqUser),
    schoolDataService.fetchData('subjects', { page: 1, limit: 3000 }, reqUser)
  ]);

  const personById = new Map((Array.isArray(persons) ? persons : []).map((p) => [toPublicId(p.id), p]));
  const studentById = new Map((Array.isArray(students) ? students : []).map((s) => [toPublicId(s.id), s]));
  const programById = new Map((Array.isArray(programs) ? programs : []).map((p) => [toPublicId(p.id), p]));
  const subjectLabelById = subjectLabelMapFromList(subjects);

  const list = Array.isArray(rawRows) ? rawRows : [];
  return list
    .filter((row) => idsEqual(row?.orgId, activeOrgId))
    .map((row) => {
      const sid = toPublicId(row.studentId);
      const pid = toPublicId(row.programId);
      const subId = toPublicId(row.subjectId);
      const stu = studentById.get(sid);
      let studentLabel = sid || '';
      if (stu) {
        const person = personById.get(toPublicId(stu.personId));
        const name = buildPersonName(person);
        studentLabel = [name || stu.localId || sid, sid].filter(Boolean).join(' â€” ');
      }
      const prog = programById.get(pid);
      const programLabel = prog
        ? [prog.code, prog.name].filter(Boolean).join(' â€” ') || pid
        : pid;
      const subjectLabel = subjectLabelById.get(subId) || subId;
      return {
        ...row,
        studentLabel,
        programLabel,
        subjectLabel
      };
    });
}

exports.showPage = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const enrichedAll = await buildEnrichedPriorRowsForOrg(req.user, activeOrgId);
    const query = { ...req.query, q: normalizeSearchKeyword(req.query.q || '') };
    const filtered = applyPriorListFilters(enrichedAll, query);
    const searchableFields = [...PRIOR_LIST_SEARCHABLE_FIELDS];
    const { data, pagination } = paginate(filtered, query);

    if (isAjax(req)) {
      return res.json({ status: 'success', results: data, pagination, filters: query });
    }

    res.render('school/program/priorSubjectCredits', {
      title: 'Prior Subject Credits',
      user: req.user,
      activeOrgId,
      data,
      pagination,
      filters: query,
      searchableFields,
      priorSources: [...studentProgramPriorSubjectModel.PRIOR_SUBJECT_SOURCES],
      tableName: 'Prior_Subject_Credits',
      includeModal: true,
      includeModal_Table: true,
      print: true,
      btn_export: true,
      newUrl: 'school/programs/prior-subject-credits',
      newLabel: null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

/**
 * Programs the student has an approved (registered) program registration for in this org.
 * Used to populate the prior-credits modal program dropdown after student pick.
 */
exports.listStudentRegisteredPrograms = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const studentId = toPublicId(req.query.studentId || '');
    if (!studentId) {
      return res.json({ status: 'success', programs: [] });
    }

    const student = await schoolDataService.getDataById('students', studentId, req.user);
    if (!student || !idsEqual(student.orgId, activeOrgId)) {
      return res.status(400).json({ status: 'error', message: 'Student not found in the active organization.' });
    }

    const regs = await schoolDataService.fetchData('studentProgramRegistrations', {
      studentId__eq: studentId,
      page: 1,
      limit: 500
    }, req.user);

    const approved = (Array.isArray(regs) ? regs : []).filter((r) =>
      idsEqual(r?.orgId, activeOrgId)
      && registrationIntegrityService.isApprovedProgramRegistrationStatus(r?.status)
    );

    const programIdSet = new Set(
      approved.map((r) => toPublicId(r.programId)).filter(Boolean)
    );

    const programs = [];
    for (const pid of programIdSet) {
      const p = await schoolDataService.getDataById('programs', pid, req.user);
      if (p && idsEqual(p.orgId, activeOrgId)) {
        programs.push({
          id: toPublicId(p.id),
          label: [p.code, p.name].filter(Boolean).join(' â€” ') || p.id
        });
      }
    }
    programs.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' }));

    return res.json({ status: 'success', programs });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.listRecords = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const studentId = toPublicId(req.query.studentId || '');
    const programId = toPublicId(req.query.programId || '');
    if (!studentId || !programId) {
      return res.json({ status: 'success', records: [] });
    }

    const student = await schoolDataService.getDataById('students', studentId, req.user);
    const program = await schoolDataService.getDataById('programs', programId, req.user);
    if (!student || !program || !idsEqual(student.orgId, activeOrgId) || !idsEqual(program.orgId, activeOrgId)) {
      return res.status(400).json({ status: 'error', message: 'Student or program not found in the active organization.' });
    }

    const rows = await schoolDataService.fetchData('studentProgramPriorSubjects', {
      studentId__eq: studentId,
      programId__eq: programId,
      page: 1,
      limit: 500
    }, req.user);

    const subjects = await schoolDataService.fetchData('subjects', { page: 1, limit: 3000 }, req.user);
    const labelById = subjectLabelMapFromList(subjects);

    const records = (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      subjectLabel: labelById.get(toPublicId(row.subjectId)) || row.subjectId
    }));

    return res.json({ status: 'success', records });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.createBatch = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const studentId = toPublicId(req.body?.studentId || '');
    const programId = toPublicId(req.body?.programId || '');
    const subjectIds = asIdArray(req.body?.subjectIds);
    const sourceRaw = String(req.body?.source || 'manual_waiver').trim().toLowerCase();
    const source = studentProgramPriorSubjectModel.PRIOR_SUBJECT_SOURCES.includes(sourceRaw)
      ? sourceRaw
      : 'manual_waiver';
    const evidenceNote = String(req.body?.evidenceNote || '').trim();

    if (!studentId || !programId) {
      return res.status(400).json({ status: 'error', message: 'studentId and programId are required.' });
    }
    if (!subjectIds.length) {
      return res.status(400).json({ status: 'error', message: 'Select at least one subject.' });
    }

    const subjects = await schoolDataService.fetchData('subjects', { page: 1, limit: 3000 }, req.user);
    const orgSubjectIds = new Set(
      (Array.isArray(subjects) ? subjects : [])
        .filter((s) => idsEqual(s?.orgId, activeOrgId))
        .map((s) => toPublicId(s.id))
        .filter(Boolean)
    );
    const invalidSubjects = subjectIds.filter((sid) => !orgSubjectIds.has(sid));
    if (invalidSubjects.length) {
      return res.status(400).json({
        status: 'error',
        message: 'One or more subjects are not in the active organization.'
      });
    }

    const student = await schoolDataService.getDataById('students', studentId, req.user);
    const program = await schoolDataService.getDataById('programs', programId, req.user);
    if (!student || !program || !idsEqual(student.orgId, activeOrgId) || !idsEqual(program.orgId, activeOrgId)) {
      return res.status(400).json({ status: 'error', message: 'Student or program not found in the active organization.' });
    }

    const existingRows = await schoolDataService.fetchData('studentProgramPriorSubjects', {
      orgId__eq: activeOrgId,
      studentId__eq: studentId,
      programId__eq: programId,
      page: 1,
      limit: 5000
    }, req.user);

    const activeSubjectIds = new Set(
      (Array.isArray(existingRows) ? existingRows : [])
        .filter((r) => idsEqual(r?.orgId, activeOrgId)
          && String(r?.status || '').trim().toLowerCase() === 'active')
        .map((r) => toPublicId(r.subjectId))
        .filter(Boolean)
    );

    const skippedDuplicateSubjectIds = [];
    const subjectIdsToCreate = [];
    for (const subjectId of subjectIds) {
      if (activeSubjectIds.has(subjectId)) {
        skippedDuplicateSubjectIds.push(subjectId);
        continue;
      }
      activeSubjectIds.add(subjectId);
      subjectIdsToCreate.push(subjectId);
    }

    const created = [];
    const errors = [];
    for (const subjectId of subjectIdsToCreate) {
      try {
        const row = await schoolDataService.addData('studentProgramPriorSubjects', {
          orgId: activeOrgId,
          studentId,
          programId,
          subjectId,
          source,
          evidenceNote,
          status: 'active'
        }, req.user);
        created.push(row);
      } catch (err) {
        errors.push({ subjectId, message: String(err?.message || err || 'Save failed.') });
      }
    }

    if (created.length) {
      try {
        await academicSnapshotService.rebuildStudentProgramSnapshot(studentId, programId);
      } catch (snapErr) {
        errors.push({
          subjectId: '_snapshot',
          message: `Credits saved but academic snapshot rebuild failed: ${String(snapErr?.message || snapErr)}`
        });
      }
    }

    return res.json({
      status: 'success',
      createdCount: created.length,
      created,
      errors,
      skippedDuplicateSubjectIds,
      skippedDuplicateCount: skippedDuplicateSubjectIds.length
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.revokeRecord = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const id = toPublicId(req.body?.recordId || '');
    if (!id) return res.status(400).json({ status: 'error', message: 'recordId is required.' });

    const existing = await schoolDataService.getDataById('studentProgramPriorSubjects', id, req.user);
    if (!existing || !idsEqual(existing.orgId, activeOrgId)) {
      return res.status(404).json({ status: 'error', message: 'Record not found.' });
    }

    await schoolDataService.updateData('studentProgramPriorSubjects', id, { status: 'revoked' }, req.user);
    try {
      await academicSnapshotService.rebuildStudentProgramSnapshot(existing.studentId, existing.programId);
    } catch (snapErr) {
      return res.json({
        status: 'warning',
        message: `Revoked, but snapshot rebuild failed: ${String(snapErr?.message || snapErr)}`
      });
    }
    return res.json({ status: 'success', message: 'Prior credit revoked.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

async function deletePriorRecordCore(req, res, rawId) {
  const activeOrgId = getActiveOrgIdOrThrow(req.user);
  const id = toPublicId(rawId || '');
  if (!id) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: 'Record id is required.' });
    throw new Error('Record id is required.');
  }

  const existing = await schoolDataService.getDataById('studentProgramPriorSubjects', id, req.user);
  if (!existing || !idsEqual(existing.orgId, activeOrgId)) {
    if (isAjax(req)) return res.status(404).json({ status: 'error', message: 'Record not found.' });
    throw new Error('Record not found.');
  }

  const sid = toPublicId(existing.studentId);
  const pid = toPublicId(existing.programId);
  await schoolDataService.deleteData('studentProgramPriorSubjects', id, req.user);
  try {
    if (sid && pid) await academicSnapshotService.rebuildStudentProgramSnapshot(sid, pid);
  } catch (snapErr) {
    const msg = `Deleted, but snapshot rebuild failed: ${String(snapErr?.message || snapErr)}`;
    if (isAjax(req)) {
      // GET /delete/:id is used by main.js â€” it only removes the row when status === 'success'.
      if (req.method === 'GET') {
        return res.json({ status: 'success', message: 'Prior credit removed.', warning: msg });
      }
      return res.json({ status: 'warning', message: msg });
    }
    throw new Error(msg);
  }
  if (isAjax(req)) return res.json({ status: 'success', message: 'Prior credit removed.' });
  return res.redirect('/school/programs/prior-subject-credits');
}

/** GET â€¦/prior-subject-credits/delete/:id â€” used by main.js global delete (table row removal). */
exports.deleteRecordByIdParam = async (req, res) => {
  try {
    return await deletePriorRecordCore(req, res, req.params.id);
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.deleteRecord = async (req, res) => {
  try {
    return await deletePriorRecordCore(req, res, req.body?.recordId);
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
