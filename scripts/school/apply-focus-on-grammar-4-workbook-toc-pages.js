#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const BOOK_ID = String(process.argv[2] || '105330').trim();
/** Printed workbook page count (5th ed.); answer key begins on p. 173. */
const TOTAL_PAGES = 192;

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
  { level: 1, label: 'Part 1: Present and Past: Review and Expansion', startPage: 1 },
  { level: 2, label: 'Unit 1: Simple Present and Present Progressive', startPage: 1 },
  { level: 2, label: 'Unit 2: Simple Past and Past Progressive', startPage: 5 },
  { level: 2, label: 'Unit 3: Simple Past, Present Perfect, and Present Perfect Progressive', startPage: 10 },
  { level: 2, label: 'Unit 4: Past Perfect and Past Perfect Progressive', startPage: 17 },
  { level: 1, label: 'Part 2: Future: Review and Expansion', startPage: 27 },
  { level: 2, label: 'Unit 5: Future and Future Progressive', startPage: 27 },
  { level: 2, label: 'Unit 6: Future Perfect and Future Perfect Progressive', startPage: 33 },
  { level: 1, label: 'Part 3: Negative and Tag Questions, Additions and Responses', startPage: 39 },
  { level: 2, label: 'Unit 7: Negative Yes/No Questions and Tag Questions', startPage: 39 },
  { level: 2, label: 'Unit 8: Additions and Responses: So, Too, Neither, Not either, and But', startPage: 45 },
  { level: 1, label: 'Part 4: Gerunds, Infinitives, and Phrasal Verbs', startPage: 50 },
  { level: 2, label: 'Unit 9: Gerunds and Infinitives: Review and Expansion', startPage: 50 },
  { level: 2, label: 'Unit 10: Make, Have, Let, Help, and Get', startPage: 57 },
  { level: 2, label: 'Unit 11: Phrasal Verbs: Review and Expansion', startPage: 62 },
  { level: 1, label: 'Part 5: Adjective Clauses', startPage: 68 },
  { level: 2, label: 'Unit 12: Adjective Clauses with Subject Relative Pronouns', startPage: 68 },
  { level: 2, label: 'Unit 13: Adjective Clauses with Object Relative Pronouns', startPage: 74 },
  { level: 1, label: 'Part 6: Modals: Review and Expansion', startPage: 80 },
  { level: 2, label: 'Unit 14: Modals and Similar Expressions: Review', startPage: 80 },
  { level: 2, label: 'Unit 15: Advisability in the Past', startPage: 84 },
  { level: 2, label: 'Unit 16: Speculations About the Past', startPage: 89 },
  { level: 1, label: 'Part 7: The Passive', startPage: 96 },
  { level: 2, label: 'Unit 17: The Passive: Overview', startPage: 96 },
  { level: 2, label: 'Unit 18: The Passive with Modals and Similar Expressions', startPage: 102 },
  { level: 2, label: 'Unit 19: The Passive Causative', startPage: 107 },
  { level: 1, label: 'Part 8: Conditional Sentences', startPage: 113 },
  { level: 2, label: 'Unit 20: Present Real Conditional Sentences', startPage: 113 },
  { level: 2, label: 'Unit 21: Future Real Conditional Sentences', startPage: 120 },
  { level: 2, label: 'Unit 22: Present and Future Unreal Conditional Sentences', startPage: 126 },
  { level: 2, label: 'Unit 23: Past Unreal Conditional Sentences', startPage: 134 },
  { level: 1, label: 'Part 9: Indirect Speech and Embedded Questions', startPage: 143 },
  { level: 2, label: 'Unit 24: Direct and Indirect Speech', startPage: 143 },
  { level: 2, label: 'Unit 25: Tense Changes in Indirect Speech', startPage: 149 },
  { level: 2, label: 'Unit 26: Indirect Instructions, Commands, Advice, Requests, Invitations', startPage: 155 },
  { level: 2, label: 'Unit 27: Indirect Questions', startPage: 161 },
  { level: 2, label: 'Unit 28: Embedded Questions', startPage: 167 },
  { level: 1, label: 'Workbook Answer Key', startPage: 173 }
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
    audit: { lastUpdateUser: 'focus-on-grammar-4-workbook-toc-pages', lastUpdateDateTime: new Date().toISOString() }
  });

  console.log(`Updated book ${BOOK_ID} (${book.title} — ${book.subtitle || ''}): ${tableOfContents.length} TOC rows, totalPages=${TOTAL_PAGES}`);
  await disconnectMongo();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
