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

function normalizeCollectionRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      const out = {};
      Object.keys(row).forEach((key) => {
        const cleanKey = normalizeTokenKey(key);
        if (!cleanKey) return;
        out[cleanKey] = toDocxSafeValue(row[key]);
      });
      return out;
    });
}

function resolveTemplateFilePath(docxTemplate = {}) {
  const fromRecord = String(docxTemplate.path || '').trim();
  if (!fromRecord) return '';

  if (fileAssetStorage.isUploadReference?.(fromRecord)) {
    const relativeUploadPath = uploadPathUtils.extractRelativeUploadPath(fromRecord);
    return relativeUploadPath ? `/uploads/${relativeUploadPath}` : fromRecord;
  }
  if (path.isAbsolute(fromRecord)) return fromRecord;
  return path.resolve(process.cwd(), fromRecord);
}

function buildRenderData(placeholders = {}, collections = {}) {
  const out = {};
  Object.keys(placeholders || {}).forEach((token) => {
    const normalizedKey = normalizeTokenKey(token);
    if (!normalizedKey) return;
    out[normalizedKey] = toDocxSafeValue(placeholders[token]);
  });
  Object.keys(collections || {}).forEach((key) => {
    const normalizedKey = normalizeTokenKey(key);
    if (!normalizedKey) return;
    out[normalizedKey] = normalizeCollectionRows(collections[key]);
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

async function renderReportInstanceDocx({ template, instance, placeholders, collections }) {
  if (!template || !instance) throw new Error('Template and report instance are required.');

  const docxTemplate = template.docxTemplate || {};
  const filePath = resolveTemplateFilePath(docxTemplate);
  if (!filePath) {
    throw new Error('This report template has no DOCX file configured. Upload a DOCX template first.');
  }

  const { PizZip, Docxtemplater } = getDocxDependencies();
  let binary;
  try {
    if (fileAssetStorage.isUploadReference?.(filePath)) {
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

  const renderData = buildRenderData(placeholders, collections);

  let doc;
  try {
    const zip = new PizZip(binary);
    doc = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => ''
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


function mergeReportInstanceDocxBuffers(buffers = []) {
  const sourceBuffers = (Array.isArray(buffers) ? buffers : []).filter(Boolean);
  if (!sourceBuffers.length) throw new Error('No rendered report documents were available to combine.');
  const { PizZip } = getDocxDependencies();
  const baseZip = new PizZip(sourceBuffers[0]);
  const baseXml = baseZip.file('word/document.xml')?.asText();
  if (!baseXml) throw new Error('Rendered DOCX is missing word/document.xml.');
  const bodyStart = baseXml.indexOf('<w:body>');
  const bodyEnd = baseXml.lastIndexOf('</w:body>');
  if (bodyStart < 0 || bodyEnd < 0) throw new Error('Rendered DOCX has an invalid document body.');
  let combinedBody = baseXml.slice(bodyStart + '<w:body>'.length, bodyEnd);
  const sectMatch = combinedBody.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  const sectPr = sectMatch ? sectMatch[0] : '';
  if (sectPr) combinedBody = combinedBody.slice(0, combinedBody.lastIndexOf(sectPr));
  for (let index = 1; index < sourceBuffers.length; index += 1) {
    const zip = new PizZip(sourceBuffers[index]);
    const xml = zip.file('word/document.xml')?.asText();
    if (!xml) throw new Error('Rendered DOCX is missing word/document.xml.');
    const start = xml.indexOf('<w:body>'); const end = xml.lastIndexOf('</w:body>');
    if (start < 0 || end < 0) throw new Error('Rendered DOCX has an invalid document body.');
    let body = xml.slice(start + '<w:body>'.length, end);
    const ownSect = body.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
    if (ownSect) body = body.slice(0, body.lastIndexOf(ownSect[0]));
    combinedBody += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + body;
  }
  combinedBody += sectPr;
  baseZip.file('word/document.xml', baseXml.slice(0, bodyStart + '<w:body>'.length) + combinedBody + baseXml.slice(bodyEnd));
  return baseZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = {
  normalizeTokenKey,
  normalizeCollectionRows,
  buildRenderData,
  resolveTemplateFilePath,
  renderReportInstanceDocx,
  mergeReportInstanceDocxBuffers
};