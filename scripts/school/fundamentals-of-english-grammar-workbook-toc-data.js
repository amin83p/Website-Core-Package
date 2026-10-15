'use strict';

const fs = require('fs');
const path = require('path');

const LINES_PATH = path.join(__dirname, 'feg-workbook-toc-lines.txt');

function formatExerciseLabel(id, title) {
  if (/^\d+-\d+$/.test(id)) return `${id} ${title}`;
  if (/^A[12]-\d+$/.test(id)) return `${id} ${title}`;
  return title;
}

function buildFundamentalsWorkbookTocLabels() {
  const raw = fs.readFileSync(LINES_PATH, 'utf8');
  const rows = [];
  let app1HeaderAdded = false;
  let app2HeaderAdded = false;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    const parts = trimmed.split('|');
    if (parts.length < 3) continue;

    const id = parts[0].trim();
    const startPage = Number(parts[parts.length - 1]);
    const title = parts.slice(1, -1).join('|').trim();
    if (!Number.isFinite(startPage)) continue;

    if (id === 'CH') {
      rows.push({ level: 1, label: `Chapter ${parts[1]}: ${parts[2]}`, startPage });
      continue;
    }

    if (id === 'PREFACE') {
      rows.push({ level: 1, label: 'Preface', startPage });
      continue;
    }
    if (id === 'SPECIAL') {
      rows.push({ level: 1, label: 'Special Workbook Section', startPage });
      continue;
    }
    if (id === 'INDEX') {
      rows.push({ level: 1, label: 'Index', startPage });
      continue;
    }
    if (id === 'ANSWER') {
      rows.push({ level: 1, label: 'Answer Key', startPage });
      continue;
    }

    if (id.startsWith('A1-')) {
      if (!app1HeaderAdded) {
        rows.push({ level: 1, label: 'Appendix 1: Phrasal Verbs', startPage });
        app1HeaderAdded = true;
      }
      rows.push({ level: 2, label: formatExerciseLabel(id, title), startPage });
      continue;
    }

    if (id.startsWith('A2-')) {
      if (!app2HeaderAdded) {
        rows.push({ level: 1, label: 'Appendix 2: Preposition Combinations', startPage });
        app2HeaderAdded = true;
      }
      rows.push({ level: 2, label: formatExerciseLabel(id, title), startPage });
      continue;
    }

    rows.push({ level: 2, label: formatExerciseLabel(id, title), startPage });
  }

  return rows;
}

module.exports = { buildFundamentalsWorkbookTocLabels };
