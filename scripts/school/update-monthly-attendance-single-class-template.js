const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const overallReportTemplateModel = require('../../packages/school/MVC/models/school/overallReportTemplateModel');

const DAY_COUNT = 31;
const DEFAULT_TEMPLATE_ID = '940985';
const DEFAULT_TITLE_PATTERN = /Monthly Attendance Report - Single Class/i;
const REMOVED_FIELD_IDS = new Set(['am_class', 'pm_class']);

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
  return `source("T1", "attendance_presence_${day}")`;
}

function buildNoteExpression(day) {
  return `source("T1", "attendance_note_${day}")`;
}

function buildSingleSourceSlots(existingSlots = []) {
  const slots = Array.isArray(existingSlots) ? existingSlots : [];
  const t1 = slots.find((slot) => String(slot?.slotKey || '').toUpperCase() === 'T1');
  if (!t1) throw new Error('Template must include source slot T1.');
  return [{
    slotKey: 'T1',
    order: 1,
    templateId: String(t1.templateId || '').trim(),
    templateVersionAtSelection: Number(t1.templateVersionAtSelection || t1.templateVersion || 1) || 1,
    requirement: 'necessary'
  }];
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

function transformTemplateFields(fields = []) {
  const rows = Array.isArray(fields) ? fields : [];
  const updatedFields = rows
    .filter((field) => !REMOVED_FIELD_IDS.has(String(field?.id || '').trim()))
    .map((field) => {
      const match = String(field?.id || '').match(/^day(\d{2})_(yn|note)$/);
      if (!match) return field;
      return updateDayField(field, match[1]);
    });

  const dayFieldCount = updatedFields.filter((field) => /^day\d{2}_(yn|note)$/.test(String(field.id))).length;
  if (dayFieldCount < DAY_COUNT * 2) {
    throw new Error(`Expected ${DAY_COUNT * 2} day fields, found ${dayFieldCount}.`);
  }

  assertNoTwoClassReferences(updatedFields);
  return updatedFields;
}

function assertNoTwoClassReferences(fields = []) {
  const offenders = [];
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    const expression = String(field?.calculationRule?.expression || '');
    if (!expression) return;
    if (/\bT2\b/i.test(expression) || /\btwoClass/i.test(expression)) {
      offenders.push(String(field.id || '(unknown)'));
    }
  });
  if (offenders.length) {
    throw new Error(`Fields still reference T2 or twoClass helpers: ${offenders.slice(0, 8).join(', ')}${offenders.length > 8 ? '…' : ''}`);
  }
}

function buildSanitizedSingleClassTemplate(existing = {}) {
  const sourceSlots = buildSingleSourceSlots(existing.sourceSlots);
  const updatedFields = transformTemplateFields(existing.schema?.fields || []);
  return overallReportTemplateModel.sanitizeTemplate({
    ...existing,
    sourceSlots,
    schema: {
      ...(existing.schema || {}),
      fields: updatedFields
    }
  }, { existing, isUpdate: true });
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

  const sanitized = buildSanitizedSingleClassTemplate(existing);

  const result = await col.updateOne(
    { id: existing.id },
    {
      $set: {
        sourceSlots: sanitized.sourceSlots,
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
    sourceSlotCount: sanitized.sourceSlots?.length || 0,
    removedFields: [...REMOVED_FIELD_IDS],
    day01YnExpression: day01Yn?.calculationRule?.expression || '',
    day01NoteExpression: day01Note?.calculationRule?.expression || ''
  }, null, 2));

  await client.close();
}

module.exports = {
  DAY_COUNT,
  REMOVED_FIELD_IDS,
  buildPresenceExpression,
  buildNoteExpression,
  buildSingleSourceSlots,
  transformTemplateFields,
  buildSanitizedSingleClassTemplate
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
  });
}
