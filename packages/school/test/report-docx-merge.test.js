const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');

const reportDocxRenderService = require('../MVC/services/school/reportDocxRenderService');
const reportExportBatchCacheService = require('../MVC/services/school/reportExportBatchCacheService');
const studentAttendanceReportGenerationService = require('../MVC/services/school/studentAttendanceReportGenerationService');

function buildMinimalDocx(paragraphText = 'Hello') {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${paragraphText}</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('assertValidDocxPackage accepts minimal DOCX', () => {
  const buffer = buildMinimalDocx('Test');
  assert.equal(reportDocxRenderService.isDocxZipBuffer(buffer), true);
  assert.equal(reportDocxRenderService.assertValidDocxPackage(buffer, 'minimal'), true);
});

test('assertValidDocxPackage rejects empty buffer', () => {
  assert.throws(
    () => reportDocxRenderService.assertValidDocxPackage(Buffer.alloc(0), 'empty'),
    /empty/i
  );
});

test('mergeReportInstanceDocxBuffers combines twelve minimal documents without false reject', () => {
  const buffers = Array.from({ length: 12 }, (_, index) => buildMinimalDocx(`Student ${index + 1}`));
  const merged = reportDocxRenderService.mergeReportInstanceDocxBuffers(buffers);
  reportDocxRenderService.assertValidDocxPackage(merged, 'twelve-way merge');
});

test('extractDocumentBodyInner keeps content after an in-body sectPr (WCB-style)', () => {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  const mainTable = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>WCB attendance table content</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Header line</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
    ${mainTable}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`);
  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  const second = buildMinimalDocx('Second student segment');
  const merged = reportDocxRenderService.mergeReportInstanceDocxBuffers([buffer, second]);
  const outXml = new PizZip(merged).file('word/document.xml').asText();
  assert.match(outXml, /WCB attendance table content/);
  assert.match(outXml, /Header line/);
  assert.match(outXml, /Second student segment/);
});

test('mergeReportInstanceDocxBuffers combines two minimal documents', () => {
  const first = buildMinimalDocx('First student');
  const second = buildMinimalDocx('Second student');
  const merged = reportDocxRenderService.mergeReportInstanceDocxBuffers([first, second]);
  assert.ok(merged.length > 100);
  reportDocxRenderService.assertValidDocxPackage(merged, 'merged test');
  const zip = new PizZip(merged);
  const xml = zip.file('word/document.xml')?.asText() || '';
  assert.match(xml, /First student/);
  assert.match(xml, /Second student/);
});

test('buildDocxTemplateLoadPlan dedupes unique DOCX refs from targets', async () => {
  const cache = reportExportBatchCacheService.createExportBatchCache();
  const classTemplate = {
    id: 'report-1',
    docxTemplate: { path: '/tmp/class-default.docx', originalName: 'class.docx' }
  };
  const overallTemplate = {
    id: 'overall-1',
    title: 'Overall',
    docxTemplate: { path: '/tmp/overall-default.docx', originalName: 'overall.docx' },
    sourceSlots: [{
      slotKey: 'A',
      templateId: 'report-1',
      requirement: 'necessary',
      order: 1
    }]
  };
  cache.templateById.set('report-1', classTemplate);
  cache.templateById.set('overall-1', overallTemplate);
  const student = {
    personId: 'stu-1',
    name: 'Student One',
    classes: [{ classId: 'class-1', className: 'Math', teacherId: 'tea-1' }]
  };
  const studentMap = new Map([['stu-1', student]]);
  const ctx = {
    policy: { reportTemplateId: 'report-1' },
    overallTemplates: [overallTemplate],
    startDate: '2026-10-01',
    endDate: '2026-10-31'
  };
  const targets = [
    { type: 'overall', studentId: 'stu-1', overallTemplateId: 'overall-1', templateVariantKey: 'default', classIds: ['class-1'] },
    { type: 'overall', studentId: 'stu-1', overallTemplateId: 'overall-1', templateVariantKey: 'default', classIds: ['class-1'] }
  ];
  const plan = await studentAttendanceReportGenerationService.buildDocxTemplateLoadPlan(
    targets,
    ctx,
    studentMap,
    cache,
    {}
  );
  assert.equal(plan.uniqueRefs.length, 1);
  assert.equal(plan.uniqueRefs[0].templateId, 'overall-1');
});
