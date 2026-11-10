const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');

const reportDocxRenderCore = require('../MVC/services/school/reportDocxRenderCore');
const reportDocxRenderService = require('../MVC/services/school/reportDocxRenderService');
const sarLocalRenderBundleService = require('../MVC/services/school/sarLocalRenderBundleService');
const { BUNDLE_SCHEMA_VERSION, SUPPORTED_RENDER_CORE_VERSION } = require('../MVC/services/school/sarLocalRenderBundleSchema');

function buildMinimalTemplateDocx(tag = 'name') {
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
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{{${tag}}}</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function buildSampleBundle({ mergeMode = 'single' } = {}) {
  const templateBinary = buildMinimalTemplateDocx('student_name');
  const templateKey = 'tpl-1|default';
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    renderCoreVersion: SUPPORTED_RENDER_CORE_VERSION,
    manifest: {
      createdAt: new Date().toISOString(),
      orgId: 'org-test',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      targetCount: 2,
      mergePolicy: {
        mode: mergeMode,
        outputStem: 'student_attendance_test'
      }
    },
    templates: {
      [templateKey]: {
        templateId: 'tpl-1',
        variantKey: 'default',
        label: 'Test template',
        dataBase64: Buffer.from(templateBinary).toString('base64')
      }
    },
    targets: [
      {
        id: 'class:stu-1:class-1',
        templateRefKey: templateKey,
        fileName: 'student_one.docx',
        placeholders: { student_name: 'Student One' },
        collections: {}
      },
      {
        id: 'class:stu-2:class-1',
        templateRefKey: templateKey,
        fileName: 'student_two.docx',
        placeholders: { student_name: 'Student Two' },
        collections: {}
      }
    ]
  };
}

test('validateRenderBundle accepts minimal in-memory bundle', () => {
  const bundle = buildSampleBundle();
  assert.equal(sarLocalRenderBundleService.validateRenderBundle(bundle), true);
});

test('exportRenderedBundle produces merged DOCX from bundle', async () => {
  const bundle = buildSampleBundle({ mergeMode: 'single' });
  const result = await sarLocalRenderBundleService.exportRenderedBundle(bundle, { concurrency: 2 });
  assert.match(result.fileName, /\.docx$/i);
  reportDocxRenderService.assertValidDocxPackage(result.buffer, result.fileName);
  const xml = new PizZip(result.buffer).file('word/document.xml')?.asText() || '';
  assert.match(xml, /Student One/);
  assert.match(xml, /Student Two/);
});

test('packBundleAsZipBuffer round-trips through exportRenderedBundle', async () => {
  const bundle = buildSampleBundle({ mergeMode: 'single' });
  const zip = sarLocalRenderBundleService.packBundleAsZipBuffer(bundle);
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const JSZip = require('jszip');
  const loaded = await JSZip.loadAsync(zipBuffer);
  const manifestPack = JSON.parse(await loaded.file('manifest.json').async('string'));
  const targets = JSON.parse(await loaded.file('targets.json').async('string'));
  const templateIndex = JSON.parse(await loaded.file('templates/index.json').async('string'));
  const templates = {};
  for (const [key, meta] of Object.entries(templateIndex)) {
    templates[key] = {
      templateId: meta.templateId,
      variantKey: meta.variantKey,
      label: meta.label,
      dataBase64: await loaded.file(meta.file).async('string')
    };
  }
  const roundTrip = {
    schemaVersion: manifestPack.schemaVersion,
    renderCoreVersion: manifestPack.renderCoreVersion,
    manifest: manifestPack.manifest,
    targets,
    templates
  };
  sarLocalRenderBundleService.validateRenderBundle(roundTrip);
  const rendered = await sarLocalRenderBundleService.exportRenderedBundle(roundTrip);
  reportDocxRenderCore.assertValidDocxPackage(rendered.buffer, rendered.fileName);
});
