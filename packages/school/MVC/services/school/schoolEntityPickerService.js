const schoolDataService = require('./schoolDataService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { SECTIONS } = require('../../../config/accessConstants');

const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

const TARGET_ALIASES = Object.freeze({
  student: 'students',
  students: 'students',
  teacher: 'teachers',
  teachers: 'teachers',
  class: 'classes',
  classes: 'classes',
  staff: 'staff',
  funder: 'funders',
  funders: 'funders'
});

const TARGET_REGISTRY = Object.freeze({
  students: {
    target: 'students',
    itemType: 'student',
    implemented: true,
    levels: ['departments', 'classes', 'students'],
    terminalLevel: 'students',
    requiredAccessSections: [
      SECTIONS.SCHOOL_DEPARTMENTS,
      SECTIONS.SCHOOL_CLASSES,
      SECTIONS.SCHOOL_STUDENTS,
      SECTIONS.SCHOOL_ROLLING_ENROLLMENT
    ].filter(Boolean)
  },
  teachers: {
    target: 'teachers',
    itemType: 'teacher',
    implemented: true,
    levels: ['departments', 'teachers'],
    terminalLevel: 'teachers',
    requiredAccessSections: [
      SECTIONS.SCHOOL_DEPARTMENTS,
      SECTIONS.SCHOOL_TEACHERS
    ].filter(Boolean)
  },
  classes: {
    target: 'classes',
    itemType: 'class',
    implemented: false,
    levels: ['departments', 'classes'],
    terminalLevel: 'classes',
    requiredAccessSections: [
      SECTIONS.SCHOOL_DEPARTMENTS,
      SECTIONS.SCHOOL_CLASSES
    ].filter(Boolean)
  },
  staff: {
    target: 'staff',
    itemType: 'staff',
    implemented: false,
    levels: ['departments', 'staff'],
    terminalLevel: 'staff',
    requiredAccessSections: [
      SECTIONS.SCHOOL_DEPARTMENTS,
      SECTIONS.SCHOOL_STAFF
    ].filter(Boolean)
  },
  funders: {
    target: 'funders',
    itemType: 'funder',
    implemented: false,
    levels: ['funders'],
    terminalLevel: 'funders',
    requiredAccessSections: [
      SECTIONS.SCHOOL_FUNDERS
    ].filter(Boolean)
  }
});

function createHttpError(message, statusCode = 400, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeToken(value) {
  return String(value || '').trim();
}

function normalizeComparable(value) {
  return normalizeToken(value).toLowerCase();
}

function normalizeTarget(value) {
  const token = normalizeComparable(value || 'students');
  const target = TARGET_ALIASES[token];
  if (!target) {
    throw createHttpError(`Unsupported picker target: ${value || '(empty)'}`, 400, 'INVALID_PICKER_TARGET');
  }
  return target;
}

function normalizeLevel(value, targetDefinition) {
  const requested = normalizeComparable(value || targetDefinition.levels[0]);
  const aliases = {
    department: 'departments',
    departments: 'departments',
    class: 'classes',
    classes: 'classes',
    student: 'students',
    students: 'students',
    teacher: 'teachers',
    teachers: 'teachers',
    staff: 'staff',
    funder: 'funders',
    funders: 'funders'
  };
  const level = aliases[requested] || requested;
  if (!targetDefinition.levels.includes(level)) {
    throw createHttpError(`Unsupported picker level "${value}" for target "${targetDefinition.target}".`, 400, 'INVALID_PICKER_LEVEL');
  }
  return level;
}

function isHiddenByStatus(row, fieldNames = ['status']) {
  return fieldNames.some((field) => {
    const status = normalizeComparable(row?.[field]);
    return status === 'archived' || status === 'void';
  });
}

function rowMatchesOrg(row, activeOrgId) {
  const orgId = toPublicId(activeOrgId);
  if (!orgId) return true;
  const rowOrgId = toPublicId(row?.orgId);
  return !rowOrgId || idsEqual(rowOrgId, orgId);
}

function rowIsVisible(row, activeOrgId, statusFields = ['status']) {
  return rowMatchesOrg(row, activeOrgId) && !isHiddenByStatus(row, statusFields);
}

function getDisplayNameFromPerson(person, fallback = '') {
  const first = normalizeToken(person?.name?.first || person?.firstName);
  const last = normalizeToken(person?.name?.last || person?.lastName);
  const full = `${first} ${last}`.trim();
  return full || normalizeToken(person?.displayName || person?.name || fallback);
}

function getStudentStatus(student = {}) {
  return normalizeToken(student.academicStatus || student.status || '');
}

function getTeacherStatus(teacher = {}) {
  return normalizeToken(teacher.status || '');
}

function formatDepartmentLabel(department = {}) {
  const code = normalizeToken(department.code);
  const name = normalizeToken(department.name);
  if (code && name) return `${code} - ${name}`;
  return name || code || toPublicId(department.id) || 'Department';
}

function buildSearchText(chunks = []) {
  return chunks
    .map((value) => normalizeComparable(value))
    .filter(Boolean)
    .join(' ');
}

function matchesSearch(row, query) {
  const needle = normalizeComparable(query);
  if (!needle) return true;
  return normalizeComparable(row.searchText).includes(needle);
}

function parsePagination(query = {}) {
  const rawPage = Number.parseInt(String(query.page || '').trim(), 10);
  const rawLimit = Number.parseInt(String(query.limit || '').trim(), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : DEFAULT_PAGE;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;
  return { page, limit };
}

function paginateRows(rows, query = {}) {
  const { page, limit } = parsePagination(query);
  const source = Array.isArray(rows) ? rows : [];
  const totalItems = source.length;
  const totalPages = totalItems > 0 ? Math.ceil(totalItems / limit) : 1;
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * limit;
  return {
    rows: source.slice(start, start + limit),
    pagination: {
      currentPage,
      totalPages,
      totalItems,
      limit
    }
  };
}

function sortByLabel(a, b) {
  return normalizeComparable(a?.label).localeCompare(normalizeComparable(b?.label));
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeToken(value))
    .filter(Boolean))];
}

function buildBreadcrumb(rows = []) {
  return rows
    .filter((row) => row && row.level && row.label)
    .map((row) => ({
      level: row.level,
      id: normalizeToken(row.id),
      label: normalizeToken(row.label)
    }));
}

function createSchoolEntityPickerService(dependencies = {}) {
  const dataService = dependencies.schoolDataService || schoolDataService;
  const enrollmentReadService = dependencies.classEnrollmentReadService || classEnrollmentReadService;
  const personAccessService = dependencies.schoolPersonAccessService || schoolPersonAccessService;

  async function buildPersonByIdMap(reqUser, records = []) {
    const personIds = uniqueStrings(records.map((row) => toPublicId(row?.personId)));
    if (!personIds.length) return new Map();
    if (typeof personAccessService.buildPersonByIdMap === 'function') {
      return personAccessService.buildPersonByIdMap({ reqUser, personIds });
    }
    return new Map();
  }

  function formatPersonName(person, fallback) {
    if (person && typeof personAccessService.formatPersonName === 'function') {
      return personAccessService.formatPersonName(person, fallback);
    }
    return getDisplayNameFromPerson(person, fallback);
  }

  function readPersonEmail(person) {
    if (person && typeof personAccessService.readPersonEmail === 'function') {
      return personAccessService.readPersonEmail(person);
    }
    if (person?.email) return normalizeToken(person.email);
    const emails = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
    return normalizeToken(emails.find((row) => row?.isPrimary)?.email || emails[0]?.email || '');
  }

  async function fetchDepartments({ target, reqUser, accessContext = {}, query = {} } = {}) {
    const activeOrgId = toPublicId(reqUser?.activeOrgId || reqUser?.orgId || query.orgId);
    const nextLevel = target === 'teachers' ? 'teachers' : 'classes';
    const rows = await dataService.fetchAllData('departments', {}, reqUser, accessContext);
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => rowIsVisible(row, activeOrgId))
      .map((department) => {
        const label = formatDepartmentLabel(department);
        return {
          id: toPublicId(department.id),
          type: 'department',
          label,
          subtitle: normalizeToken(department.description || department.status || 'Department'),
          counts: {},
          selectable: false,
          nextLevel,
          meta: {
            departmentId: toPublicId(department.id),
            departmentName: label,
            code: normalizeToken(department.code),
            name: normalizeToken(department.name),
            status: normalizeToken(department.status)
          },
          searchText: buildSearchText([department.id, department.code, department.name, department.description, department.status])
        };
      })
      .filter((row) => row.id)
      .filter((row) => matchesSearch(row, query.q))
      .sort(sortByLabel);
  }

  async function findDepartment(departmentId, reqUser, accessContext = {}) {
    const id = toPublicId(departmentId);
    if (!id) return null;
    const departments = await dataService.fetchAllData('departments', {}, reqUser, accessContext);
    return (Array.isArray(departments) ? departments : []).find((row) => idsEqual(row?.id, id)) || null;
  }

  async function findClass(classId, reqUser, accessContext = {}) {
    const id = toPublicId(classId);
    if (!id) return null;
    const classes = await dataService.fetchAllData('classes', {}, reqUser, accessContext);
    return (Array.isArray(classes) ? classes : []).find((row) => idsEqual(row?.id, id)) || null;
  }

  async function buildClassStudentCount(classItem, { reqUser, activeOrgId, referenceDate } = {}) {
    if (!classItem?.id || typeof enrollmentReadService.listActiveStudentIdsForClass !== 'function') return 0;
    const resolution = await enrollmentReadService.listActiveStudentIdsForClass({
      classId: toPublicId(classItem.id),
      classItem,
      reqUser,
      activeOrgId,
      referenceDate,
      orgToday: referenceDate
    });
    return resolution?.studentIds instanceof Set ? resolution.studentIds.size : 0;
  }

  async function fetchClassesForDepartment({ reqUser, accessContext = {}, query = {} } = {}) {
    const departmentId = toPublicId(query.departmentId);
    if (!departmentId) throw createHttpError('departmentId is required for class picker options.', 400, 'MISSING_DEPARTMENT_ID');

    const activeOrgId = toPublicId(reqUser?.activeOrgId || reqUser?.orgId || query.orgId);
    const department = await findDepartment(departmentId, reqUser, accessContext);
    if (!department || !rowIsVisible(department, activeOrgId)) {
      throw createHttpError('Department was not found.', 404, 'DEPARTMENT_NOT_FOUND');
    }
    const rows = await dataService.fetchAllData('classes', {}, reqUser, accessContext);
    const classRows = (Array.isArray(rows) ? rows : [])
      .filter((row) => rowIsVisible(row, activeOrgId))
      .filter((row) => idsEqual(row?.deliveryDepartmentId, departmentId));

    const results = [];
    for (const classItem of classRows) {
      const classId = toPublicId(classItem.id);
      const label = normalizeToken(classItem.title || classItem.name || classId || 'Class');
      const studentCount = await buildClassStudentCount(classItem, {
        reqUser,
        activeOrgId,
        referenceDate: query.referenceDate
      });
      results.push({
        id: classId,
        type: 'class',
        label,
        subtitle: [
          normalizeToken(classItem.registrationMode),
          normalizeToken(classItem.status),
          normalizeToken(classItem.deliveryDepartmentName)
        ].filter(Boolean).join(' | ') || 'Class',
        counts: { students: studentCount },
        selectable: false,
        nextLevel: 'students',
        meta: {
          classId,
          classTitle: label,
          departmentId,
          departmentName: normalizeToken(classItem.deliveryDepartmentName),
          registrationMode: normalizeToken(classItem.registrationMode),
          status: normalizeToken(classItem.status)
        },
        searchText: buildSearchText([
          classItem.id,
          classItem.title,
          classItem.name,
          classItem.status,
          classItem.registrationMode,
          classItem.deliveryDepartmentName
        ])
      });
    }

    return results.filter((row) => matchesSearch(row, query.q)).sort(sortByLabel);
  }

  async function fetchStudentsForClass({ reqUser, accessContext = {}, query = {} } = {}) {
    const departmentId = toPublicId(query.departmentId);
    const classId = toPublicId(query.classId);
    if (!departmentId) throw createHttpError('departmentId is required for student picker options.', 400, 'MISSING_DEPARTMENT_ID');
    if (!classId) throw createHttpError('classId is required for student picker options.', 400, 'MISSING_CLASS_ID');

    const activeOrgId = toPublicId(reqUser?.activeOrgId || reqUser?.orgId || query.orgId);
    const [department, classItem, studentRows] = await Promise.all([
      findDepartment(departmentId, reqUser, accessContext),
      findClass(classId, reqUser, accessContext),
      dataService.fetchAllData('students', {}, reqUser, accessContext)
    ]);
    if (!department || !rowIsVisible(department, activeOrgId)) {
      throw createHttpError('Department was not found.', 404, 'DEPARTMENT_NOT_FOUND');
    }
    if (
      !classItem
      || !rowIsVisible(classItem, activeOrgId)
      || !idsEqual(classItem?.deliveryDepartmentId, departmentId)
    ) {
      throw createHttpError('Class was not found under the selected department.', 404, 'CLASS_NOT_FOUND');
    }

    const roster = await enrollmentReadService.listActiveStudentIdsForClass({
      classId,
      classItem,
      reqUser,
      activeOrgId,
      referenceDate: query.referenceDate,
      orgToday: query.referenceDate
    });
    const studentIds = roster?.studentIds instanceof Set ? roster.studentIds : new Set();
    const visibleStudents = (Array.isArray(studentRows) ? studentRows : [])
      .filter((student) => rowMatchesOrg(student, activeOrgId))
      .filter((student) => !isHiddenByStatus(student, ['academicStatus', 'status']))
      .filter((student) => studentIds.has(toPublicId(student?.id)));
    const personById = await buildPersonByIdMap(reqUser, visibleStudents);
    const departmentName = formatDepartmentLabel(department || {
      id: departmentId,
      name: normalizeToken(classItem.deliveryDepartmentName)
    });
    const classTitle = normalizeToken(classItem.title || classItem.name || classId);

    return visibleStudents.map((student) => {
      const person = personById.get(toPublicId(student.personId));
      const label = formatPersonName(person, normalizeToken(student.name || student.id || 'Student'));
      const email = readPersonEmail(person);
      const subtitle = [
        normalizeToken(student.customStudentId || student.localId || student.id),
        email,
        normalizeToken(student.feeCategory),
        getStudentStatus(student)
      ].filter(Boolean).join(' | ');
      return {
        id: toPublicId(student.id),
        type: 'student',
        label,
        subtitle,
        counts: {},
        selectable: true,
        nextLevel: null,
        meta: {
          studentId: toPublicId(student.id),
          personId: toPublicId(student.personId),
          customStudentId: normalizeToken(student.customStudentId),
          email,
          status: getStudentStatus(student),
          selectedFrom: [{
            departmentId,
            departmentName,
            classId,
            classTitle
          }]
        },
        searchText: buildSearchText([
          student.id,
          student.customStudentId,
          student.localId,
          student.feeCategory,
          student.academicStatus,
          label,
          email
        ])
      };
    }).filter((row) => matchesSearch(row, query.q)).sort(sortByLabel);
  }

  async function fetchTeachersForDepartment({ reqUser, accessContext = {}, query = {} } = {}) {
    const departmentId = toPublicId(query.departmentId);
    if (!departmentId) throw createHttpError('departmentId is required for teacher picker options.', 400, 'MISSING_DEPARTMENT_ID');

    const activeOrgId = toPublicId(reqUser?.activeOrgId || reqUser?.orgId || query.orgId);
    const [department, teacherRows] = await Promise.all([
      findDepartment(departmentId, reqUser, accessContext),
      dataService.fetchAllData('teachers', {}, reqUser, accessContext)
    ]);
    if (!department || !rowIsVisible(department, activeOrgId)) {
      throw createHttpError('Department was not found.', 404, 'DEPARTMENT_NOT_FOUND');
    }
    const visibleTeachers = (Array.isArray(teacherRows) ? teacherRows : [])
      .filter((teacher) => rowIsVisible(teacher, activeOrgId))
      .filter((teacher) => idsEqual(teacher?.departmentId, departmentId));
    const personById = await buildPersonByIdMap(reqUser, visibleTeachers);
    const departmentName = formatDepartmentLabel(department || { id: departmentId });

    return visibleTeachers.map((teacher) => {
      const teacherId = toPublicId(teacher.id);
      const person = personById.get(toPublicId(teacher.personId));
      const label = formatPersonName(person, normalizeToken(teacher.name || teacherId || 'Teacher'));
      const email = readPersonEmail(person);
      const subtitle = [
        normalizeToken(teacher.employeeNumber || teacher.employeeNo),
        email,
        normalizeToken(teacher.employmentType),
        getTeacherStatus(teacher)
      ].filter(Boolean).join(' | ');
      return {
        id: teacherId,
        type: 'teacher',
        label,
        subtitle,
        counts: {},
        selectable: true,
        nextLevel: null,
        meta: {
          teacherId,
          personId: toPublicId(teacher.personId),
          email,
          status: getTeacherStatus(teacher),
          departmentId,
          departmentName,
          selectedFrom: [{
            departmentId,
            departmentName
          }]
        },
        searchText: buildSearchText([
          teacher.id,
          teacher.employeeNumber,
          teacher.employeeNo,
          teacher.employmentType,
          teacher.status,
          label,
          email,
          departmentName
        ])
      };
    }).filter((row) => matchesSearch(row, query.q)).sort(sortByLabel);
  }

  async function buildBreadcrumbForQuery({ target, level, query, reqUser, accessContext }) {
    const rows = [];
    if (level === 'departments') return rows;

    const departmentId = toPublicId(query.departmentId);
    if (departmentId) {
      const department = await findDepartment(departmentId, reqUser, accessContext);
      rows.push({
        level: 'departments',
        id: departmentId,
        label: formatDepartmentLabel(department || { id: departmentId })
      });
    }

    if (target === 'students' && level === 'students') {
      const classId = toPublicId(query.classId);
      if (classId) {
        const classItem = await findClass(classId, reqUser, accessContext);
        rows.push({
          level: 'classes',
          id: classId,
          label: normalizeToken(classItem?.title || classItem?.name || classId)
        });
      }
    }

    return buildBreadcrumb(rows);
  }

  async function listRows({ target, level, query, reqUser, accessContext }) {
    if (level === 'departments') {
      return fetchDepartments({ target, reqUser, accessContext, query });
    }
    if (target === 'students' && level === 'classes') {
      return fetchClassesForDepartment({ reqUser, accessContext, query });
    }
    if (target === 'students' && level === 'students') {
      return fetchStudentsForClass({ reqUser, accessContext, query });
    }
    if (target === 'teachers' && level === 'teachers') {
      return fetchTeachersForDepartment({ reqUser, accessContext, query });
    }
    throw createHttpError(`Picker level "${level}" is not implemented for target "${target}".`, 501, 'PICKER_LEVEL_NOT_IMPLEMENTED');
  }

  async function listOptions({ query = {}, reqUser, accessContext = {} } = {}) {
    const target = normalizeTarget(query.target || 'students');
    const definition = TARGET_REGISTRY[target];
    if (!definition) throw createHttpError(`Unsupported picker target: ${target}`, 400, 'INVALID_PICKER_TARGET');
    if (!definition.implemented) {
      throw createHttpError(`Picker target "${target}" is registered but not implemented yet.`, 501, 'PICKER_TARGET_NOT_IMPLEMENTED');
    }
    const level = normalizeLevel(query.level, definition);
    const rows = await listRows({ target, level, query, reqUser, accessContext });
    const { rows: pageRows, pagination } = paginateRows(rows, query);
    return {
      status: 'success',
      target,
      level,
      breadcrumb: await buildBreadcrumbForQuery({ target, level, query, reqUser, accessContext }),
      results: pageRows.map(({ searchText, ...row }) => row),
      pagination
    };
  }

  function getRequiredAccessSections(targetInput) {
    const target = normalizeTarget(targetInput || 'students');
    const definition = TARGET_REGISTRY[target];
    if (!definition) throw createHttpError(`Unsupported picker target: ${target}`, 400, 'INVALID_PICKER_TARGET');
    return uniqueStrings(definition.requiredAccessSections);
  }

  function getTargetDefinition(targetInput) {
    const target = normalizeTarget(targetInput || 'students');
    return TARGET_REGISTRY[target] || null;
  }

  return {
    TARGET_REGISTRY,
    getRequiredAccessSections,
    getTargetDefinition,
    listOptions,
    normalizeLevel,
    normalizeTarget
  };
}

const defaultService = createSchoolEntityPickerService();

module.exports = {
  ...defaultService,
  createSchoolEntityPickerService
};
