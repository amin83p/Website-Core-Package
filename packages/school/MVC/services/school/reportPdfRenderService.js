'use strict';

const fs = require('fs').promises;
const path = require('path');
const { requireCoreModule } = require('./schoolCoreContracts');
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');
const uploadPathUtils = requireCoreModule('MVC/utils/uploadPathUtils');

function normalizeTokenKey(rawToken) {
  const clean = String(rawToken || '').trim();
  if (!clean) return '';
  const match = clean.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  if (match && match[1]) return String(match[1]).trim();
  return clean;
}

function toPdfSafeValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function formatPdfFieldValue(pdfFieldName, value) {
  const text = toPdfSafeValue(value);
  if (/ddmmyyyy/i.test(String(pdfFieldName || ''))) {
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return `${match[3]}${match[2]}${match[1]}`;
  }
  return text;
}

function sanitizeFileNamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function getPdfDependencies() {
  let pdfLib;
  try {
    pdfLib = require('pdf-lib');
  } catch (error) {
    throw new Error(
      `PDF export dependency is missing: pdf-lib (${error?.code || error?.message || 'load error'}). ` +
      'Run `npm install pdf-lib` then restart the server.'
    );
  }
  return pdfLib;
}

function resolveTemplateFilePath(pdfTemplate = {}) {
  const fromRecord = String(pdfTemplate.path || '').trim();
  if (!fromRecord) return '';
  if (fileAssetStorage.isUploadReference?.(fromRecord)) {
    const relativeUploadPath = uploadPathUtils.extractRelativeUploadPath(fromRecord);
    return relativeUploadPath ? `/uploads/${relativeUploadPath}` : fromRecord;
  }
  if (path.isAbsolute(fromRecord)) return fromRecord;
  return path.resolve(process.cwd(), fromRecord);
}

async function readPdfTemplateBuffer(pdfTemplate = {}) {
  const filePath = resolveTemplateFilePath(pdfTemplate);
  if (!filePath) throw new Error('This report template has no PDF file configured. Upload a PDF template first.');
  try {
    const binary = fileAssetStorage.isUploadReference?.(filePath)
      ? (await fileAssetStorage.readBuffer(filePath)).buffer
      : await fs.readFile(filePath);
    return { binary, filePath };
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'EPERM')) {
      throw new Error(`PDF template file is not accessible: ${filePath}`);
    }
    throw error;
  }
}

async function inspectPdfTemplateFields(pdfTemplate = {}) {
  const { PDFDocument } = getPdfDependencies();
  const { binary, filePath } = await readPdfTemplateBuffer(pdfTemplate);
  const pdfDoc = await PDFDocument.load(binary);
  const form = pdfDoc.getForm();
  const fields = form.getFields().map((field) => ({
    name: field.getName(),
    type: String(field.constructor?.name || 'PDFField')
  }));
  return { filePath, fields };
}

function buildValueLookup({ placeholders = {}, mergedAnswers = {}, prefillSnapshot = {} } = {}) {
  const values = {};
  Object.keys(mergedAnswers || {}).forEach((key) => {
    const normalized = normalizeTokenKey(key);
    if (normalized) values[normalized] = mergedAnswers[key];
  });
  Object.keys(prefillSnapshot || {}).forEach((key) => {
    const normalized = normalizeTokenKey(key);
    if (normalized && values[normalized] === undefined) values[normalized] = prefillSnapshot[key];
  });
  Object.keys(placeholders || {}).forEach((key) => {
    const normalized = normalizeTokenKey(key);
    if (normalized) values[normalized] = placeholders[key];
  });
  return values;
}

function resolveMappedPdfValues({ template = {}, placeholders = {}, mergedAnswers = {}, prefillSnapshot = {} } = {}) {
  const fieldMap = template?.pdfFieldMap && typeof template.pdfFieldMap === 'object' ? template.pdfFieldMap : {};
  const lookup = buildValueLookup({ placeholders, mergedAnswers, prefillSnapshot });
  const out = {};
  Object.keys(fieldMap).forEach((sourceKey) => {
    const pdfFieldName = String(fieldMap[sourceKey] || '').trim();
    if (!pdfFieldName) return;
    const normalized = normalizeTokenKey(sourceKey);
    const value = Object.prototype.hasOwnProperty.call(lookup, sourceKey)
      ? lookup[sourceKey]
      : lookup[normalized];
    out[pdfFieldName] = formatPdfFieldValue(pdfFieldName, value);
  });
  return out;
}

function resolvePlaceholderTextValue(rawText = '', lookup = {}) {
  const text = String(rawText || '');
  if (!text.includes('{{')) return null;
  let replacedAny = false;
  const replaced = text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => {
    const normalized = normalizeTokenKey(key);
    if (!normalized || !Object.prototype.hasOwnProperty.call(lookup, normalized)) return '';
    replacedAny = true;
    return toPdfSafeValue(lookup[normalized]);
  });
  return replacedAny ? replaced : null;
}

function setPdfFieldValue(field, value) {
  const text = toPdfSafeValue(value);
  if (typeof field.setText === 'function') {
    field.setText(text);
    return true;
  }
  if (typeof field.select === 'function') {
    field.select(text);
    return true;
  }
  if (typeof field.check === 'function' && typeof field.uncheck === 'function') {
    const checked = ['1', 'true', 'yes', 'y', 'checked', 'on'].includes(String(text || '').trim().toLowerCase());
    if (checked) field.check();
    else field.uncheck();
    return true;
  }
  return false;
}

async function renderReportInstancePdf({
  template,
  instance,
  placeholders,
  mergedAnswers,
  pdfTemplateOverride = null,
  flatten = true
} = {}) {
  if (!template || !instance) throw new Error('Template and report instance are required.');

  const { PDFDocument } = getPdfDependencies();
  const pdfTemplate = pdfTemplateOverride || template.pdfTemplate || {};
  const { binary, filePath } = await readPdfTemplateBuffer(pdfTemplate);
  const pdfDoc = await PDFDocument.load(binary);
  const form = pdfDoc.getForm();
  const mappedValues = resolveMappedPdfValues({
    template,
    placeholders,
    mergedAnswers,
    prefillSnapshot: instance.prefillSnapshot
  });
  const valueLookup = buildValueLookup({ placeholders, mergedAnswers, prefillSnapshot: instance.prefillSnapshot });
  const appliedFields = [];
  const missingFields = [];

  Object.keys(mappedValues).forEach((pdfFieldName) => {
    let field;
    try {
      field = form.getField(pdfFieldName);
    } catch (_) {
      missingFields.push(pdfFieldName);
      return;
    }
    if (setPdfFieldValue(field, mappedValues[pdfFieldName])) {
      appliedFields.push(pdfFieldName);
    }
  });
  form.getFields().forEach((field) => {
    const pdfFieldName = field.getName();
    if (Object.prototype.hasOwnProperty.call(mappedValues, pdfFieldName)) return;
    if (typeof field.getText !== 'function') return;
    const replaced = resolvePlaceholderTextValue(field.getText(), valueLookup);
    if (replaced === null) return;
    if (setPdfFieldValue(field, formatPdfFieldValue(pdfFieldName, replaced))) {
      appliedFields.push(pdfFieldName);
    }
  });

  try {
    form.updateFieldAppearances();
  } catch (_) {
    // Some third-party PDFs cannot regenerate every appearance stream; saved values still remain in the form data.
  }
  if (flatten) form.flatten();

  const titlePart = sanitizeFileNamePart(template.title || template.id || 'template');
  const instancePart = sanitizeFileNamePart(instance.id || 'instance');
  const fileName = `${instancePart}_${titlePart || 'report'}.pdf`;
  const buffer = Buffer.from(await pdfDoc.save());

  return {
    buffer,
    fileName,
    mappedValues,
    appliedFields,
    missingFields,
    templatePath: filePath
  };
}

async function zipReportInstancePdfFiles(files = []) {
  const entries = (Array.isArray(files) ? files : [])
    .filter((row) => row && row.buffer)
    .map((row, index) => {
      const rawName = String(row.fileName || `report_${index + 1}`).trim();
      const stem = rawName.replace(/\.pdf$/i, '');
      return {
        fileName: sanitizeFileNamePart(stem) || `report_${index + 1}`,
        buffer: row.buffer
      };
    });
  if (!entries.length) throw new Error('No rendered report PDFs were available to zip.');
  const JSZip = require('jszip');
  const zip = new JSZip();
  const usedNames = new Set();
  entries.forEach((entry, index) => {
    let name = `${entry.fileName}.pdf`;
    if (usedNames.has(name.toLowerCase())) name = `${entry.fileName}_${index + 1}.pdf`;
    usedNames.add(name.toLowerCase());
    zip.file(name, entry.buffer);
  });
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

module.exports = {
  normalizeTokenKey,
  toPdfSafeValue,
  resolveTemplateFilePath,
  readPdfTemplateBuffer,
  inspectPdfTemplateFields,
  buildValueLookup,
  resolveMappedPdfValues,
  renderReportInstancePdf,
  zipReportInstancePdfFiles
};
