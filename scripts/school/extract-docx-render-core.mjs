import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../..');
const srcPath = path.join(root, 'packages/school/MVC/services/school/reportDocxRenderService.js');
const outPath = path.join(root, 'packages/school/MVC/services/school/reportDocxRenderCore.js');
const src = fs.readFileSync(srcPath, 'utf8');

const partAEnd = src.indexOf('function normalizeUploadReadRef');
const partBStart = src.indexOf('function buildRenderData');
const partBEnd = src.indexOf('const sharedDocxTemplateBufferByRef');
const mergeStart = src.indexOf('function maxRelationshipNumericId');
const mergeEnd = src.indexOf('async function zipReportInstanceDocxFiles');

const header = `'use strict';

function getDocxDependencies() {
  let PizZip;
  let Docxtemplater;
  const missing = [];
  try {
    PizZip = require('pizzip');
  } catch (error) {
    missing.push(\`pizzip (\${error?.code || error?.message || 'load error'})\`);
  }
  try {
    Docxtemplater = require('docxtemplater');
  } catch (error) {
    missing.push(\`docxtemplater (\${error?.code || error?.message || 'load error'})\`);
  }
  if (missing.length > 0) {
    throw new Error(
      \`DOCX export dependencies are missing: \${missing.join(', ')}. \` +
      'Run \`npm install docxtemplater pizzip\` then restart the server.'
    );
  }
  return { PizZip, Docxtemplater };
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
  return 'Unknown DOCX renderError';
}

function renderDocxFromTemplateBuffer(templateBuffer, { placeholders = {}, collections = {}, fileName = 'report.docx' } = {}) {
  const { PizZip, Docxtemplater } = getDocxDependencies();
  const binary = Buffer.isBuffer(templateBuffer) ? templateBuffer : Buffer.from(templateBuffer || []);
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
    throw new Error(\`DOCX render failed: \${extractDocxRenderError(error)}\`);
  }
  const buffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  assertValidDocxPackage(buffer, fileName);
  return { buffer, fileName: String(fileName || 'report.docx'), renderData };
}

`;

const footer = `
module.exports = {
  normalizeTokenKey,
  toDocxSafeValue,
  normalizeCollectionRows,
  buildRenderData,
  getDocxDependencies,
  extractDocxRenderError,
  renderDocxFromTemplateBuffer,
  isDocxZipBuffer,
  assertValidDocxPackage,
  cleanDocxAssertLabel,
  summarizeDocxFileBuffers,
  mergeReportInstanceDocxBuffers
};
`;

const tokenStart = src.indexOf('function normalizeTokenKey');
const coreBody = header + src.slice(tokenStart, partAEnd) + src.slice(partBStart, partBEnd) + src.slice(mergeStart, mergeEnd) + footer;
fs.writeFileSync(outPath, coreBody);
console.log('Wrote', outPath, coreBody.length);
