const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const IMPORT_HEADERS = [
  'firstName',
  'lastName',
  'preferredName',
  'gender',
  'enrollmentDate',
  'feeCategory',
  'clbCurrent',
  'localId',
  'notes'
];

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map((part) => part.text).join('');
    if (value.result != null) return String(value.result);
    if (value.text != null) return String(value.text);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function normalizeName(value) {
  return cellText(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function parsePreferredName(rawFirstName) {
  const firstName = cellText(rawFirstName).trim();
  const match = firstName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!match) return { firstName, preferredName: '' };
  return {
    firstName: match[1].trim(),
    preferredName: match[2].trim()
  };
}

function inferFeeCategory(localId) {
  const token = String(localId || '').trim();
  return /^f\s*\d/i.test(token) ? 'Funded' : 'Domestic';
}

function normalizeLocalId(localId) {
  return String(localId || '').trim().replace(/\s+/g, '');
}

function buildClassLabel(sheetName) {
  const token = String(sheetName || '').trim();
  if (/pm/i.test(token)) return `Taylor Reimer PM`;
  if (/am/i.test(token)) return `Taylor Reimer AM`;
  return token || 'Class';
}

function extractClassName(worksheet) {
  const row = worksheet.getRow(2);
  let best = '';
  for (let col = 1; col <= worksheet.columnCount; col++) {
    const value = cellText(row.getCell(col).value).trim();
    if (!value || /^class:?$/i.test(value)) continue;
    if (/attendance list|esl/i.test(value) || value.length > best.length) {
      best = value;
    }
  }
  return best || buildClassLabel(worksheet.name);
}

function findHeaderIndexes(values) {
  const indexes = {
    localId: -1,
    lastName: -1,
    firstName: -1,
    comment: -1,
    endDate: -1,
    clb: -1
  };

  values.forEach((value, index) => {
    const token = cellText(value).trim().toLowerCase();
    if (token === '#') indexes.localId = index;
    if (token.includes('last name')) indexes.lastName = index;
    if (token.includes('first name')) indexes.firstName = index;
    if (token === 'comment') indexes.comment = index;
    if (token.includes('start/end date')) indexes.endDate = index;
    if (token.includes('clb')) indexes.clb = index;
  });

  return indexes;
}

function parseSheetStudents(worksheet) {
  const classLabel = buildClassLabel(worksheet.name);
  const className = extractClassName(worksheet);
  const students = [];
  let headerIndexes = null;

  worksheet.eachRow((row) => {
    const values = row.values.slice(1).map(cellText);

    if (!headerIndexes) {
      const candidate = findHeaderIndexes(values);
      if (candidate.lastName !== -1 && candidate.firstName !== -1) {
        headerIndexes = candidate;
      }
      return;
    }

    const lastName = values[headerIndexes.lastName]?.trim();
    const rawFirstName = values[headerIndexes.firstName]?.trim();
    if (!lastName || !rawFirstName) return;
    if (/^(last name|first name|tue|wed|thu|mon)$/i.test(lastName)) return;
    if (/^(last name|first name)$/i.test(rawFirstName)) return;
    if (/^part-time$/i.test(lastName)) return;

    const { firstName, preferredName } = parsePreferredName(rawFirstName);
    const localId = normalizeLocalId(values[headerIndexes.localId]);
    const comment = headerIndexes.comment !== -1 ? values[headerIndexes.comment]?.trim() : '';
    const endDate = headerIndexes.endDate !== -1 ? values[headerIndexes.endDate]?.trim() : '';
    const clbCurrent = headerIndexes.clb !== -1 ? values[headerIndexes.clb]?.trim() : '';

    const noteParts = [`Class (${classLabel}): ${className}`];
    if (endDate) noteParts.push(`Program end: ${endDate}`);
    if (comment) noteParts.push(comment);

    students.push({
      key: `${normalizeName(lastName)}|${normalizeName(firstName)}`,
      firstName,
      lastName,
      preferredName,
      gender: 'other',
      enrollmentDate: '2026-08-01',
      feeCategory: inferFeeCategory(localId),
      clbCurrent,
      localId,
      classLabel,
      notes: noteParts.join(' | ')
    });
  });

  return students;
}

function mergeStudents(entries) {
  const merged = new Map();

  entries.forEach((entry) => {
    const existing = merged.get(entry.key);
    if (!existing) {
      merged.set(entry.key, { ...entry });
      return;
    }

    if (!existing.notes.includes(entry.classLabel)) {
      existing.notes += ` | Also enrolled: ${entry.classLabel}`;
    }
    if (!existing.clbCurrent && entry.clbCurrent) existing.clbCurrent = entry.clbCurrent;
    if (!existing.localId && entry.localId) existing.localId = entry.localId;
    if (!existing.preferredName && entry.preferredName) existing.preferredName = entry.preferredName;
    if (existing.feeCategory !== 'Funded' && entry.feeCategory === 'Funded') {
      existing.feeCategory = 'Funded';
    }
  });

  return Array.from(merged.values()).sort((a, b) => {
    const lastCmp = a.lastName.localeCompare(b.lastName);
    if (lastCmp !== 0) return lastCmp;
    return a.firstName.localeCompare(b.firstName);
  });
}

async function convertEalAttendanceImport(inputFilePath, outputFilePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputFilePath);

  const allStudents = [];
  workbook.eachSheet((worksheet) => {
    allStudents.push(...parseSheetStudents(worksheet));
  });

  const students = mergeStudents(allStudents);
  const lines = [IMPORT_HEADERS.join(',')];
  students.forEach((student) => {
    lines.push(IMPORT_HEADERS.map((header) => escapeCsv(student[header])).join(','));
  });

  fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
  fs.writeFileSync(outputFilePath, `${lines.join('\n')}\n`, 'utf8');

  return {
    outputFilePath,
    sheetCount: workbook.worksheets.length,
    rawRows: allStudents.length,
    mergedRows: students.length
  };
}

if (require.main === module) {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    console.error('Usage: node scripts/convertEalAttendanceImport.js <input.xlsx> <output.csv>');
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  convertEalAttendanceImport(inputPath, outputPath)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  convertEalAttendanceImport,
  parseSheetStudents,
  mergeStudents
};
