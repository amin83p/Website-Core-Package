#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const BOOK_ID = String(process.argv[2] || '994821').trim();
const TOTAL_PAGES = 496;

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

/** Printed book page numbers from Focus on Grammar 2 student edition contents. */
const PAGE_BY_LABEL_PREFIX = [
  ['Front Matter:', 5],
  ['Part 1:', 2],
  ['Unit 1:', 4],
  ['Unit 2:', 15],
  ['Unit 3:', 28],
  ['Part 2:', 40],
  ['Unit 4:', 42],
  ['Unit 5:', 54],
  ['Unit 6:', 63],
  ['Part 3:', 74],
  ['Unit 7:', 76],
  ['Unit 8:', 86],
  ['Unit 9:', 98],
  ['Unit 10:', 109],
  ['Part 4:', 120],
  ['Unit 11:', 122],
  ['Unit 12:', 135],
  ['Part 5:', 148],
  ['Unit 13:', 150],
  ['Unit 14:', 160],
  ['Part 6:', 170],
  ['Unit 15:', 172],
  ['Unit 16:', 183],
  ['Unit 17:', 194],
  ['Part 7:', 206],
  ['Unit 18:', 208],
  ['Unit 19:', 220],
  ['Unit 20:', 231],
  ['Unit 21:', 242],
  ['Part 8:', 256],
  ['Unit 22:', 258],
  ['Unit 23:', 272],
  ['Unit 24:', 285],
  ['Unit 25:', 295],
  ['Part 9:', 306],
  ['Unit 26:', 308],
  ['Unit 27:', 322],
  ['Unit 28:', 335],
  ['Part 10:', 346],
  ['Unit 29:', 348],
  ['Unit 30:', 361],
  ['Part 11:', 374],
  ['Unit 31:', 376],
  ['Unit 32:', 391],
  ['Unit 33:', 401],
  ['Unit 34:', 415],
  ['Appendices', 429],
  ['Glossary of Grammar Terms', 441],
  ['Unit Review Answer Key', 445],
  ['Key to Exercises with Guessed Answers', 453],
  ['Information Gaps, Student B', 455],
  ['Index', 459]
];

const FULL_TOC_LABELS = [
  { level: 1, label: 'Front Matter: Course Tour, Scope & Sequence Matrix, and Openers (pages v–xxix)' },
  { level: 1, label: 'Part 1: Be: Present and Past' },
  { level: 2, label: 'Unit 1: Present of Be: Statements' },
  { level: 2, label: 'Unit 2: Present of Be: Questions' },
  { level: 2, label: 'Unit 3: Past of Be' },
  { level: 1, label: 'Part 2: Nouns, Adjectives, and Prepositions' },
  { level: 2, label: 'Unit 4: Count Nouns and Proper Nouns' },
  { level: 2, label: 'Unit 5: Descriptive Adjectives' },
  { level: 2, label: 'Unit 6: Prepositions of Place' },
  { level: 1, label: 'Part 3: Imperatives and the Simple Present' },
  { level: 2, label: "Unit 7: Imperatives; Suggestions with Let's" },
  { level: 2, label: 'Unit 8: Simple Present: Affirmative and Negative Statements' },
  { level: 2, label: 'Unit 9: Simple Present: Yes/No Questions and Short Answers' },
  { level: 2, label: 'Unit 10: Simple Present: Wh- Questions' },
  { level: 1, label: 'Part 4: There Is / There Are; Possessives' },
  { level: 2, label: 'Unit 11: There is / There are' },
  { level: 2, label: 'Unit 12: Possessive Nouns and Adjectives; Questions with Whose' },
  { level: 1, label: 'Part 5: Modals: Ability and Permission' },
  { level: 2, label: 'Unit 13: Ability: Can or Could' },
  { level: 2, label: 'Unit 14: Permission: Can or May' },
  { level: 1, label: 'Part 6: Present Progressive' },
  { level: 2, label: 'Unit 15: Present Progressive: Affirmative and Negative Statements' },
  { level: 2, label: 'Unit 16: Present Progressive: Yes/No and Wh- Questions' },
  { level: 2, label: 'Unit 17: Simple Present and Present Progressive; Non-Action Verbs' },
  { level: 1, label: 'Part 7: Simple Past' },
  { level: 2, label: 'Unit 18: Simple Past: Statements with Regular Verbs' },
  { level: 2, label: 'Unit 19: Simple Past: Statements with Irregular Verbs' },
  { level: 2, label: 'Unit 20: Simple Past: Questions' },
  { level: 2, label: 'Unit 21: Simple Past Review' },
  { level: 1, label: 'Part 8: The Future' },
  { level: 2, label: 'Unit 22: Be going to for the Future' },
  { level: 2, label: 'Unit 23: Will for the Future' },
  { level: 2, label: 'Unit 24: May or Might for Possibility' },
  { level: 2, label: 'Unit 25: Gerunds and Infinitives' },
  { level: 1, label: 'Part 9: Count/Non-Count Nouns; Much/Many; Quantifiers' },
  { level: 2, label: 'Unit 26: Articles with Count and Non-Count Nouns; Some/Any' },
  { level: 2, label: 'Unit 27: How much and How many; Quantifiers' },
  { level: 2, label: 'Unit 28: Too many and Too much; Enough + Noun' },
  { level: 1, label: 'Part 10: Modals: Advice and Necessity' },
  { level: 2, label: 'Unit 29: Advice: Should and Had better' },
  { level: 2, label: 'Unit 30: Necessity: Have to and Must' },
  { level: 1, label: 'Part 11: Comparisons' },
  { level: 2, label: 'Unit 31: The Comparative' },
  { level: 2, label: 'Unit 32: Adverbs of Manner' },
  { level: 2, label: 'Unit 33: Adjective + Enough; Too and Very; As + Adjective + As' },
  { level: 2, label: 'Unit 34: The Superlative' },
  { level: 1, label: 'Appendices' },
  { level: 1, label: 'Glossary of Grammar Terms' },
  { level: 1, label: 'Unit Review Answer Key' },
  { level: 1, label: 'Key to Exercises with Guessed Answers' },
  { level: 1, label: 'Information Gaps, Student B' },
  { level: 1, label: 'Index' }
];

function resolveStartPage(label) {
  const text = String(label || '');
  for (const [prefix, page] of PAGE_BY_LABEL_PREFIX) {
    if (text.startsWith(prefix) || text === prefix.replace(/:$/, '')) return page;
  }
  throw new Error(`No page mapping for label: ${label}`);
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
    const startPage = resolveStartPage(row.label);
    const prior = existingByLabel.get(row.label.trim());
    return {
      id: prior?.id || bookModel.generateTocEntryId(),
      label: row.label,
      level: row.level,
      startPage,
      sortOrder: index + 1
    };
  });

  const withEnds = computeEndPages(withPages);
  const tableOfContents = bookModel.normalizeTableOfContents(withEnds, TOTAL_PAGES);

  await schoolRepositories.books.update(BOOK_ID, {
    tableOfContents,
    totalPages: TOTAL_PAGES,
    audit: { lastUpdateUser: 'focus-on-grammar-2-toc-pages', lastUpdateDateTime: new Date().toISOString() }
  });

  console.log(`Updated book ${BOOK_ID} (${book.title}): ${tableOfContents.length} TOC rows, totalPages=${TOTAL_PAGES}`);
  await disconnectMongo();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
