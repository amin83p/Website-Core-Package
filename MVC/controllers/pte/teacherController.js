const paginate = require('../../utils/paginationHelper');
const pteTeacherDataService = require('../../services/pte/pteTeacherDataService');
const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
} = require('../../utils/generalTools');

const LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'teacherId',
    'personId',
    'userId',
    'orgId',
    'status'
  ],
  defaultSearchFields: [
    'id',
    'teacherId',
    'personId',
    'userId',
    'status',
    'notes'
  ],
  allowMetaKeys: true
});

const PICKER_PERSON_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'status'],
  defaultSearchFields: ['id', 'displayName', 'name.first', 'name.last', 'name.preferred', 'contact.email', 'email'],
  allowMetaKeys: true
});

const PICKER_COURSE_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name'],
  defaultSearchFields: ['id', 'name'],
  allowMetaKeys: true
});

const PICKER_TEACHER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'status', 'teacherId', 'personId', 'userId'],
  defaultSearchFields: ['id', 'name', 'displayName', 'email', 'teacherId', 'personId', 'userId'],
  allowMetaKeys: true
});

function splitPagination(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Number.parseInt(source.page, 10) || 1;
  const limit = Number.parseInt(source.limit, 10) || undefined;
  const filtered = { ...source };
  delete filtered.page;
  delete filtered.limit;
  return { page, limit, filtered };
}

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function cleanText(value, max = 300) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeStatus(value, fallback = 'active') {
  const token = cleanText(value, 30).toLowerCase();
  if (token === 'archived') return 'archived';
  if (token === 'active') return 'active';
  return fallback;
}

function normalizeCourses(value) {
  const rows = parseJsonSafe(value, []);
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  return list
    .map((row, index) => {
      const item = row && typeof row === 'object' ? row : { id: row };
      const id = cleanText(item.id || item.courseId, 120);
      const name = cleanText(item.name || item.title, 180);
      const key = id || name || `course_${index + 1}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id,
        name: name || id || key
      };
    })
    .filter(Boolean);
}

function buildTeacherPayload(req) {
  const body = req.body || {};
  const personMode = cleanText(body.personMode, 20).toLowerCase() === 'new' ? 'new' : 'existing';

  return {
    personMode,
    personId: cleanText(body.personId, 120),
    newPerson: {
      firstName: cleanText(body.newPersonFirstName, 120),
      middleName: cleanText(body.newPersonMiddleName, 120),
      lastName: cleanText(body.newPersonLastName, 120),
      preferredName: cleanText(body.newPersonPreferredName, 120),
      email: cleanText(body.newPersonEmail, 220),
      phone: cleanText(body.newPersonPhone, 80),
      gender: cleanText(body.newPersonGender, 40),
      dateOfBirth: cleanText(body.newPersonDateOfBirth, 40),
      notes: cleanText(body.newPersonNotes, 2000)
    },
    teacherId: cleanText(body.teacherId, 120),
    notes: cleanText(body.notes, 4000),
    courses: normalizeCourses(body.coursesJson),
    status: normalizeStatus(body.status || '', '')
  };
}

async function listTeachers(req, res, mode = 'active') {
  const query = await buildDataServiceQuery(req.query, LIST_QUERY_OPTIONS);
  if (!query.status) query.status = mode === 'archived' ? 'archived' : 'active';
  const page = Number.parseInt(req.query?.page, 10) || 1;
  const limit = Number.parseInt(req.query?.limit, 10) || undefined;

  const result = await pteTeacherDataService.listTeachers(
    {
      ...query,
      page,
      limit
    },
    req.user,
    { scopeId: req.accessScope },
    {
      paginated: true,
      pagination: { page, limit }
    }
  );
  const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
  const searchableFields = await inferSearchableFields(rows, { exclude: ['audit'] });
  const data = rows;
  const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;

  if (isAjax(req)) {
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  }

  return res.render('pte/teachers/teacherList', {
    title: mode === 'archived' ? 'PTE Teachers (Archived)' : 'PTE Teachers',
    tableName: 'PTE_Teachers',
    data,
    searchableFields,
    newUrl: 'pte/teachers',
    newLabel: mode === 'archived' ? null : 'New Teacher',
    includeModal: true,
    includeModal_Table: true,
    includeModal_FileImport: false,
    print: true,
    btn_export: true,
    pagination,
    filters: req.query,
    archivedMode: mode === 'archived',
    user: req.user,
    actionStateId: req.actionStateId || ''
  });
}

async function listActiveTeachers(req, res) {
  try {
    return await listTeachers(req, res, 'active');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function listArchivedTeachers(req, res) {
  try {
    return await listTeachers(req, res, 'archived');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showForm(req, res) {
  try {
    const isEdit = Boolean(req.params.id);
    let teacher = null;

    if (isEdit) {
      teacher = await pteTeacherDataService.getTeacherById(req.params.id, req.user, { scopeId: req.accessScope });
      if (!teacher) {
        return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
      }
    } else {
      await pteTeacherDataService.assertCreateContext(req.user);
    }

    return res.render('pte/teachers/teacherForm', {
      title: isEdit ? `Edit PTE Teacher: ${teacher.id}` : 'Create PTE Teacher',
      teacher,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function saveTeacher(req, res) {
  try {
    const id = cleanText(req.params.id, 120);
    const payload = buildTeacherPayload(req);

    let result = null;
    if (id) {
      result = await pteTeacherDataService.updateTeacher(id, payload, req.user, { scopeId: req.accessScope });
    } else {
      result = await pteTeacherDataService.createTeacher(payload, req.user, { scopeId: req.accessScope });
    }

    const baseMessage = id
      ? 'Teacher updated successfully.'
      : 'Teacher created successfully.';
    const tempPassword = cleanText(result?.tempPassword, 200);
    const autoUserCreated = result?.autoUserCreated === true;
    const accountMessage = autoUserCreated
      ? (tempPassword
        ? ` User account was created with temporary password: ${tempPassword}`
        : ' User account was created successfully.')
      : '';

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: `${baseMessage}${accountMessage}`,
        results: result || null
      });
    }

    return res.redirect('/pte/teachers');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function archiveTeacher(req, res) {
  try {
    await pteTeacherDataService.archiveTeacher(req.params.id, req.user, { scopeId: req.accessScope });
    const message = 'Teacher archived successfully.';
    if (isAjax(req)) return res.json({ status: 'success', message, redirectTo: '/pte/teachers' });
    return res.redirect('/pte/teachers');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function recoverTeacher(req, res) {
  try {
    await pteTeacherDataService.recoverTeacher(req.params.id, req.user, { scopeId: req.accessScope });
    const message = 'Teacher recovered successfully.';
    if (isAjax(req)) return res.json({ status: 'success', message, redirectTo: '/pte/teachers/archived' });
    return res.redirect('/pte/teachers/archived');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function pickerPersons(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_PERSON_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const result = await pteTeacherDataService.listPickerPersons(
      filtered,
      req.user,
      { scopeId: req.accessScope },
      { paginated: true, pagination: { page, limit } }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const data = rows;
    const pagination = result?.pagination || paginate(rows, page, limit).pagination;
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function pickerCourses(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_COURSE_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const result = await pteTeacherDataService.listPickerCourses(
      filtered,
      req.user,
      { scopeId: req.accessScope },
      { paginated: true, pagination: { page, limit } }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const data = rows;
    const pagination = result?.pagination || paginate(rows, page, limit).pagination;
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function pickerTeachers(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_TEACHER_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const result = await pteTeacherDataService.listPickerTeachers(
      filtered,
      req.user,
      { scopeId: req.accessScope },
      { paginated: true, pagination: { page, limit } }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const data = rows;
    const pagination = result?.pagination || paginate(rows, page, limit).pagination;
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  listActiveTeachers,
  listArchivedTeachers,
  showForm,
  saveTeacher,
  archiveTeacher,
  recoverTeacher,
  pickerPersons,
  pickerCourses,
  pickerTeachers
};

