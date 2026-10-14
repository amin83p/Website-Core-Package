const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { convertGeminiBookTocSource } = require('../../../scripts/school/bookTocImportLib');

const sourcePath = path.join(__dirname, '../../../data/school/book-toc-sources/basic-tactics-for-listening.json');
const riverSourcePath = path.join(__dirname, '../../../data/school/book-toc-sources/at-the-river-and-other-stories.json');
const grammarSourcePath = path.join(__dirname, '../../../data/school/book-toc-sources/basic-english-grammar-5th-edition.json');
const wordBookSourcePath = path.join(__dirname, '../../../data/school/book-toc-sources/canadian-english-personal-word-book.json');
const connectivitySourcePath = path.join(__dirname, '../../../data/school/book-toc-sources/connectivity-level-2.json');
const customerServiceSourcePath = path.join(__dirname, '../../../data/school/book-toc-sources/customer-service-training-101.json');
const elementsSuccessSourcePath = path.join(__dirname, '../../../data/school/book-toc-sources/elements-of-success-1.json');
const eviuSourcePath = path.join(__dirname, '../../../data/school/book-toc-sources/english-vocabulary-in-use-upper-intermediate.json');

test('convertGeminiBookTocSource flattens Basic Tactics sample with units and skills', () => {
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const converted = convertGeminiBookTocSource(source);
  assert.equal(converted.bookTitle, 'Basic Tactics for Listening');
  assert.ok(converted.tableOfContents.length > 100);
  const unit1 = converted.tableOfContents.find((row) => row.label === 'Unit 1: Introductions and Names');
  assert.ok(unit1);
  assert.equal(unit1.level, 2);
  assert.equal(unit1.startPage, 2);
  const listeningSkills = converted.tableOfContents.find((row) => row.id.includes('u01') && row.label === 'Listening Skills');
  assert.ok(listeningSkills);
  const skillItem = converted.tableOfContents.find((row) => row.label === 'Listening for names' && row.level === 4);
  assert.ok(skillItem);
  assert.equal(converted.suggestedTotalPages, 109);
});

test('convertGeminiBookTocSource flattens At the River source with units and story items', () => {
  const source = JSON.parse(fs.readFileSync(riverSourcePath, 'utf8'));
  const converted = convertGeminiBookTocSource(source);
  assert.equal(converted.bookTitle, 'At the River and Other Stories');
  assert.ok(converted.tableOfContents.length > 40);
  const unit1 = converted.tableOfContents.find((row) => row.label === 'Unit 1: Pam');
  assert.ok(unit1);
  assert.equal(unit1.level, 2);
  const pamStory = converted.tableOfContents.find((row) => row.label === 'Pam' && row.level === 4);
  assert.ok(pamStory);
  assert.equal(converted.suggestedTotalPages, 130);
});

test('convertGeminiBookTocSource flattens grammar book chapters sections and roman pages', () => {
  const source = JSON.parse(fs.readFileSync(grammarSourcePath, 'utf8'));
  const converted = convertGeminiBookTocSource(source);
  assert.equal(converted.bookTitle, 'Basic English Grammar - 5th edition');
  assert.ok(converted.tableOfContents.length > 150);
  const chapter1 = converted.tableOfContents.find((row) => row.label === 'Chapter 1: USING BE');
  assert.ok(chapter1);
  assert.equal(chapter1.level, 2);
  const section = converted.tableOfContents.find((row) => row.label === '1-1 Singular Pronouns + Be');
  assert.ok(section);
  assert.equal(section.level, 3);
  const frontMatter = converted.tableOfContents.find((row) => row.label === 'Front Matter');
  assert.ok(frontMatter);
  assert.equal(frontMatter.startPage, 10);
  assert.equal(converted.suggestedTotalPages, 523);
});

test('convertGeminiBookTocSource flattens word book H1 sections and named cover pages', () => {
  const source = JSON.parse(fs.readFileSync(wordBookSourcePath, 'utf8'));
  const converted = convertGeminiBookTocSource(source);
  assert.equal(converted.bookTitle, 'Canadian English Personal Word Book');
  assert.ok(converted.tableOfContents.length >= 40);
  const food = converted.tableOfContents.find((row) => row.label === 'Food');
  assert.ok(food);
  assert.equal(food.startPage, 12);
  assert.equal(food.endPage, 15);
  const oCanada = converted.tableOfContents.find((row) => row.label === 'O Canada');
  assert.ok(oCanada);
  assert.equal(oCanada.startPage, 65);
  assert.equal(converted.suggestedTotalPages, 65);
});

test('convertGeminiBookTocSource flattens Connectivity Level 2 units and reference sections', () => {
  const source = JSON.parse(fs.readFileSync(connectivitySourcePath, 'utf8'));
  const converted = convertGeminiBookTocSource(source);
  assert.equal(converted.bookTitle, 'Connectivity Level 2');
  assert.equal(converted.tableOfContents.length, 16);
  const unit1 = converted.tableOfContents.find((row) => row.label === 'Unit 1: Making New Friends');
  assert.ok(unit1);
  assert.equal(unit1.startPage, 1);
  const grammar = converted.tableOfContents.find((row) => row.label === 'Grammar Expander');
  assert.ok(grammar);
  assert.equal(grammar.startPage, 126);
  assert.equal(converted.suggestedTotalPages, 153);
});

test('convertGeminiBookTocSource flattens Customer Service Training parts chapters and steps', () => {
  const source = JSON.parse(fs.readFileSync(customerServiceSourcePath, 'utf8'));
  const converted = convertGeminiBookTocSource(source);
  assert.equal(converted.bookTitle, 'Customer Service Training 101');
  assert.ok(converted.tableOfContents.length >= 70);
  const chapter1 = converted.tableOfContents.find((row) => row.label === 'Chapter 1: Taking Baby Steps: The Basics');
  assert.ok(chapter1);
  const step1 = converted.tableOfContents.find((row) => row.label === 'Step 1: First Impressions Matter');
  assert.ok(step1);
  assert.equal(step1.level, 3);
  assert.equal(converted.suggestedTotalPages, 203);
});

test('convertGeminiBookTocSource flattens Elements of Success chapter sections and back matter codes', () => {
  const source = JSON.parse(fs.readFileSync(elementsSuccessSourcePath, 'utf8'));
  const converted = convertGeminiBookTocSource(source);
  assert.equal(converted.bookTitle, 'Elements of Success 1');
  assert.ok(converted.tableOfContents.length > 200);
  const chapter1 = converted.tableOfContents.find((row) => row.label === 'Chapter 1: Introduction to Parts of Speech');
  assert.ok(chapter1);
  const section = converted.tableOfContents.find((row) => row.label === '1.1 Nouns');
  assert.ok(section);
  assert.equal(section.level, 2);
  const note = converted.tableOfContents.find((row) => row.label === 'Spelling Note: A and An');
  assert.ok(note);
  assert.equal(note.level, 3);
  const index = converted.tableOfContents.find((row) => row.label === 'Index');
  assert.ok(index);
  assert.equal(index.startPage, 386);
  assert.equal(converted.suggestedTotalPages, 386);
});

test('convertGeminiBookTocSource flattens English Vocabulary in Use units and back matter', () => {
  const source = JSON.parse(fs.readFileSync(eviuSourcePath, 'utf8'));
  const converted = convertGeminiBookTocSource(source);
  assert.equal(converted.bookTitle, 'English Vocabulary in Use Upper-Intermediate');
  assert.equal(converted.tableOfContents.length, 119);
  const unit101 = converted.tableOfContents.find((row) => row.label === 'Unit 101: US English');
  assert.ok(unit101);
  assert.equal(unit101.startPage, 208);
  const answerKey = converted.tableOfContents.find((row) => row.label === 'Answer key');
  assert.ok(answerKey);
  assert.equal(converted.suggestedTotalPages, 280);
});
