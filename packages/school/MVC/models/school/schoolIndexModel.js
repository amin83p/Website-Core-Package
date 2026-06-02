const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
// MVC/models/school/schoolIndexModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue'); // Ensures file lock safety

const teachersIndexPath = path.join(resolveCoreRoot(), 'data/school/teacher_schedules.json');
const studentsIndexPath = path.join(resolveCoreRoot(), 'data/school/student_enrollments.json');

// Helper to safely read JSON files
async function safeReadJSON(filePath, defaultStructure = {}) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);

    // ✅ Hard guard: if file contains null / non-object, reset
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      await fs.writeFile(filePath, JSON.stringify(defaultStructure, null, 2));
      return defaultStructure;
    }

    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(defaultStructure, null, 2));
      return defaultStructure;
    }
    throw err;
  }
}

async function getTeacherIndex() { return await safeReadJSON(teachersIndexPath, {}); }
async function getStudentIndex() { return await safeReadJSON(studentsIndexPath, {}); }

async function saveTeacherIndex(data) {
    await queueWrite(async () => {
        await fs.writeFile(teachersIndexPath, JSON.stringify(data, null, 2));
    });
}

async function saveStudentIndex(data) {
    await queueWrite(async () => {
        await fs.writeFile(studentsIndexPath, JSON.stringify(data, null, 2));
    });
}

module.exports = {
    getTeacherIndex,
    getStudentIndex,
    saveTeacherIndex,
    saveStudentIndex
};

