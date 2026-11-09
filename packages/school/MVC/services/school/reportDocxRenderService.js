const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule } = require('./schoolCoreContracts');
const uploadStorage = requireCoreModule('MVC/services/uploadStorageService');

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

function normalizeUploadReadRef(raw = '') {
  const token = String(raw || '').trim();
  if (!token) return '';
  if (uploadStorage.isUploadReference(token)) {
    try {
      return uploadStorage.normalizeReference(token);
    } catch (_) {
      return token;
    }
  }
  try {
    return uploadStorage.normalizeReference(token);
  } catch (_) {
    return token;
  }
}

function resolveTemplateFilePath(docxTemplate = {}) {
  const fromRecord = String(docxTemplate.path || '').trim();
  if (!fromRecord) return '';

  const normalized = normalizeUploadReadRef(fromRecord);
  if (uploadStorage.isUploadReference?.(normalized)) return normalized;
  if (path.isAbsolute(fromRecord)) return fromRecord;
  return path.resolve(process.cwd(), fromRecord);
}

function resolveDocxTemplateReadRef(docxTemplate = {}) {
  const candidates = [
    docxTemplate.url,
    docxTemplate.path,
    resolveTemplateFilePath(docxTemplate)
  ].map((value) => String(value || '').trim()).filter(Boolean);
  for (const raw of candidates) {
    const normalized = normalizeUploadReadRef(raw);
    if (uploadStorage.isUploadReference?.(normalized)) return normalized;
  }
  return candidates[candidates.length - 1] || '';
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

const sharedDocxTemplateBufferByRef = new Map();
const globalDocxTemplateLoadByRef = new Map();
const MAX_SHARED_DOCX_TEMPLATE_CACHE = 64;

function cacheKeyForDocxTemplateRef(filePath = '') {
  const normalized = normalizeUploadReadRef(filePath);
  return normalized || String(filePath || '').trim();
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

async function fetchDocxBinaryFromStorage(filePath = '') {
  const useUploadStorage = uploadStorage.isUploadReference(filePath) || uploadStorage.isRailwayGatewayBackend();
  if (useUploadStorage) {
    const readRef = uploadStorage.isUploadReference(filePath) ? filePath : normalizeUploadReadRef(filePath);
    return (await uploadStorage.readBuffer(readRef)).buffer;
  }
  return fs.readFile(filePath);
}

async function readDocxTemplateBuffer(docxTemplate = {}, options = {}) {
  const filePath = resolveDocxTemplateReadRef(docxTemplate);
  if (!filePath) throw new Error('This report template has no DOCX file configured. Upload a DOCX template first.');
  const cacheKey = cacheKeyForDocxTemplateRef(filePath);
  const cache = options?.exportBatchCache;

  if (sharedDocxTemplateBufferByRef.has(cacheKey)) {
    return { binary: sharedDocxTemplateBufferByRef.get(cacheKey), filePath: cacheKey };
  }
  if (cache?.docxBufferByRef instanceof Map && cache.docxBufferByRef.has(cacheKey)) {
    return { binary: cache.docxBufferByRef.get(cacheKey), filePath: cacheKey };
  }

  const batchInflight = cache?.docxBufferLoadByRef;
  if (batchInflight instanceof Map && batchInflight.has(cacheKey)) {
    const binary = await batchInflight.get(cacheKey);
    return { binary, filePath: cacheKey };
  }
  if (globalDocxTemplateLoadByRef.has(cacheKey)) {
    const binary = await globalDocxTemplateLoadByRef.get(cacheKey);
    return { binary, filePath: cacheKey };
  }

  const loadTask = (async () => {
    const binary = await fetchDocxBinaryFromStorage(cacheKey);
    if (cache?.docxBufferByRef instanceof Map) {
      cache.docxBufferByRef.set(cacheKey, binary);
    }
    if (uploadStorage.isUploadReference(cacheKey)) {
      if (sharedDocxTemplateBufferByRef.size >= MAX_SHARED_DOCX_TEMPLATE_CACHE) {
        const oldest = sharedDocxTemplateBufferByRef.keys().next().value;
        if (oldest) sharedDocxTemplateBufferByRef.delete(oldest);
      }
      sharedDocxTemplateBufferByRef.set(cacheKey, binary);
    }
    return binary;
  })();

  globalDocxTemplateLoadByRef.set(cacheKey, loadTask);
  if (batchInflight instanceof Map) {
    batchInflight.set(cacheKey, loadTask);
  }

  try {
    const binary = await loadTask;
    return { binary, filePath: cacheKey };
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'EPERM')) {
      throw new Error(`DOCX template file is not accessible: ${cacheKey}`);
    }
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 404) {
      throw new Error(`DOCX template file was not found on the file gateway: ${cacheKey}. Re-upload the template or verify RAILWAY_GATEWAY_BASE_URL.`);
    }
    if (statusCode >= 400) {
      throw new Error(`DOCX template could not be loaded from the file gateway (${statusCode}): ${cacheKey}`);
    }
    throw error;
  } finally {
    if (globalDocxTemplateLoadByRef.get(cacheKey) === loadTask) {
      globalDocxTemplateLoadByRef.delete(cacheKey);
    }
    if (batchInflight instanceof Map && batchInflight.get(cacheKey) === loadTask) {
      batchInflight.delete(cacheKey);
    }
  }
}

function decodeXmlText(value = '') {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&');
}

async function inspectDocxTemplateTokens(docxTemplate = {}) {
  const { binary, filePath } = await readDocxTemplateBuffer(docxTemplate);
  const { PizZip } = getDocxDependencies();
  let zip;
  try {
    zip = new PizZip(binary);
  } catch (error) {
    throw new Error(`Unable to inspect DOCX template: ${extractDocxRenderError(error)}`);
  }
  const tokens = new Set();
  Object.keys(zip.files || {})
    .filter((name) => /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(name))
    .forEach((name) => {
      const xml = zip.file(name)?.asText() || '';
      const text = decodeXmlText(xml.replace(/<[^>]*>/g, ''));
      const regex = /\{\{\s*([^{}]+?)\s*\}\}/g;
      let match;
      while ((match = regex.exec(text))) {
        const token = normalizeTokenKey(match[1]);
        if (token) tokens.add(token);
      }
    });
  return { filePath, tokens: [...tokens] };
}

async function renderReportInstanceDocx({
  template,
  instance,
  placeholders,
  collections,
  docxTemplateOverride = null,
  exportBatchCache = null
} = {}) {
  if (!template || !instance) throw new Error('Template and report instance are required.');

  const docxTemplate = docxTemplateOverride || template.docxTemplate || {};
  const { PizZip, Docxtemplater } = getDocxDependencies();
  const { binary, filePath } = await readDocxTemplateBuffer(docxTemplate, { exportBatchCache });

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

function maxRelationshipNumericId(relsXml = '') {
  let max = 0;
  const re = /\bId="rId(\d+)"/g;
  let match;
  while ((match = re.exec(String(relsXml)))) {
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function parseRelationshipTagAttributes(attrText = '') {
  const attrs = {};
  const re = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = re.exec(String(attrText)))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function zipEntryBinary(zipFile = null) {
  if (!zipFile) return null;
  if (typeof zipFile.asNodeBuffer === 'function') return zipFile.asNodeBuffer();
  if (typeof zipFile.asUint8Array === 'function') return Buffer.from(zipFile.asUint8Array());
  return Buffer.from(zipFile.asBinary(), 'binary');
}

function findDocumentBodySliceBounds(xml = '') {
  const text = String(xml);
  const openMatch = text.match(/<w:body\b[^>]*>/);
  if (!openMatch || openMatch.index == null) {
    throw new Error('Rendered DOCX has an invalid document body.');
  }
  const openStart = openMatch.index;
  const openEnd = openStart + openMatch[0].length;
  const bodyEnd = text.lastIndexOf('</w:body>');
  if (bodyEnd < openEnd) {
    throw new Error('Rendered DOCX has an invalid document body.');
  }
  return { openStart, openEnd, bodyEnd, openTag: openMatch[0] };
}

function extractTrailingSectPrBlock(bodyInner = '') {
  const body = String(bodyInner);
  const lastSectStart = body.lastIndexOf('<w:sectPr');
  if (lastSectStart < 0) return { body, sectPr: '' };
  const tail = body.slice(lastSectStart);
  if (!/^<w:sectPr[\s\S]*<\/w:sectPr>\s*$/.test(tail)) {
    return { body, sectPr: '' };
  }
  return {
    body: body.slice(0, lastSectStart),
    sectPr: tail.trim()
  };
}

function extractSectPrFromDocument(xml = '') {
  const { openEnd, bodyEnd } = findDocumentBodySliceBounds(xml);
  const inner = String(xml).slice(openEnd, bodyEnd);
  return extractTrailingSectPrBlock(inner).sectPr;
}

function extractDocumentBodyInner(xml = '') {
  const { openEnd, bodyEnd } = findDocumentBodySliceBounds(xml);
  const inner = String(xml).slice(openEnd, bodyEnd);
  return extractTrailingSectPrBlock(inner).body;
}

function ensureContentTypesOverride(contentTypesXml = '', partName = '', contentType = '') {
  const part = partName.startsWith('/') ? partName : `/${partName}`;
  if (!contentType || !contentTypesXml || contentTypesXml.includes(`PartName="${part}"`)) {
    return contentTypesXml;
  }
  return contentTypesXml.replace(
    '</Types>',
    `  <Override PartName="${part}" ContentType="${contentType}"/>\n</Types>`
  );
}

const MERGE_SKIP_WORD_PART = /^(document|styles|fontTable|settings|webSettings|numbering|theme)\.xml$/i;

function cloneStudentWordParts(sourceZip, baseZip, mergeIndex) {
  let clonedBytes = 0;
  let clonedFiles = 0;
  Object.keys(sourceZip.files).forEach((name) => {
    const entry = sourceZip.files[name];
    if (!entry || entry.dir || !name.startsWith('word/')) return;
    const rel = name.slice('word/'.length);
    if (MERGE_SKIP_WORD_PART.test(rel) || rel === '_rels/document.xml.rels') return;
    const dest = rel.startsWith('_rels/')
      ? `word/_rels/s${mergeIndex}_${rel.slice('_rels/'.length)}`
      : `word/s${mergeIndex}_${rel.replace(/\//g, '_')}`;
    if (baseZip.file(dest)) return;
    const binary = zipEntryBinary(entry);
    if (!binary) return;
    baseZip.file(dest, binary);
    clonedBytes += binary.length;
    clonedFiles += 1;
  });
  return { clonedBytes, clonedFiles };
}

function rewriteClonedPartRelationshipTargets(baseZip, mergeIndex) {
  const prefix = `word/_rels/s${mergeIndex}_`;
  Object.keys(baseZip.files).forEach((name) => {
    if (!name.startsWith(prefix) || !name.endsWith('.rels')) return;
    const text = baseZip.file(name)?.asText() || '';
    if (!text) return;
    const rewritten = text.replace(/Target="([^"]+)"/g, (full, target) => {
      let t = String(target || '').trim();
      if (t.startsWith('../')) t = t.slice(3);
      if (/^(media|embeddings|charts)\//i.test(t)) {
        return `Target="s${mergeIndex}_${t.replace(/\//g, '_')}"`;
      }
      const baseName = t.split('/').pop();
      if (baseName && /^(header|footer)/i.test(baseName)) {
        return `Target="s${mergeIndex}_${baseName}"`;
      }
      return full;
    });
    baseZip.file(name, rewritten);
  });
}

function registerContentTypesForClonedParts(baseZip, mergeIndex, contentTypesXml = '') {
  let out = contentTypesXml;
  const headerCt = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
  const footerCt = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
  Object.keys(baseZip.files).forEach((name) => {
    if (!name.startsWith(`word/s${mergeIndex}_`)) return;
    if (/header\d+\.xml$/i.test(name)) {
      out = ensureContentTypesOverride(out, `/${name}`, headerCt);
    } else if (/footer\d+\.xml$/i.test(name)) {
      out = ensureContentTypesOverride(out, `/${name}`, footerCt);
    }
  });
  return out;
}

function remapSectionHeaderFooterParts({
  sourceZip,
  baseZip,
  mergeIndex,
  sectPrXml = '',
  relsXml = '',
  maxRid = 0,
  contentTypesXml = ''
} = {}) {
  let outSect = String(sectPrXml);
  let outRels = String(relsXml);
  let nextRid = maxRid;
  let outContentTypes = contentTypesXml;
  const sourceRels = sourceZip.file('word/_rels/document.xml.rels')?.asText() || '';
  const refRe = /<w:(headerReference|footerReference)\b([^>]*)\/?>/g;
  let match;
  while ((match = refRe.exec(sectPrXml))) {
    const kind = match[1];
    const attrText = match[2] || '';
    const idMatch = attrText.match(/\br:id="([^"]+)"/);
    if (!idMatch) continue;
    const oldId = idMatch[1];
    const relTagMatch = sourceRels.match(new RegExp(`<Relationship\\s+[^>]*Id="${oldId}"[^>]*\\/?>`, 'i'));
    if (!relTagMatch) continue;
    const attrs = parseRelationshipTagAttributes(
      relTagMatch[0].replace(/^<Relationship\s+/, '').replace(/\/?>$/, '')
    );
    let target = String(attrs.Target || '').trim();
    if (!target) continue;
    if (target.startsWith('/')) target = target.slice(1);
    const srcPath = target.startsWith('word/') ? target : `word/${target}`;
    const srcFile = sourceZip.file(srcPath);
    if (!srcFile) continue;
    const baseName = target.split('/').pop() || `part_${mergeIndex}`;
    const destFileName = `s${mergeIndex}_${baseName}`;
    const destPath = `word/${destFileName}`;
    if (!baseZip.file(destPath)) {
      const binary = zipEntryBinary(srcFile);
      if (!binary) continue;
      baseZip.file(destPath, binary);
      const hfRelsPath = `word/_rels/${baseName}.rels`;
      const srcHfRels = sourceZip.file(hfRelsPath);
      if (srcHfRels) {
        const destRels = `word/_rels/${destFileName}.rels`;
        if (!baseZip.file(destRels)) {
          baseZip.file(destRels, zipEntryBinary(srcHfRels));
        }
      }
    }
    nextRid += 1;
    const newId = `rId${nextRid}`;
    const relType = kind === 'headerReference'
      ? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'
      : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
    outRels = outRels.replace(
      '</Relationships>',
      `  <Relationship Id="${newId}" Type="${relType}" Target="${destFileName}"/>\n</Relationships>`
    );
    outSect = outSect.replace(new RegExp(`r:id="${oldId}"`, 'g'), `r:id="${newId}"`);
    const ct = kind === 'headerReference'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
    outContentTypes = ensureContentTypesOverride(outContentTypes, `/word/${destFileName}`, ct);
  }
  return { sectPrXml: outSect, relsXml: outRels, maxRid: nextRid, contentTypesXml: outContentTypes };
}

function isDocxZipBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function assertValidDocxPackage(buffer, label = 'document') {
  const tag = cleanDocxAssertLabel(label);
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const error = new Error(`${tag}: DOCX output is empty.`);
    error.statusCode = 500;
    throw error;
  }
  if (!isDocxZipBuffer(buffer)) {
    const error = new Error(`${tag}: output is not a valid DOCX package (missing ZIP header).`);
    error.statusCode = 500;
    throw error;
  }
  const { PizZip } = getDocxDependencies();
  const zip = new PizZip(buffer);
  if (!zip.file('word/document.xml')) {
    const error = new Error(`${tag}: DOCX package is missing word/document.xml.`);
    error.statusCode = 500;
    throw error;
  }
  return true;
}

function cleanDocxAssertLabel(label) {
  return String(label || 'document').trim() || 'document';
}

function summarizeDocxFileBuffers(files = []) {
  const rows = (Array.isArray(files) ? files : [])
    .map((row) => (Buffer.isBuffer(row?.buffer) ? row.buffer.length : 0))
    .filter((size) => size > 0);
  return {
    count: Array.isArray(files) ? files.length : 0,
    withBuffer: rows.length,
    totalBytes: rows.reduce((sum, size) => sum + size, 0),
    minBytes: rows.length ? Math.min(...rows) : 0,
    maxBytes: rows.length ? Math.max(...rows) : 0
  };
}

function normalizeRelationshipTargetToZipPath(target = '') {
  let t = String(target || '').trim();
  if (t.startsWith('/')) t = t.slice(1);
  if (t.startsWith('../')) t = t.replace(/^\.\.\//, '');
  if (/^(media|embeddings|charts)\//i.test(t)) return `word/${t}`;
  if (t.startsWith('word/')) return t;
  return `word/${t}`;
}

function ensureContentTypesForMedia(contentTypesXml = '', fileName = '') {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (!ext) return contentTypesXml;
  const defaults = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    emf: 'image/x-emf',
    wmf: 'image/x-wmf'
  };
  const contentType = defaults[ext];
  if (!contentType) return contentTypesXml;
  if (contentTypesXml.includes(`Extension="${ext}"`)) return contentTypesXml;
  return contentTypesXml.replace(
    '</Types>',
    `  <Default Extension="${ext}" ContentType="${contentType}"/>\n</Types>`
  );
}

function remapRelationshipIdsInXml(xml = '', ridMap = new Map()) {
  let out = String(xml);
  ridMap.forEach((newId, oldId) => {
    const patterns = [
      new RegExp(`r:embed="${oldId}"`, 'g'),
      new RegExp(`r:id="${oldId}"`, 'g'),
      new RegExp(`r:link="${oldId}"`, 'g')
    ];
    patterns.forEach((re) => {
      out = out.replace(re, (full) => full.replace(oldId, newId));
    });
  });
  return out;
}

function appendMediaRelationshipsFromZip({
  sourceZip,
  baseZip,
  mergeIndex,
  baseRelsXml,
  maxRid
} = {}) {
  const addRels = sourceZip.file('word/_rels/document.xml.rels')?.asText() || '';
  const ridMap = new Map();
  const copiedMediaNames = [];
  let relsXml = baseRelsXml;
  let nextRid = maxRid;
  const relRegex = /<Relationship\s+([^/>]+)\/?>/g;
  let match;
  while ((match = relRegex.exec(addRels))) {
    const attrs = parseRelationshipTagAttributes(match[1]);
    const oldId = attrs.Id;
    let targetRaw = String(attrs.Target || '').trim();
    if (!oldId || !targetRaw) continue;
    if (targetRaw.startsWith('/')) targetRaw = targetRaw.slice(1);
    const relTarget = targetRaw;
    const pathForMatch = relTarget.replace(/^\.\.\//, '');
    const isMedia = /^media\//i.test(pathForMatch) || /^embeddings\//i.test(pathForMatch);
    const isChart = /^charts\//i.test(pathForMatch)
      || String(attrs.Type || '').toLowerCase().includes('chart');
    const isImageRel = String(attrs.Type || '').toLowerCase().includes('image')
      || String(attrs.Type || '').toLowerCase().includes('oleobject');
    if (!isMedia && !isImageRel && !isChart) continue;
    const srcPath = normalizeRelationshipTargetToZipPath(relTarget);
    const srcFile = sourceZip.file(srcPath);
    if (!srcFile) continue;
    const baseName = pathForMatch.split('/').pop() || `part_${mergeIndex}`;
    const prefix = /^charts\//i.test(pathForMatch) ? 'charts' : 'media';
    const newTarget = `${prefix}/merged_${mergeIndex}_${baseName}`;
    const destPath = `word/${newTarget}`;
    const binary = zipEntryBinary(srcFile);
    if (!binary) continue;
    nextRid += 1;
    const newId = `rId${nextRid}`;
    ridMap.set(oldId, newId);
    baseZip.file(destPath, binary);
    copiedMediaNames.push(baseName);
    const relLine = `<Relationship Id="${newId}" Type="${attrs.Type}" Target="${newTarget}"/>`;
    relsXml = relsXml.replace('</Relationships>', `  ${relLine}\n</Relationships>`);
  }
  return { relsXml, ridMap, nextRid, copiedMediaNames };
}

function mergeReportInstanceDocxBuffers(buffers = []) {
  const sourceBuffers = (Array.isArray(buffers) ? buffers : []).filter(Boolean);
  if (!sourceBuffers.length) throw new Error('No rendered report documents were available to combine.');
  const { PizZip } = getDocxDependencies();
  const baseZip = new PizZip(sourceBuffers[0]);
  const baseXml = baseZip.file('word/document.xml')?.asText();
  if (!baseXml) throw new Error('Rendered DOCX is missing word/document.xml.');
  const baseBounds = findDocumentBodySliceBounds(baseXml);
  let combinedBody = '';
  let relsXml = baseZip.file('word/_rels/document.xml.rels')?.asText() || '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let contentTypesXml = baseZip.file('[Content_Types].xml')?.asText() || '';
  let maxRid = maxRelationshipNumericId(relsXml);

  for (let index = 0; index < sourceBuffers.length; index += 1) {
    const zip = index === 0 ? baseZip : new PizZip(sourceBuffers[index]);
    const xml = index === 0 ? baseXml : zip.file('word/document.xml')?.asText();
    if (!xml) throw new Error('Rendered DOCX is missing word/document.xml.');
    if (index > 0) {
      combinedBody += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      cloneStudentWordParts(zip, baseZip, index);
      rewriteClonedPartRelationshipTargets(baseZip, index);
      contentTypesXml = registerContentTypesForClonedParts(baseZip, index, contentTypesXml);
    }
    let mediaMerge = { relsXml, nextRid: maxRid, ridMap: new Map(), copiedMediaNames: [] };
    if (index > 0) {
      mediaMerge = appendMediaRelationshipsFromZip({
        sourceZip: zip,
        baseZip,
        mergeIndex: index,
        baseRelsXml: relsXml,
        maxRid
      });
      relsXml = mediaMerge.relsXml;
      maxRid = mediaMerge.nextRid;
      (mediaMerge.copiedMediaNames || []).forEach((name) => {
        contentTypesXml = ensureContentTypesForMedia(contentTypesXml, name);
      });
    }
    let body = extractDocumentBodyInner(xml);
    if (index > 0) {
      body = remapRelationshipIdsInXml(body, mediaMerge.ridMap);
    }
    let sectPr = extractSectPrFromDocument(xml);
    if (index > 0 && sectPr) {
      const hfMerge = remapSectionHeaderFooterParts({
        sourceZip: zip,
        baseZip,
        mergeIndex: index,
        sectPrXml: sectPr,
        relsXml,
        maxRid,
        contentTypesXml
      });
      sectPr = hfMerge.sectPrXml;
      relsXml = hfMerge.relsXml;
      maxRid = hfMerge.maxRid;
      contentTypesXml = hfMerge.contentTypesXml;
    }
    combinedBody += body;
    if (sectPr) combinedBody += sectPr;
  }
  if (baseZip.file('word/_rels/document.xml.rels')) {
    baseZip.file('word/_rels/document.xml.rels', relsXml);
  }
  if (contentTypesXml && baseZip.file('[Content_Types].xml')) {
    baseZip.file('[Content_Types].xml', contentTypesXml);
  }
  baseZip.file(
    'word/document.xml',
    baseXml.slice(0, baseBounds.openEnd) + combinedBody + baseXml.slice(baseBounds.bodyEnd)
  );
  const merged = baseZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  assertValidDocxPackage(merged, 'merged DOCX');
  const sumBodyInnerChars = sourceBuffers.reduce((sum, buf) => {
    try {
      const zip = new PizZip(buf);
      const xml = zip.file('word/document.xml')?.asText() || '';
      if (!xml) return sum;
      return sum + extractDocumentBodyInner(xml).length;
    } catch {
      return sum;
    }
  }, 0);
  const bodyInnerThreshold = Math.floor(sumBodyInnerChars * 0.85);
  if (sumBodyInnerChars > 0 && combinedBody.length < bodyInnerThreshold) {
    throw new Error('Merged DOCX document body is unexpectedly small; merge may be incomplete.');
  }
  return merged;
}

function mergeReportInstanceDocxPaths(paths = []) {
  const filePaths = (Array.isArray(paths) ? paths : []).map((row) => {
    if (typeof row === 'string') return row;
    return String(row?.scratchPath || row?.path || '').trim();
  }).filter(Boolean);
  if (!filePaths.length) throw new Error('No rendered report documents were available to combine.');
  const buffers = filePaths.map((filePath) => fsSync.readFileSync(filePath));
  return mergeReportInstanceDocxBuffers(buffers);
}

async function zipReportInstanceDocxFiles(files = []) {
  const entries = (Array.isArray(files) ? files : [])
    .filter((row) => row && row.buffer)
    .map((row, index) => {
      const rawName = String(row.fileName || `report_${index + 1}`).trim();
      const stem = rawName.replace(/\.docx$/i, '');
      return {
        fileName: sanitizeFileNamePart(stem) || `report_${index + 1}`,
        buffer: row.buffer
      };
    });
  if (!entries.length) throw new Error('No rendered report documents were available to zip.');
  const JSZip = require('jszip');
  const zip = new JSZip();
  const usedNames = new Set();
  entries.forEach((entry, index) => {
    let name = `${entry.fileName}.docx`;
    if (usedNames.has(name.toLowerCase())) {
      name = `${entry.fileName}_${index + 1}.docx`;
    }
    usedNames.add(name.toLowerCase());
    zip.file(name, entry.buffer);
  });
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

module.exports = {
  normalizeTokenKey,
  normalizeCollectionRows,
  buildRenderData,
  resolveTemplateFilePath,
  resolveDocxTemplateReadRef,
  readDocxTemplateBuffer,
  inspectDocxTemplateTokens,
  renderReportInstanceDocx,
  isDocxZipBuffer,
  assertValidDocxPackage,
  summarizeDocxFileBuffers,
  mergeReportInstanceDocxBuffers,
  mergeReportInstanceDocxPaths,
  zipReportInstanceDocxFiles
};
