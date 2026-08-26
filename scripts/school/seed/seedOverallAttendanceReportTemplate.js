const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

loadDotEnv();

const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../MVC/infrastructure/mongo/mongoConnection');
const reportTemplateModel = require('../../../packages/school/MVC/models/school/reportTemplateModel');

const TEMPLATE_ID = 'RPTTPL-2026-OVERALL-ATTENDANCE';
const ORG_ID = process.env.SCHOOL_REPORT_TEMPLATE_ORG_ID || process.env.ACTIVE_ORG_ID || '900000';
const SYSTEM_USER_ID = process.env.SCHOOL_REPORT_TEMPLATE_SEED_USER || 'ROOT_001';

function baseField({
  id,
  label,
  prefillKey = '',
  type = 'text',
  readOnly = true,
  fullPageWidth = false,
  helpText = ''
}) {
  return {
    id,
    label,
    type,
    required: false,
    readOnly,
    sharedAcrossStudents: false,
    fullPageWidth,
    valueMode: 'manual',
    calculationRule: { enabled: false, expression: '', onError: 'keep_last' },
    calculationDependencies: [],
    hasBorder: false,
    backgroundColor: '',
    exportTextCase: 'as_entered',
    docxAlias: '',
    prefillKey,
    helpText,
    placeholder: '',
    options: [],
    validationRules: [],
    conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
  };
}

function visualField(id, label, type = 'subheader') {
  return {
    id,
    label,
    type,
    required: false,
    readOnly: false,
    sharedAcrossStudents: false,
    fullPageWidth: true,
    valueMode: 'manual',
    calculationRule: { enabled: false, expression: '', onError: 'keep_last' },
    calculationDependencies: [],
    hasBorder: false,
    backgroundColor: '',
    exportTextCase: 'as_entered',
    docxAlias: '',
    prefillKey: '',
    helpText: '',
    placeholder: '',
    options: [],
    validationRules: [],
    conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
  };
}

function buildOverallAttendanceFields() {
  const fields = [
    visualField('__section_overall_attendance_context', 'Overall Attendance', 'section'),
    baseField({ id: 'student_first_name', label: 'Student First Name', prefillKey: 'student_first_name' }),
    baseField({ id: 'student_last_name', label: 'Student Last Name', prefillKey: 'student_last_name' }),
    baseField({ id: 'student_names_initial', label: 'Student Names Initial', prefillKey: 'student_names_initial' }),
    baseField({ id: 'student_full_name', label: 'Student Name', prefillKey: 'student_full_name' }),
    baseField({ id: 'student_date_of_birth', label: 'Student Date of Birth', prefillKey: 'student_date_of_birth' }),
    baseField({ id: 'class_name', label: 'Class Name', prefillKey: 'class_name' }),
    baseField({ id: 'report_date', label: 'Report Date', prefillKey: 'report_date' }),
    baseField({ id: 'report_period_start_date', label: 'Period Start Date', prefillKey: 'report_period_start_date' }),
    baseField({ id: 'report_period_due_date', label: 'Period Due Date', prefillKey: 'report_period_due_date' }),
    visualField('__section_overall_attendance_rows', 'Attendance Rows', 'section')
  ];

  for (let dayNo = 1; dayNo <= 31; dayNo += 1) {
    const suffix = String(dayNo).padStart(2, '0');
    fields.push(
      baseField({
        id: `attendance_day_${suffix}`,
        label: `Day ${dayNo}`,
        prefillKey: `attendance_day_${suffix}`,
        helpText: 'Day number for the fixed 31-row attendance DOCX table.'
      }),
      baseField({
        id: `attendance_presence_${suffix}`,
        label: `Presence ${dayNo}`,
        prefillKey: `attendance_presence_${suffix}`,
        helpText: 'Y when the student attended on this calendar day, N when absent, X when no class or outside the report date range.'
      }),
      baseField({
        id: `attendance_note_${suffix}`,
        label: `Note ${dayNo}`,
        prefillKey: `attendance_note_${suffix}`,
        helpText: 'Present, Absent, Absent Camera Off, Late, Late Excused, Left Early, Left Early Excused, Late - Left Early (with excused variants), No Class, Not in the report date range, or Not Marked as applicable.'
      }),
      visualField(`__row_break_attendance_${suffix}`, `End Attendance Day ${dayNo}`, 'row_break')
    );
  }

  return fields;
}

function buildWcbPdfFieldMap() {
  const map = {
    student_last_name: 'Students Surname',
    student_first_name: 'Students Firstname',
    student_names_initial: 'Students Initial',
    student_date_of_birth: 'Date of Birth ddmmyyyy',
    report_date: 'Report Date ddmmyyyy',
    report_period_month_name: 'Month attendend',
    student_address_line1: 'Address',
    student_city: 'CityTown',
    student_province: 'Province',
    student_postal_code: 'Postal Code',
    student_id_at_funder: 'WCB Claim Number',
    teacher_name: 'ESL Institution   Contact  Name',
    student_phone_1_area: 'Area Telephone Number 1',
    student_phone_1_part_a: 'Telephone Number 1a',
    student_phone_1_part_b: 'Telephone Number 1b',
    student_phone_2_area: 'Area Telephone Number_2',
    student_phone_2_part_a: 'Telephone Number_2 a',
    student_phone_2_part_b: 'Telephone Number_2b'
  };
  for (let dayNo = 1; dayNo <= 31; dayNo += 1) {
    const suffix = String(dayNo).padStart(2, '0');
    map[`attendance_presence_${suffix}`] = `YN${dayNo}`;
    map[`attendance_note_${suffix}`] = `NOTES${dayNo}`;
  }
  return map;
}

function buildTemplate() {
  const now = new Date().toISOString();
  const fields = buildOverallAttendanceFields();
  const placeholderMap = {};
  fields
    .filter((field) => !['section', 'subheader', 'row_break'].includes(String(field.type || '').toLowerCase()))
    .forEach((field) => {
      placeholderMap[field.id] = `{{${field.id}}}`;
    });

  return reportTemplateModel.sanitizeTemplate({
    id: TEMPLATE_ID,
    orgId: ORG_ID,
    type: 'overall_attendance',
    version: 1,
    title: 'Overall Attendance',
    status: 'active',
    description: 'Fixed 31-row student attendance template with calendar-day Day, Presence, and Note values for the report period.',
    allowedReportScopes: ['each_student', 'selected_students'],
    schema: { version: 1, fields },
    placeholderMap,
    docxTemplate: null,
    docxTemplatesByFunder: [],
    pdfTemplate: null,
    pdfTemplatesByFunder: [],
    pdfFieldMap: buildWcbPdfFieldMap(),
    audit: {
      createUser: SYSTEM_USER_ID,
      createDateTime: now,
      lastUpdateUser: SYSTEM_USER_ID,
      lastUpdateDateTime: now
    }
  });
}

async function main() {
  await connectMongo();
  const collection = getMongoCollection('schoolReportTemplates');
  const template = buildTemplate();
  const existing = await collection.findOne({ id: TEMPLATE_ID });
  const now = new Date().toISOString();
  const next = {
    ...(existing || {}),
    ...template,
    id: TEMPLATE_ID,
    docxTemplate: existing?.docxTemplate || template.docxTemplate,
    docxTemplatesByFunder: Array.isArray(existing?.docxTemplatesByFunder) && existing.docxTemplatesByFunder.length
      ? existing.docxTemplatesByFunder
      : template.docxTemplatesByFunder,
    pdfTemplate: existing?.pdfTemplate || template.pdfTemplate,
    pdfTemplatesByFunder: Array.isArray(existing?.pdfTemplatesByFunder) && existing.pdfTemplatesByFunder.length
      ? existing.pdfTemplatesByFunder
      : template.pdfTemplatesByFunder,
    pdfFieldMap: template.pdfFieldMap || existing?.pdfFieldMap || {},
    audit: {
      ...(existing?.audit || {}),
      ...template.audit,
      createUser: existing?.audit?.createUser || template.audit.createUser,
      createDateTime: existing?.audit?.createDateTime || template.audit.createDateTime,
      lastUpdateUser: SYSTEM_USER_ID,
      lastUpdateDateTime: now
    }
  };

  await collection.replaceOne({ id: TEMPLATE_ID }, next, { upsert: true });
  const saved = await collection.findOne(
    { id: TEMPLATE_ID },
    { projection: { _id: 0, id: 1, orgId: 1, title: 1, type: 1, version: 1, status: 1, allowedReportScopes: 1, schema: 1, placeholderMap: 1, docxTemplate: 1, pdfTemplate: 1, pdfFieldMap: 1 } }
  );
  console.log(JSON.stringify({
    status: existing ? 'updated' : 'inserted',
    template: {
      id: saved?.id,
      orgId: saved?.orgId,
      title: saved?.title,
      type: saved?.type,
      version: saved?.version,
      status: saved?.status,
      allowedReportScopes: saved?.allowedReportScopes,
      fieldCount: Array.isArray(saved?.schema?.fields) ? saved.schema.fields.length : 0,
      placeholderCount: Object.keys(saved?.placeholderMap || {}).length,
      hasDocxTemplate: Boolean(saved?.docxTemplate),
      hasPdfTemplate: Boolean(saved?.pdfTemplate),
      pdfFieldMapCount: Object.keys(saved?.pdfFieldMap || {}).length,
      samplePlaceholders: {
        attendance_day_01: saved?.placeholderMap?.attendance_day_01,
        attendance_presence_01: saved?.placeholderMap?.attendance_presence_01,
        attendance_note_01: saved?.placeholderMap?.attendance_note_01,
        attendance_note_31: saved?.placeholderMap?.attendance_note_31
      }
    }
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo().catch(() => {});
  });
