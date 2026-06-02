const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
// MVC/models/school/classModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/MVC/models/fileQueue');
const finalGradesWorkflowService = require('../../services/school/finalGradesWorkflowService');
const fileAssetStorage = requireCoreModule('MVC/MVC/services/fileAssetStorageService');
const uploadFolderSettingsService = requireCoreModule('MVC/MVC/services/uploadFolderSettingsService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/classes.json');
const legacyStorageBasePath = path.join(resolveCoreRoot(), 'data/school/classes_storage');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 64, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanDateOnly(v, { allowEmpty = false } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? '' : null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return s;
}

function normalizeRegistrationMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'rolling' ? 'rolling' : 'term_based';
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function sanitizeOfficialFinalGrades(value) {
  return finalGradesWorkflowService.sanitizeOfficialFinalGradesMap(value);
}

function sanitizeAllowedProgramTerms(value, registrationMode = 'term_based') {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw new Error('Allowed program terms must be an array.');

  const rolling = normalizeRegistrationMode(registrationMode) === 'rolling';
  const pairSet = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error('Each allowed program term row must be an object.');
    const programId = cleanId(item.programId, { max: 64, allowEmpty: false });
    const termId = rolling
      ? (cleanId(item.termId, { max: 64, allowEmpty: true }) || '')
      : cleanId(item.termId, { max: 64, allowEmpty: false });
    if (!rolling && !termId) throw new Error('Each allowed program term row requires a term for term-based classes.');
    const key = termId ? `${programId}::${termId}` : `${programId}::__program_only__`;
    if (pairSet.has(key)) throw new Error(`Duplicate allowed program-term pair detected: ${programId} / ${termId || '(program only)'}`);
    pairSet.add(key);

    return {
      programId,
      termId,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : (index + 1),
      programCode: cleanString(item.programCode, { max: 40, allowEmpty: true }).toUpperCase(),
      programName: cleanString(item.programName, { max: 160, allowEmpty: true }),
      termCode: cleanString(item.termCode, { max: 40, allowEmpty: true }).toUpperCase(),
      termName: cleanString(item.termName, { max: 160, allowEmpty: true }),
      notes: cleanString(item.notes, { max: 300, allowEmpty: true })
    };
  }).sort((a, b) => a.order - b.order).map((item, index) => ({ ...item, order: index + 1 }));
}

function sanitizeClassBasic(item) {
  if (!item || typeof item !== 'object') throw new Error('Invalid class payload.');
  const registrationMode = normalizeRegistrationMode(item.registrationMode);
  const cycleStartDate = cleanDateOnly(item.cycleStartDate, { allowEmpty: true });
  const cycleEndDate = cleanDateOnly(item.cycleEndDate, { allowEmpty: true });
  if (cycleStartDate && cycleEndDate && cycleEndDate < cycleStartDate) {
    throw new Error('Cycle end date cannot be before cycle start date.');
  }
  const parsedCycleNo = Number.parseInt(String(item.cycleNo || '').trim(), 10);
  const cycleNo = Number.isFinite(parsedCycleNo) && parsedCycleNo > 0 ? parsedCycleNo : 1;
  const allowedProgramTerms = sanitizeAllowedProgramTerms(item.allowedProgramTerms, registrationMode);
  const officialFinalGrades = sanitizeOfficialFinalGrades(item.officialFinalGrades);
  return {
    ...item,
    orgId: cleanId(item.orgId, { max: 64, allowEmpty: false }),
    deliveryDepartmentId: cleanId(item.deliveryDepartmentId, { max: 64, allowEmpty: false }),
    deliveryDepartmentName: cleanString(item.deliveryDepartmentName, { max: 160, allowEmpty: true }),
    title: cleanString(item.title, { max: 160, allowEmpty: false }),
    status: cleanString(item.status, { max: 30, allowEmpty: true }) || 'active',
    registrationMode,
    cycleGroupId: cleanId(item.cycleGroupId, { max: 80, allowEmpty: true }),
    cycleStartDate,
    cycleEndDate,
    isClosedForNewEnrollment: toBoolean(item.isClosedForNewEnrollment, false),
    previousClassId: cleanId(item.previousClassId, { max: 64, allowEmpty: true }),
    nextClassId: cleanId(item.nextClassId, { max: 64, allowEmpty: true }),
    cycleNo,
    allowedProgramTerms,
    officialFinalGrades
  };
}
/* ============================================================
   HELPER: SESSION GENERATOR
============================================================ */
function generateInitialSessions(schedule) {
  const sessions = [];
  if (!schedule || !schedule.current) return sessions;
  
  const { startDate, endDate, daysOfWeek, startTime, endTime, exceptionDates } = schedule.current;
  if (!startDate || !endDate || !daysOfWeek || !daysOfWeek.length) return sessions;

  const dayMap = { "Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4, "Friday": 5, "Saturday": 6 };
  const allowedDays = daysOfWeek.map(d => dayMap[d]);
  const exceptions = new Set(exceptionDates || []);

  let current = new Date(startDate);
  const end = new Date(endDate);
  let sessionIndex = 1;

  // Calculate duration in hours once
  let duration = 0;
  if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      duration = (eh + em / 60) - (sh + sm / 60);
  }

  // Iterate day by day
  while (current <= end) {
      const dateString = current.toISOString().split('T')[0];
      
      if (allowedDays.includes(current.getDay()) && !exceptions.has(dateString)) {
          sessions.push({
              sessionId: `SES-${String(sessionIndex).padStart(3, '0')}`,
              originalDate: dateString,
              date: dateString,
              startTime: startTime || '',
              endTime: endTime || '',
              durationHours: duration > 0 ? Number(duration.toFixed(2)) : 0,
              status: "scheduled",
              
              delivery: {
                  deliveredBy: null,
                  substitute: false,
                  notes: ""
              },
              roster: []
          });
          sessionIndex++;
      }
      current.setDate(current.getDate() + 1); // Move to next day
  }
  return sessions;
}

/* ============================================================
   WORKSPACE CREATOR
============================================================ */
async function createClassWorkspace(classItem) {
  const scopeKey = classItem.orgId || 'GLOBAL';
  const relativeDir = uploadFolderSettingsService.resolveUploadFolder('school.classWorkspace', {
    classId: classItem.id
  });
  classItem.uploadWorkspace = {
    scopeKey: fileAssetStorage.normalizeScopeKey(scopeKey),
    relativePath: relativeDir
  };
  
  // 1. Create main directory and subfolders
  await fileAssetStorage.ensureDirectory(scopeKey, relativeDir);
  await fileAssetStorage.ensureDirectory(scopeKey, `${relativeDir}/materials`);
  await fileAssetStorage.ensureDirectory(scopeKey, `${relativeDir}/assignments`);
  await fileAssetStorage.ensureDirectory(scopeKey, `${relativeDir}/submissions`);

  // 2. Generate and write the Ledger (sessions.json)
  const sessions = generateInitialSessions(classItem.schedule);
  await fileAssetStorage.saveJson({ scopeKey, relativeDir, fileName: 'sessions.json', data: sessions });

  // 3. Create empty Gradebook
  await fileAssetStorage.saveJson({ scopeKey, relativeDir, fileName: 'gradebook.json', data: { assignments: [], grades: [] } });

  // 4. Create the structure.json manifest
  const initialStructure = {
    classId: classItem.id,
    title: classItem.title,
    createdOn: classItem.audit.createDateTime,
    folders: {
      "materials": "Contains curriculum copied from Subject blueprints",
      "assignments": "Instructor uploaded assignments/rubrics",
      "submissions": "Student uploaded homework"
    },
    files: ["sessions.json", "gradebook.json"]
  };
  await fileAssetStorage.saveJson({ scopeKey, relativeDir, fileName: 'structure.json', data: initialStructure });

  // 5. Copy Subject Materials into the Class Workspace
  if (classItem.curriculum && Array.isArray(classItem.curriculum.subjects)) {
      for (const sub of classItem.curriculum.subjects) {
          if (!sub.subjectId) continue;

          try {
              const sourceCandidates = [
                uploadFolderSettingsService.resolveUploadFolder('school.subjectWorkspace', {
                  subjectId: sub.subjectId
                }),
                uploadFolderSettingsService.resolveDefaultUploadFolder('school.subjectWorkspace', {
                  subjectId: sub.subjectId
                })
              ].filter(Boolean);
              let copiedSubject = false;
              for (const sourceRelativePath of [...new Set(sourceCandidates)]) {
                try {
                  // eslint-disable-next-line no-await-in-loop
                  const copied = await fileAssetStorage.copyRelativePath({
                    sourceScopeKey: scopeKey,
                    sourceRelativePath,
                    destinationScopeKey: scopeKey,
                    destinationDir: `${relativeDir}/materials`,
                    destinationName: sub.code || sub.subjectId
                  });
                  if (copied) {
                    copiedSubject = true;
                    break;
                  }
                } catch (_) {
                  // Try the next candidate path.
                }
              }
              if (!copiedSubject) throw new Error('Subject workspace folder was not found.');
          } catch (err) {
              console.warn(`[WARNING] Could not copy materials for subject ${sub.subjectId}:`, err.message);
              // We do not throw here, so the class creation doesn't crash if a folder is missing
          }
      }
  }
}

function getClassWorkspaceCandidates(classItem = {}) {
  const classId = String(classItem?.id || '').trim();
  const stored = String(classItem?.uploadWorkspace?.relativePath || '').trim();
  const candidates = [
    stored,
    classId ? uploadFolderSettingsService.resolveDefaultUploadFolder('school.classWorkspace', { classId }) : '',
    classId ? uploadFolderSettingsService.resolveUploadFolder('school.classWorkspace', { classId }) : ''
  ].filter(Boolean);
  return [...new Set(candidates)];
}

function getClassWorkspaceRelativePath(classItem = {}) {
  return getClassWorkspaceCandidates(classItem)[0] || '';
}

/* ============================================================
   CORE CRUD OPERATIONS
============================================================ */

async function getAllClasses() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve classes');
  }
}

async function getClassById(id) {
  const list = await getAllClasses();
  return list.find(c => String(c.id) === String(id));
}

function generateClassId() {
  const year = new Date().getFullYear();
  const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `CLS-${year}-${randomStr}`;
}

function validateData(item) {
  const errors = [];
  if (!item.orgId) errors.push('Organization Association is required.');
  if (!item.deliveryDepartmentId) errors.push('Delivery Department is required.');
  if (!item.title) errors.push('Class Title is required.');
  
  return errors.length ? { isValid: false, errors } : { isValid: true };
}

function normalizeClassTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function assertUniqueInOrg(list, candidate, { excludeId = null } = {}) {
  const candidateOrgId = String(candidate.orgId || '');
  const candidateTitle = normalizeClassTitle(candidate.title);

  const duplicateTitle = list.some((c) => {
    if (excludeId && String(c.id) === String(excludeId)) return false;
    return String(c.orgId || '') === candidateOrgId &&
      normalizeClassTitle(c.title) === candidateTitle;
  });
  if (duplicateTitle) throw new Error('Class title already exists in this organization.');
}

async function addClass(item, options = {}) {
  void options;
  return await queueWrite(async () => {
    const list = await getAllClasses();

    item = sanitizeClassBasic(item);
    
    item.id = generateClassId();
    
    const validity = validateData(item);
    if (!validity.isValid) throw new Error(validity.errors.join('\n'));
    assertUniqueInOrg(list, item);

    // Create physical folders, generated sessions, and copy materials FIRST
    await createClassWorkspace(item);

    list.push(item);
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
    return item;
  });
}

async function updateClass(id, updates, options = {}) {
  void options;
  return await queueWrite(async () => {
    const list = await getAllClasses();
    const index = list.findIndex(c => String(c.id) === String(id));
    if (index === -1) throw new Error('Class not found');

    const current = list[index];
    const merged = sanitizeClassBasic({ ...current, ...updates });

    const validity = validateData(merged);
    if (!validity.isValid) throw new Error(validity.errors.join('\n'));
    assertUniqueInOrg(list, merged, { excludeId: id });

    list[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
    return list[index];
  });
}

async function deleteClass(id, options = {}) {
  void options;
  await queueWrite(async () => {
    const list = await getAllClasses();
    const filtered = list.filter(c => String(c.id) !== String(id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    
    // Note: Like subjects, we deliberately leave the physical workspace orphaned 
    // to preserve session ledgers, grades, and student submissions for auditing.
  });
}

async function clearEnrollmentsByOrg(orgId, options = {}) {
  void options;
  return await queueWrite(async () => {
    const targetOrgId = String(orgId || '').trim();
    if (!targetOrgId) throw new Error('orgId is required to clear class enrollments.');

    const list = await getAllClasses();
    let removedEnrollments = 0;
    let classesTouched = 0;

    const updated = list.map((item) => {
      if (String(item?.orgId || '') !== targetOrgId) return item;
      const enrollment = item?.enrollment && typeof item.enrollment === 'object' ? item.enrollment : {};
      const students = Array.isArray(enrollment.students) ? enrollment.students : [];
      if (!students.length) return item;

      removedEnrollments += students.length;
      classesTouched += 1;
      return {
        ...item,
        enrollment: {
          ...enrollment,
          students: []
        }
      };
    });

    if (removedEnrollments > 0) {
      await fs.writeFile(dataPath, JSON.stringify(updated, null, 2));
    }

    const remainingEnrollmentsInOrg = updated
      .filter((item) => String(item?.orgId || '') === targetOrgId)
      .reduce((sum, item) => {
        const students = Array.isArray(item?.enrollment?.students) ? item.enrollment.students : [];
        return sum + students.length;
      }, 0);

    return {
      removedEnrollments,
      classesTouched,
      remainingEnrollmentsInOrg
    };
  });
}

/**
 * Deletes classes_storage/<classId>/ for each id (ENOENT ignored). Does not use fileQueue — safe to call from mongo cleanup.
 */
async function removePhysicalClassStorageByClassIds(classIds) {
  const ids = (Array.isArray(classIds) ? classIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (!ids.length) return { removedDirs: 0, errors: [] };
  let removedDirs = 0;
  const errors = [];
  for (const id of ids) {
    const classDirPath = path.join(legacyStorageBasePath, id);
    try {
      await fs.rm(classDirPath, { recursive: true, force: true });
      removedDirs += 1;
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        errors.push(`${id}: ${String(err?.message || err)}`);
      }
    }
  }
  return { removedDirs, errors };
}

/**
 * Removes per-class workspace under classes_storage/<classId>/ and clears embedded
 * `sessions` on each class row in classes.json (gradebooks, session ledger live there for the JSON backend).
 * Does not delete class rows.
 */
async function clearRuntimeStorageByOrg(orgId, options = {}) {
  void options;
  return await queueWrite(async () => {
    const targetOrgId = String(orgId || '').trim();
    if (!targetOrgId) throw new Error('orgId is required to clear class runtime storage.');

    const list = await getAllClasses();

    const nextList = list.map((item) => {
      if (String(item?.orgId || '') !== targetOrgId) return item;
      return { ...item, sessions: [] };
    });

    let jsonSessionsClearedClasses = 0;
    for (let i = 0; i < list.length; i += 1) {
      if (String(list[i]?.orgId || '') !== targetOrgId) continue;
      const before = Array.isArray(list[i]?.sessions) ? list[i].sessions.length : 0;
      const after = Array.isArray(nextList[i]?.sessions) ? nextList[i].sessions.length : 0;
      if (before > 0 && after === 0) jsonSessionsClearedClasses += 1;
    }

    const listChanged = JSON.stringify(list) !== JSON.stringify(nextList);
    if (listChanged) {
      await fs.writeFile(dataPath, JSON.stringify(nextList, null, 2));
    }

    const orgClasses = nextList
      .filter((item) => String(item?.orgId || '') === targetOrgId)
      .map((item) => ({
        id: String(item.id || '').trim(),
        orgId: String(item.orgId || '').trim(),
        uploadWorkspace: item.uploadWorkspace || null
      }))
      .filter((item) => item.id);
    const errors = [];
    let removedDirs = 0;
    for (const item of orgClasses) {
      try {
        const candidates = getClassWorkspaceCandidates(item);
        for (const relativePath of candidates) {
          // eslint-disable-next-line no-await-in-loop
          if (await fileAssetStorage.deleteRelativePath({ scopeKey: item.orgId, relativePath })) {
            removedDirs += 1;
          }
        }
      } catch (error) {
        errors.push(`${item.id}: ${String(error?.message || error)}`);
      }
    }
    const fsResult = await removePhysicalClassStorageByClassIds(orgClasses.map((item) => item.id));

    return {
      removedDirs: removedDirs + fsResult.removedDirs,
      errors: [...errors, ...(fsResult.errors || [])],
      jsonSessionsClearedClasses
    };
  });
}
/* ============================================================
   Sessions
============================================================ */

async function getClassSessions(classId) {
    const classItem = (await getAllClasses()).find((item) => String(item.id) === String(classId));
    const scopeKey = classItem?.orgId || 'GLOBAL';
    const candidates = getClassWorkspaceCandidates(classItem || { id: classId });
    for (const relativeDir of candidates) {
        const sessionUrl = fileAssetStorage.uploadsUrlForParts(scopeKey, relativeDir, 'sessions.json');
        try {
            // eslint-disable-next-line no-await-in-loop
            const data = await fileAssetStorage.readBuffer(sessionUrl);
            return JSON.parse(data.buffer.toString('utf8'));
        } catch (_) {
            // Try the next configured/default location.
        }
    }
    const legacySessionsPath = path.join(legacyStorageBasePath, String(classId), 'sessions.json');
    try {
        const data = await fs.readFile(legacySessionsPath, 'utf8');
        return JSON.parse(data);
    } catch (_) {
        return []; // Return empty array if no sessions file exists yet
    }
}

async function saveClassSessions(classId, sessions) {
    const classItem = (await getAllClasses()).find((item) => String(item.id) === String(classId));
    const scopeKey = classItem?.orgId || 'GLOBAL';
    const relativeDir = getClassWorkspaceRelativePath(classItem || { id: classId });
    
    await queueWrite(async () => {
        await fileAssetStorage.ensureDirectory(scopeKey, relativeDir);
        await fileAssetStorage.saveJson({
          scopeKey,
          relativeDir,
          fileName: 'sessions.json',
          data: sessions
        });
    });
}

module.exports = {
  getAllClasses,
  getClassById,
  addClass,
  updateClass,
  deleteClass,
  clearEnrollmentsByOrg,
  clearRuntimeStorageByOrg,
  getClassSessions,
  saveClassSessions,
  removePhysicalClassStorageByClassIds
};
