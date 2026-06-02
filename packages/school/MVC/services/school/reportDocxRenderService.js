const fs = require('fs').promises;
const path = require('path');
const fileAssetStorage = require('../fileAssetStorageService');

function normalizeTokenKey(rawToken) {
  const clean = String(rawToken || '').trim();
  if (!clean) return '';

  const match = clean.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  if (match && match[1]) return String(match[1]).trim();
  return clean;
}

function toDocxSafeValue(value) {
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

function resolveTemplateFilePath(docxTemplate = {}) {
  const fromRecord = String(docxTemplate.path || '').trim();
  if (!fromRecord) return '';

  if (/^\/uploads\//i.test(fromRecord) || /^https?:\/\/[^/]+\/uploads\//i.test(fromRecord)) return fromRecord;
  if (path.isAbsolute(fromRecord)) return fromRecord;
  return path.resolve(process.cwd(), fromRecord);
}

function buildRenderData(placeholders = {}) {
  const out = {};
  Object.keys(placeholders || {}).forEach((token) => {
    const normalizedKey = normalizeTokenKey(token);
    if (!normalizedKey) return;
    out[normalizedKey] = toDocxSafeValue(placeholders[token]);
  });
  return out;
}

function sanitizeFileNamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function extractDocxRenderError(error) {
  if (!error) return 'Unknown DOCX render error.';

  const properties = error.properties || {};
  const detailedErrors = Array.isArray(properties.errors) ? properties.errors : [];
  const detailMessage = detailedErrors
    .map((row) => {
      const explanation = row?.properties?.explanation || row?.message || '';
      return String(explanation || '').trim();
    })
    .filter(Boolean)
    .join(' | ');

  if (detailMessage) return detailMessage;
  if (properties.explanation) return String(properties.explanation);
  if (error.message) return String(error.message);
  return 'Unknown DOCX render error.';
}

function getDocxDependencies() {
  let PizZip;
  let Docxtemplater;
  const missing = [];

  try {
    PizZip = require('pizzip');
  } catch (error) {
    missing.push(`pizzip (${error?.code || error?.message || 'load error'})`);
  }

  try {
    Docxtemplater = require('docxtemplater');
  } catch (error) {
    missing.push(`docxtemplater (${error?.code || error?.message || 'load error'})`);
  }

  if (missing.length > 0) {
    throw new Error(
      `DOCX export dependencies are missing: ${missing.join(', ')}. ` +
      'Run `npm install docxtemplater pizzip` then restart the server.'
    );
  }

  return { PizZip, Docxtemplater };
}

async function renderReportInstanceDocx({ template, instance, placeholders }) {
  if (!template || !instance) throw new Error('Template and report instance are required.');

  const docxTemplate = template.docxTemplate || {};
  const filePath = resolveTemplateFilePath(docxTemplate);
  if (!filePath) {
    throw new Error('This report template has no DOCX file configured. Upload a DOCX template first.');
  }

  const { PizZip, Docxtemplater } = getDocxDependencies();
  let binary;
  try {
    if (/^\/uploads\//i.test(filePath) || /^https?:\/\/[^/]+\/uploads\//i.test(filePath)) {
      binary = (await fileAssetStorage.readBuffer(filePath)).buffer;
    } else {
      binary = await fs.readFile(filePath);
    }
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'EPERM')) {
      throw new Error(`DOCX template file is not accessible: ${filePath}`);
    }
    throw error;
  }

  const renderData = buildRenderData(placeholders);

  let doc;
  try {
    const zip = new PizZip(binary);
    doc = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true
    });
    doc.render(renderData);
  } catch (error) {
    const reason = extractDocxRenderError(error);
    throw new Error(`DOCX render failed: ${reason}`);
  }

  const titlePart = sanitizeFileNamePart(template.title || template.id || 'template');
  const instancePart = sanitizeFileNamePart(instance.id || 'instance');
  const fileName = `${instancePart}_${titlePart || 'report'}.docx`;
  const buffer = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  });

  return {
    buffer,
    fileName,
    renderData,
    templatePath: filePath
  };
}

module.exports = {
  normalizeTokenKey,
  buildRenderData,
  renderReportInstanceDocx
};
