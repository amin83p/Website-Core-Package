const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  paginate,
  pteCourseDataService
} = require('./courseControllerDependencies');

const LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'orgId',
    'code',
    'name',
    'status',
    'courseType',
    'level'
  ],
  defaultSearchFields: [
    'id',
    'code',
    'name',
    'description',
    'status',
    'courseType',
    'level',
    'teachers.id',
    'teachers.displayName',
    'students.id',
    'students.displayName'
  ],
  allowMetaKeys: true
});

const PICKER_TEACHER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id'],
  defaultSearchFields: ['id', 'name', 'displayName', 'email'],
  allowMetaKeys: true
});

const PICKER_STUDENT_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'status'],
  defaultSearchFields: ['id', 'name', 'displayName', 'email', 'applicantId'],
  allowMetaKeys: true
});

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function parseMaybeJson(input, fallback = null) {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'object') return input;
  const token = String(input || '').trim();
  if (!token) return fallback;
  try {
    return JSON.parse(token);
  } catch (_) {
    throw new Error('Invalid course payload.');
  }
}

function normalizeMultiValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function splitPagination(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Number.parseInt(source.page, 10) || 1;
  const limit = Number.parseInt(source.limit, 10) || undefined;
  const filtered = { ...source };
  delete filtered.page;
  delete filtered.limit;
  return { page, limit, filtered };
}

function readCoursePlan(req) {
  const raw = req?.body?.coursePlan;
  const parsed = parseMaybeJson(raw, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return req.body && typeof req.body === 'object' ? req.body : {};
}

async function listCourses(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, LIST_QUERY_OPTIONS);
    query.teacherIds = normalizeMultiValue(req.query.teacherIds || req.query.teacherId);
    query.studentIds = normalizeMultiValue(req.query.studentIds || req.query.studentId);
    query.dateFrom = cleanText(req.query.dateFrom || req.query.startDateFrom, 40);
    query.dateTo = cleanText(req.query.dateTo || req.query.endDateTo, 40);
    const page = Number.parseInt(req.query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || undefined;

    const result = await pteCourseDataService.listCourses(
      {
        ...query,
        page,
        limit
      },
      req.user,
      {
        scopeId: req.accessScope
      },
      {
        paginated: true,
        pagination: { page, limit }
      }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const searchableFields = await inferSearchableFields(rows, { exclude: ['audit'] });
    const data = rows;
    const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;

    const selectedTeacherRows = query.teacherIds.length
      ? await pteCourseDataService.listPickerTeachers(
        { id__in: query.teacherIds.join(',') },
        req.user,
        { scopeId: req.accessScope }
      )
      : [];
    const selectedStudentRows = query.studentIds.length
      ? await pteCourseDataService.listPickerStudents(
        { id__in: query.studentIds.join(',') },
        req.user,
        { scopeId: req.accessScope }
      )
      : [];

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination
      });
    }

    return res.render('pte/courses/courseList', {
      title: 'PTE Courses',
      tableName: 'PTE_Courses',
      data,
      searchableFields,
      newUrl: 'pte/courses',
      newLabel: 'New Course',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      btn_export: true,
      pagination,
      filters: query,
      selectedTeachers: Array.isArray(selectedTeacherRows) ? selectedTeacherRows : [],
      selectedStudents: Array.isArray(selectedStudentRows) ? selectedStudentRows : [],
      formOptions: pteCourseDataService.getFormOptions(),
      user: req.user,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showForm(req, res) {
  try {
    const isEdit = Boolean(req.params.id);
    let course = null;
    if (isEdit) {
      course = await pteCourseDataService.getCourseById(req.params.id, req.user, {
        scopeId: req.accessScope
      });
      if (!course) {
        return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
      }
    } else {
      await pteCourseDataService.assertCreateContext(req.user);
    }

    return res.render('pte/courses/courseForm', {
      title: isEdit ? 'Edit PTE Course' : 'Create PTE Course',
      course,
      formOptions: pteCourseDataService.getFormOptions(),
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function saveCourse(req, res) {
  try {
    const id = cleanText(req.params.id, 120);
    const payload = readCoursePlan(req);
    if (id) {
      await pteCourseDataService.updateCourse(id, payload, req.user, {
        scopeId: req.accessScope
      });
      if (isAjax(req)) return res.json({ status: 'success', message: 'Course updated successfully.' });
      return res.redirect('/pte/courses');
    }

    await pteCourseDataService.createCourse(payload, req.user, {
      scopeId: req.accessScope
    });
    if (isAjax(req)) return res.json({ status: 'success', message: 'Course created successfully.' });
    return res.redirect('/pte/courses');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function archiveCourse(req, res) {
  try {
    await pteCourseDataService.archiveCourse(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    if (isAjax(req)) return res.json({ status: 'success', message: 'Course archived successfully.' });
    return res.redirect('/pte/courses');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function recoverCourse(req, res) {
  try {
    await pteCourseDataService.recoverCourse(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    if (isAjax(req)) return res.json({ status: 'success', message: 'Course recovered successfully.' });
    return res.redirect('/pte/courses');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function pickerTeachers(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_TEACHER_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const result = await pteCourseDataService.listPickerTeachers(
      filtered,
      req.user,
      {
        scopeId: req.accessScope
      },
      {
        paginated: true,
        pagination: { page, limit }
      }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const data = rows;
    const pagination = result?.pagination || paginate(rows, page, limit).pagination;
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function pickerStudents(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_STUDENT_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const result = await pteCourseDataService.listPickerStudents(
      filtered,
      req.user,
      {
        scopeId: req.accessScope
      },
      {
        paginated: true,
        pagination: { page, limit }
      }
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
  listCourses,
  showForm,
  saveCourse,
  archiveCourse,
  recoverCourse,
  pickerTeachers,
  pickerStudents
};
