#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const BOOK_ID = String(process.argv[2] || '900633').trim();
const TOTAL_PAGES = 96;

/** Interchange Level 1 Workbook contents (printed page numbers). */
const FULL_TOC_LABELS = [
  { level: 1, label: 'Credits (p. iv)', startPage: 4 },
  { level: 1, label: 'Unit 1: Where are you from?', startPage: 1 },
  { level: 1, label: 'Unit 2: What do you do?', startPage: 7 },
  { level: 1, label: 'Unit 3: How much are these?', startPage: 13 },
  { level: 1, label: 'Unit 4: Do you play the guitar?', startPage: 19 },
  { level: 1, label: 'Unit 5: What an interesting family!', startPage: 25 },
  { level: 1, label: 'Unit 6: How often do you run?', startPage: 31 },
  { level: 1, label: 'Unit 7: We went dancing!', startPage: 37 },
  { level: 1, label: "Unit 8: How's the neighborhood?", startPage: 43 },
  { level: 1, label: 'Unit 9: What does she look like?', startPage: 49 },
  { level: 1, label: 'Unit 10: Have you ever been there?', startPage: 55 },
  { level: 1, label: "Unit 11: It's a really nice city.", startPage: 61 },
  { level: 1, label: "Unit 12: It's important to get rest.", startPage: 67 },
  { level: 1, label: 'Unit 13: What would you like?', startPage: 73 },
  { level: 1, label: "Unit 14: It's the coldest city!", startPage: 79 },
  { level: 1, label: 'Unit 15: What are you doing later?', startPage: 85 },
  { level: 1, label: 'Unit 16: How have you changed?', startPage: 91 }
];

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) return;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function computeEndPages(rows) {
  return rows.map((row, index) => {
    let endPage = row.startPage;
    for (let j = index + 1; j < rows.length; j += 1) {
      if (rows[j].level <= row.level) {
        endPage = Math.max(row.startPage, rows[j].startPage - 1);
        break;
      }
    }
    if (index === rows.length - 1) {
      endPage = TOTAL_PAGES;
    }
    return { ...row, endPage };
  });
}

loadEnvFile(path.join(root, '.env'));
const { resolveDataBackendConfig } = require(path.join(root, 'config/dataBackend'));
const { setActiveDataBackendConfig } = require(path.join(root, 'MVC/infrastructure/runtime/dataBackendRuntime'));
const { connectMongo, disconnectMongo, getMongoCollection } = require(path.join(root, 'MVC/infrastructure/mongo/mongoConnection'));
const bookModel = require(path.join(root, 'packages/school/MVC/models/school/bookModel'));
const schoolRepositories = require(path.join(root, 'packages/school/MVC/repositories/school'));

(async () => {
  const cfg = resolveDataBackendConfig(process.env);
  setActiveDataBackendConfig(cfg);
  if (cfg.mode !== 'mongo') throw new Error('Mongo backend required');
  await connectMongo({ uri: cfg.mongo.uri });

  const col = await getMongoCollection('schoolBooks');
  const book = await col.findOne({ id: BOOK_ID });
  if (!book) throw new Error(`Book ${BOOK_ID} not found`);

  const existingByLabel = new Map((book.tableOfContents || []).map((e) => [String(e.label || '').trim(), e]));

  const withPages = FULL_TOC_LABELS.map((row, index) => {
    const prior = existingByLabel.get(row.label.trim());
    return {
      id: prior?.id || bookModel.generateTocEntryId(),
      label: row.label,
      level: row.level,
      startPage: row.startPage,
      sortOrder: index + 1
    };
  });

  const withEnds = computeEndPages(withPages);
  const tableOfContents = bookModel.normalizeTableOfContents(withEnds, TOTAL_PAGES);

  await schoolRepositories.books.update(BOOK_ID, {
    tableOfContents,
    totalPages: TOTAL_PAGES
  });

  console.log(
    `Updated book ${BOOK_ID} (${book.title}${book.subtitle ? ` — ${book.subtitle}` : ''}): `
    + `${tableOfContents.length} TOC rows, totalPages=${TOTAL_PAGES}`
  );
  await disconnectMongo();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
