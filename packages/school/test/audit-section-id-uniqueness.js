'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_GLOBS = [
  'packages/school/package.manifest.json',
  'packages/ielts/package.manifest.json',
  'packages/pte/package.manifest.json',
  'packages/benchpath/package.manifest.json',
  'packages/credit/package.manifest.json'
];

const SCHOOL_AI_NAMES = new Set([
  'SCHOOL_AI_ASSIST',
  'SCHOOL_AI_PROVIDER_KEYS',
  'SCHOOL_AI_SERVICE_ASSIGNMENTS',
  'SCHOOL_AI_TOKEN_USAGE',
  'SCHOOL_AI_USAGE_LIMITS'
]);

function collectManifestSections() {
  const byId = new Map();
  for (const rel of MANIFEST_GLOBS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const manifest = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const sections = Array.isArray(manifest.sections) ? manifest.sections : [];
    sections.forEach((section) => {
      const id = String(section?.id || '').trim();
      if (!id) return;
      const entry = {
        id,
        name: String(section?.name || ''),
        category: String(section?.category || ''),
        package: path.basename(path.dirname(abs)),
        subsectionIds: (section.subsections || []).map((s) => String(s?.id || s))
      };
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(entry);
    });
  }
  return byId;
}

function collectSectionsJson() {
  const abs = path.join(ROOT, 'data', 'sections.json');
  if (!fs.existsSync(abs)) return { byId: new Map(), schoolAiParent: null };
  const rows = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const list = Array.isArray(rows) ? rows : [];
  const byId = new Map();
  list.forEach((section) => {
    const id = String(section?.id || '').trim();
    if (!id) return;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({
      id,
      name: String(section?.name || ''),
      category: String(section?.category || ''),
      source: 'data/sections.json',
      subsectionIds: (section.subsections || []).map((s) => String(s?.id || s))
    });
  });
  const schoolAiParent = list.find((s) => String(s?.name || '').toUpperCase() === 'SCHOOL_AI_ASSIST') || null;
  return { byId, schoolAiParent };
}

function run() {
  const manifestById = collectManifestSections();
  const { byId: jsonById, schoolAiParent } = collectSectionsJson();

  const duplicateIds = [];
  manifestById.forEach((entries, id) => {
    if (entries.length > 1) duplicateIds.push({ id, entries });
  });

  const schoolAiManifest = [];
  manifestById.forEach((entries) => {
    entries.forEach((e) => {
      if (SCHOOL_AI_NAMES.has(e.name)) schoolAiManifest.push(e);
    });
  });

  const targetIds = ['446200', '446210', '446211', '446212', '446213', '446201', '446202', '446203'];
  const idOwners = {};
  targetIds.forEach((id) => {
    idOwners[id] = {
      manifest: manifestById.get(id) || [],
      sectionsJson: jsonById.get(id) || []
    };
  });

  const hasDupes = duplicateIds.length > 0;
  const schoolUsesLegacy = (manifestById.get('446201') || []).some((e) => SCHOOL_AI_NAMES.has(e.name));
  console.log(hasDupes ? 'DUPLICATE manifest section ids found' : 'No duplicate manifest section ids');
  console.log(schoolUsesLegacy ? 'School AI still uses legacy 446201-203' : 'School AI manifest ids avoid 446201-203');
}

run();