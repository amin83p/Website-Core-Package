/**
 * Validates docs/design_docs/access-definition-catalog.json:
 * - JSON parses and version is present
 * - Referenced markdown/docx paths exist under design_docs
 * - superseded.replacedBy paths exist
 *
 * Usage: node scripts/design_docs/validate-access-catalog.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DESIGN_DOCS = path.join(ROOT, 'docs/design_docs');
const CATALOG_PATH = path.join(DESIGN_DOCS, 'access-definition-catalog.json');

function fail(message) {
  console.error(`access-definition-catalog: ${message}`);
  process.exitCode = 1;
}

function assertFile(relativePath, label) {
  if (!relativePath) return;
  const full = path.join(DESIGN_DOCS, relativePath.replace(/\//g, path.sep));
  if (!fs.existsSync(full)) {
    fail(`missing ${label}: ${relativePath}`);
  }
}

function collectMarkdownAndDocx(entry) {
  if (entry.markdown) assertFile(entry.markdown, 'markdown');
  if (entry.docx) assertFile(entry.docx, 'docx');
}

let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
} catch (err) {
  fail(`cannot read or parse ${CATALOG_PATH}: ${err.message}`);
  process.exit(1);
}

if (!catalog.version) {
  fail('missing "version" field');
}

for (const block of ['foundation', 'sections', 'crossCutting', 'otherReferences']) {
  if (!Array.isArray(catalog[block])) {
    fail(`"${block}" must be an array`);
    continue;
  }
  for (const entry of catalog[block]) {
    collectMarkdownAndDocx(entry);
  }
}

if (!Array.isArray(catalog.superseded)) {
  fail('"superseded" must be an array');
} else {
  for (const entry of catalog.superseded) {
    if (entry.markdown) assertFile(entry.markdown, 'superseded markdown');
    if (entry.replacedBy) assertFile(entry.replacedBy, 'replacedBy');
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('access-definition-catalog: OK');
