#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const STUDENTS_PATH = path.join(ROOT_DIR, 'data/school/students.json');

function normalizeEvaluationType(value) {
  const token = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (token === 'placement' || token === 'placementtest' || token === 'placement_test') return 'placement_test';
  if (token === 'teacher') return 'teacher';
  if (token === 'referral' || token === 'referel') return 'referral';
  return 'referral';
}

function backfillStudent(student) {
  if (!student || typeof student !== 'object') return { touched: false };
  const history = Array.isArray(student.clbLevelHistory) ? student.clbLevelHistory : [];
  if (!history.length) return { touched: false };
  let touched = false;
  student.clbLevelHistory = history.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const next = { ...entry };
    const prevType = String(entry.evaluationType || '').trim();
    const evaluationType = normalizeEvaluationType(prevType || 'referral');
    if (!prevType || evaluationType !== prevType) {
      next.evaluationType = evaluationType;
      touched = true;
    } else if (!next.evaluationType) {
      next.evaluationType = evaluationType;
      touched = true;
    }
    if (evaluationType !== 'teacher') {
      if (next.evaluationTeacherId) {
        next.evaluationTeacherId = '';
        touched = true;
      }
      if (next.evaluationTeacherLabel) {
        next.evaluationTeacherLabel = '';
        touched = true;
      }
    }
    if (next.note === undefined) {
      next.note = '';
    }
    return next;
  });
  return { touched };
}

function main() {
  const apply = process.argv.includes('--apply');
  if (!fs.existsSync(STUDENTS_PATH)) {
    console.error('Students file not found:', STUDENTS_PATH);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(STUDENTS_PATH, 'utf8'));
  const students = Array.isArray(raw) ? raw : [];
  let studentsTouched = 0;
  let entriesTouched = 0;
  students.forEach((student) => {
    const { touched } = backfillStudent(student);
    if (touched) {
      studentsTouched += 1;
      entriesTouched += (Array.isArray(student.clbLevelHistory) ? student.clbLevelHistory : []).length;
    }
  });
  console.log(`Students with CLB history updates: ${studentsTouched} (${entriesTouched} entries normalized)`);
  if (!apply) {
    console.log('Dry run only. Pass --apply to write students.json.');
    return;
  }
  fs.writeFileSync(STUDENTS_PATH, `${JSON.stringify(students, null, 2)}\n`, 'utf8');
  console.log('Wrote', STUDENTS_PATH);
}

main();
