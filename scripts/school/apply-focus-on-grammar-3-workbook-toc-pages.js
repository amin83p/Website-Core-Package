#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const BOOK_ID = String(process.argv[2] || '948636').trim();
/** Printed workbook page count (5th ed.); answer key begins on p. 195. */
const TOTAL_PAGES = 216;

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

const FULL_TOC_LABELS = [
  { level: 1, label: 'Part 1: Present and Past', startPage: 1 },
  { level: 2, label: 'Unit 1: Present Progressive and Simple Present', startPage: 1 },
  { level: 2, label: 'Unit 2: Simple Past', startPage: 10 },
  { level: 2, label: 'Unit 3: Past Progressive and Simple Past', startPage: 19 },
  { level: 2, label: 'Unit 4: Used to and Would', startPage: 25 },
  { level: 2, label: 'Unit 5: Wh- Questions', startPage: 30 },
  { level: 1, label: 'Part 2: The Future', startPage: 35 },
  { level: 2, label: 'Unit 6: Future', startPage: 35 },
  { level: 2, label: 'Unit 7: Future Time Clauses', startPage: 44 },
  { level: 1, label: 'Part 3: Present Perfect', startPage: 49 },
  { level: 2, label: 'Unit 8: Present Perfect: Since and For', startPage: 49 },
  { level: 2, label: 'Unit 9: Present Perfect: Already, Yet, and Still', startPage: 55 },
  { level: 2, label: 'Unit 10: Present Perfect: Indefinite Past', startPage: 61 },
  { level: 2, label: 'Unit 11: Present Perfect and Simple Past', startPage: 67 },
  { level: 2, label: 'Unit 12: Present Perfect Progressive and Present Perfect', startPage: 73 },
  { level: 1, label: 'Part 4: Modals and Similar Expressions', startPage: 80 },
  { level: 2, label: 'Unit 13: Ability and Possibility: Can, Could, Be able to', startPage: 80 },
  { level: 2, label: 'Unit 14: Permission: Can, Could, May, Do you mind if', startPage: 90 },
  { level: 2, label: 'Unit 15: Requests: Can, Could, Will, Would, Would you mind', startPage: 94 },
  { level: 2, label: 'Unit 16: Advice: Should, Ought to, Had better', startPage: 99 },
  { level: 1, label: 'Part 5: Nouns, Quantifiers, and Articles', startPage: 105 },
  { level: 2, label: 'Unit 17: Nouns and Quantifiers', startPage: 105 },
  { level: 2, label: 'Unit 18: Articles: Indefinite and Definite', startPage: 110 },
  { level: 1, label: 'Part 6: Adjectives and Adverbs', startPage: 115 },
  { level: 2, label: 'Unit 19: Adjectives and Adverbs', startPage: 115 },
  { level: 2, label: 'Unit 20: Adjectives: Comparisons with As...as and Than', startPage: 121 },
  { level: 2, label: 'Unit 21: Adjectives: Superlatives', startPage: 128 },
  { level: 2, label: 'Unit 22: Adverbs: As...as, Comparatives, Superlatives', startPage: 134 },
  { level: 1, label: 'Part 7: Gerunds and Infinitives', startPage: 140 },
  { level: 2, label: 'Unit 23: Gerunds: Subject and Object', startPage: 140 },
  { level: 2, label: 'Unit 24: Infinitives After Certain Verbs', startPage: 146 },
  { level: 2, label: 'Unit 25: More Uses of Infinitives', startPage: 151 },
  { level: 2, label: 'Unit 26: Gerunds and Infinitives', startPage: 157 },
  { level: 1, label: 'Part 8: Pronouns and Phrasal Verbs', startPage: 162 },
  { level: 2, label: 'Unit 27: Reflexive and Reciprocal Pronouns', startPage: 162 },
  { level: 2, label: 'Unit 28: Phrasal Verbs', startPage: 167 },
  { level: 1, label: 'Part 9: More Modals and Similar Expressions', startPage: 172 },
  { level: 2, label: "Unit 29: Necessity: Have (got) to, Must, Can't", startPage: 172 },
  { level: 2, label: 'Unit 30: Expectations: Be supposed to', startPage: 179 },
  { level: 2, label: 'Unit 31: Future Possibility: May, Might, Could', startPage: 185 },
  { level: 2, label: "Unit 32: Present Conclusions: Must, Have (got) to, May, Might, Could, Can't", startPage: 189 },
  { level: 1, label: 'Workbook Answer Key', startPage: 195 }
];

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
    totalPages: TOTAL_PAGES,
    audit: { lastUpdateUser: 'focus-on-grammar-3-workbook-toc-pages', lastUpdateDateTime: new Date().toISOString() }
  });

  console.log(`Updated book ${BOOK_ID} (${book.title} — ${book.subtitle || ''}): ${tableOfContents.length} TOC rows, totalPages=${TOTAL_PAGES}`);
  await disconnectMongo();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
