const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const overallReportTemplateModel = require('../../packages/school/MVC/models/school/overallReportTemplateModel');

const DAY_COUNT = 31;
const DEFAULT_TEMPLATE_ID = '495502';
const DEFAULT_TITLE_PATTERN = /Monthly Attendance Report - Two Classes/i;

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  });
}

function padDay(dayNo) {
  return String(dayNo).padStart(2, '0');
}

function buildPresenceExpression(day) {
  return `twoClassPresence(source("T1", "attendance_presence_${day}"), source("T2", "attendance_presence_${day}"))`;
}

function buildNoteExpression(day) {
  return [
    'twoClassNote(',
    `source("T1", "attendance_presence_${day}"), source("T1", "attendance_note_${day}"),`,
    `source("T2", "attendance_presence_${day}"), source("T2", "attendance_note_${day}")`,
    ')'
  ].join(' ');
}

function updateDayField(field, day) {
  const match = String(field?.id || '').match(/^day(\d{2})_(yn|note)$/);
  if (!match || match[1] !== day) return field;
  const kind = match[2];
  const expression = kind === 'yn' ? buildPresenceExpression(day) : buildNoteExpression(day);
  return {
    ...field,
    overallValueMode: 'derived_locked',
    readOnly: true,
    calculationRule: {
      enabled: true,
      expression,
      onError: 'keep_last'
    }
  };
}

function assertSourceSlots(sourceSlots = []) {
  const slots = Array.isArray(sourceSlots) ? sourceSlots : [];
  if (slots.length < 2) {
    throw new Error('Template must define at least two source slots (T1 and T2).');
  }
  const t1 = slots.find((slot) => String(slot?.slotKey || '').toUpperCase() === 'T1');
  const t2 = slots.find((slot) => String(slot?.slotKey || '').toUpperCase() === 'T2');
  if (!t1 || !t2) throw new Error('Template must include source slots T1 and T2.');
  if (String(t1.requirement || 'necessary').toLowerCase() !== 'necessary'
    || String(t2.requirement || 'necessary').toLowerCase() !== 'necessary') {
    throw new Error('Both T1 and T2 must be marked as necessary source slots.');
  }
}

async function main() {
  loadEnv();
  const templateId = String(process.argv[2] || DEFAULT_TEMPLATE_ID).trim();
  const titleArg = process.argv[3] ? new RegExp(process.argv[3], 'i') : DEFAULT_TITLE_PATTERN;
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured.');

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || 'app').collection('schoolOverallReportTemplates');

  const existing = titleArg
    ? await col.findOne({ title: titleArg })
    : await col.findOne({ id: templateId });
  if (!existing) throw new Error('Overall report template not found.');

  assertSourceSlots(existing.sourceSlots);

  const updatedFields = (existing.schema?.fields || []).map((field) => {
    const match = String(field?.id || '').match(/^day(\d{2})_(yn|note)$/);
    if (!match) return field;
    return updateDayField(field, match[1]);
  });

  const dayFieldCount = updatedFields.filter((field) => /^day\d{2}_(yn|note)$/.test(String(field.id))).length;
  if (dayFieldCount < DAY_COUNT * 2) {
    throw new Error(`Expected ${DAY_COUNT * 2} day fields, found ${dayFieldCount}.`);
  }

  const sanitized = overallReportTemplateModel.sanitizeTemplate({
    ...existing,
    schema: {
      ...(existing.schema || {}),
      fields: updatedFields
    }
  }, { existing, isUpdate: true });

  const result = await col.updateOne(
    { id: existing.id },
    {
      $set: {
        schema: sanitized.schema,
        placeholderMap: sanitized.placeholderMap,
        'audit.lastUpdateDateTime': new Date().toISOString()
      }
    }
  );

  const day01Yn = sanitized.schema.fields.find((field) => field.id === 'day01_yn');
  const day01Note = sanitized.schema.fields.find((field) => field.id === 'day01_note');

  console.log(JSON.stringify({
    templateId: existing.id,
    title: existing.title,
    matched: result.matchedCount,
    modified: result.modifiedCount,
    dayFieldCount,
    day01YnExpression: day01Yn?.calculationRule?.expression || '',
    day01NoteExpression: day01Note?.calculationRule?.expression || ''
  }, null, 2));

  await client.close();
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
