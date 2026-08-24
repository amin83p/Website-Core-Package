'use strict';

const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function isDateOnly(value) {
  const token = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return false;
  const parsed = new Date(`${token}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === token;
}

function normalizeProgramRegistrationRow(item, index, admissionDate) {
  const row = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
  const programId = toPublicId(row.programId);
  const registrationDate = String(row.registrationDate || '').trim();
  if (!programId) throw new Error(`Program registration row ${index + 1} is missing a program.`);
  if (!isDateOnly(registrationDate)) {
    throw new Error(`Program registration row ${index + 1} has an invalid Registration Date.`);
  }
  const normalizedAdmissionDate = String(admissionDate || '').trim();
  if (normalizedAdmissionDate && registrationDate < normalizedAdmissionDate) {
    throw new Error(`Program registration date for row ${index + 1} must be on or after the Admission Date.`);
  }
  return {
    programId,
    registrationDate,
    externalReference: String(row.externalReference || '').trim().slice(0, 200),
    note: String(row.note || '').trim().slice(0, 2000)
  };
}

function parseProgramRegistrationSelectionRows(rawSelections) {
  const rows = parseJsonSafe(rawSelections, []);
  if (!Array.isArray(rows)) throw new Error('Program registration selections must be an array.');
  const seenProgramIds = new Set();
  return rows.map((row, index) => {
    const item = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
    const programId = toPublicId(item.programId);
    const registrationDate = String(item.registrationDate || '').trim();
    if (!programId) throw new Error(`Program registration row ${index + 1} is missing a program.`);
    if (seenProgramIds.has(programId)) throw new Error('Select each program only once.');
    seenProgramIds.add(programId);
    if (!isDateOnly(registrationDate)) {
      throw new Error(`Program registration row ${index + 1} has an invalid Registration Date.`);
    }
    return {
      programId,
      registrationDate,
      externalReference: String(item.externalReference || '').trim().slice(0, 200),
      note: String(item.note || '').trim().slice(0, 2000)
    };
  });
}

function normalizeProgramRegistrationSelections(rawSelections, admissionDate) {
  const rows = parseJsonSafe(rawSelections, []);
  if (!Array.isArray(rows)) throw new Error('Program registration selections must be an array.');
  const normalizedAdmissionDate = String(admissionDate || '').trim();
  if (rows.length && !isDateOnly(normalizedAdmissionDate)) {
    throw new Error('Admission Date is required before adding program registrations.');
  }
  const seenProgramIds = new Set();
  return rows.map((row, index) => {
    const normalized = normalizeProgramRegistrationRow(row, index, normalizedAdmissionDate);
    if (seenProgramIds.has(normalized.programId)) throw new Error('Select each program only once.');
    seenProgramIds.add(normalized.programId);
    return normalized;
  });
}

function validateProgramSelectionsForStudent(selections, studentEnrollmentDate) {
  const rows = Array.isArray(selections) ? selections : [];
  const enrollmentDate = String(studentEnrollmentDate || '').trim();
  if (!rows.length) return [];
  if (!isDateOnly(enrollmentDate)) {
    throw new Error('Student enrollment date is required before program registrations can run.');
  }
  return rows.map((row, index) => normalizeProgramRegistrationRow(row, index, enrollmentDate));
}

module.exports = {
  parseJsonSafe,
  isDateOnly,
  parseProgramRegistrationSelectionRows,
  normalizeProgramRegistrationSelections,
  validateProgramSelectionsForStudent
};
