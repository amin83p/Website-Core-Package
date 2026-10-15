#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const BOOK_ID = String(process.argv[2] || '602550').trim();
const TOTAL_PAGES = 236;
const { buildHaveYourSay1TocLabels } = require('./have-your-say-1-toc-data');

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
  const FULL_TOC_LABELS = buildHaveYourSay1TocLabels();

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
    totalPages: TOTAL_PAGES,
    audit: { lastUpdateUser: 'have-your-say-1-toc-pages', lastUpdateDateTime: new Date().toISOString() }
  });

  console.log(`Updated book ${BOOK_ID} (${book.title} — ${book.subtitle || ''}): ${tableOfContents.length} TOC rows, totalPages=${TOTAL_PAGES}`);
  await disconnectMongo();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
