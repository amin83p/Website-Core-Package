'use strict';

const bookModel = require('../../packages/school/MVC/models/school/bookModel');

function slugPart(value, maxLen = 48) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen) || 'item';
}

function levelFromHeading(levelToken) {
  const match = String(levelToken || '').match(/^H(\d)$/i);
  if (!match) return 1;
  return bookModel.normalizeTocLevel(Number(match[1]), 1);
}

function parseRomanNumeral(token) {
  const s = String(token || '').trim().toLowerCase();
  if (!s || !/^[ivxlcdm]+$/.test(s)) return null;
  const map = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  let prev = 0;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    const value = map[s[i]];
    if (!value) return null;
    if (value < prev) total -= value;
    else total += value;
    prev = value;
  }
  return total > 0 ? total : null;
}

const NAMED_BOOK_PAGES = Object.freeze({
  'inside front cover': 1,
  'inside back cover': 65
});

function parseBookPage(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
    return Math.round(value);
  }
  const str = String(value).trim();
  const named = NAMED_BOOK_PAGES[str.toLowerCase()];
  if (named) return named;
  if (/^\d+$/.test(str)) return Number(str);
  const roman = parseRomanNumeral(str);
  if (roman !== null) return roman;
  const prefixed = parsePrefixedBookPage(str);
  if (prefixed !== null) return prefixed;
  return null;
}

const PREFIXED_PAGE_BASE = Object.freeze({
  R: 10000,
  I: 20000,
  T: 30000
});

function parsePrefixedBookPage(token) {
  const match = String(token || '').trim().match(/^([A-Za-z])-(\d+)$/);
  if (!match) return null;
  const base = PREFIXED_PAGE_BASE[match[1].toUpperCase()];
  if (!base) return null;
  return base + Number(match[2]);
}

const AUXILIARY_PAGE_THRESHOLD = 10000;

function isAuxiliaryTocPage(page) {
  return Number(page || 0) >= AUXILIARY_PAGE_THRESHOLD;
}

function remapAuxiliaryTocPages(rows) {
  const bodyMax = rows.reduce((max, row) => {
    const end = Number(row.endPage || 0);
    if (isAuxiliaryTocPage(end)) return max;
    return Math.max(max, end);
  }, 0);
  const auxToPage = new Map();
  let nextPage = bodyMax + 1;

  const remap = (page) => {
    const value = Number(page || 0);
    if (!isAuxiliaryTocPage(value)) return value;
    if (!auxToPage.has(value)) {
      auxToPage.set(value, nextPage);
      nextPage += 1;
    }
    return auxToPage.get(value);
  };

  return rows.map((row) => ({
    ...row,
    startPage: remap(row.startPage),
    endPage: remap(row.endPage)
  }));
}

function listH1ChildUnits(h1) {
  const nested = h1.children || h1.units || h1.chapters || [];
  if (nested.length) return nested;
  if (Array.isArray(h1.sections) && h1.sections.length) return h1.sections;
  return [];
}

function pushRow(rows, { id, label, startPage, endPage, level, sortOrder }) {
  const start = parseBookPage(startPage);
  const end = parseBookPage(endPage);
  if (start === null || end === null) {
    throw new Error(`Invalid page numbers for TOC row "${label}": start=${startPage}, end=${endPage}`);
  }
  rows.push({
    id,
    label: String(label || '').trim().slice(0, 200),
    startPage: start,
    endPage: end,
    level: bookModel.normalizeTocLevel(level, 1),
    sortOrder
  });
}

function formatH3Label(sub) {
  const category = String(sub?.category || '').trim();
  const sectionNumber = String(sub?.section_number || '').trim();
  const stepNumber = sub?.step_number;
  const title = String(sub?.title || '').trim();
  if (category === 'Listening Skills') return 'Listening Skills';
  if (category === 'Tasks') return 'Tasks';
  if (stepNumber !== undefined && stepNumber !== null && stepNumber !== '' && title) {
    return `Step ${stepNumber}: ${title}`;
  }
  if (sectionNumber && title) return `${sectionNumber} ${title}`;
  if (category && title) return `${category}: ${title}`;
  if (title) return title;
  if (category) return category;
  return 'Section';
}

function formatH1Label(h1) {
  const title = String(h1?.title || '').trim();
  if (h1?.chapter_number) {
    return title ? `Chapter ${h1.chapter_number}: ${title}` : `Chapter ${h1.chapter_number}`;
  }
  return title;
}

function formatH2Label(unit) {
  const title = String(unit?.title || '').trim();
  const sectionNumber = String(unit?.section_number || '').trim();
  if (sectionNumber && title) return `${sectionNumber} ${title}`;
  if (unit?.unit_number) {
    return title ? `Unit ${unit.unit_number}: ${title}` : `Unit ${unit.unit_number}`;
  }
  if (unit?.chapter_number) {
    return title ? `Chapter ${unit.chapter_number}: ${title}` : `Chapter ${unit.chapter_number}`;
  }
  const range = String(unit?.units_range || '').trim();
  if (range) return `Units ${range}`;
  return title || 'Unit';
}

function resolveH1ChildMode(h1) {
  if ((h1.children || h1.units || h1.chapters || []).length) return 'nested';
  if (Array.isArray(h1.sections) && h1.sections.length) return 'flat_sections';
  return 'nested';
}

function listH3UnderUnit(unit, h1ChildMode) {
  if (Array.isArray(unit.subsections) && unit.subsections.length) return unit.subsections;
  if (h1ChildMode === 'flat_sections') {
    if (Array.isArray(unit.subheadings) && unit.subheadings.length) return unit.subheadings;
    return [];
  }
  if (Array.isArray(unit.subheadings) && unit.subheadings.length) return unit.subheadings;
  if (Array.isArray(unit.sections) && unit.sections.length) return unit.sections;
  return [];
}

function nestedH4Entries(sub) {
  const items = Array.isArray(sub?.items) ? sub.items : [];
  const subsections = Array.isArray(sub?.subsections) ? sub.subsections : [];
  return items.concat(subsections);
}

function convertGeminiBookTocSource(source = {}) {
  const rows = [];
  let sortOrder = 0;
  const bookSlug = slugPart(source.book_title || 'book', 24);

  const walkH3 = (unit, sub, unitSlug, subIndex) => {
    const startPage = sub.start_page;
    const endPage = sub.end_page;
    const category = String(sub?.category || '').trim();
    const nested = nestedH4Entries(sub);
    const subKey = slugPart(
      sub?.section_number || (sub?.step_number != null ? `step-${sub.step_number}` : '') || sub?.title || category || `sec-${subIndex + 1}`,
      24
    );
    const subSlug = `${unitSlug}-${subKey}`;

    const expandNested = nested.length > 0 && (
      category === 'Listening Skills'
      || category === 'Tasks'
      || category === 'Stories'
      || !category
    );

    const subLevel = levelFromHeading(sub.level || 'H3');
    const itemLevelDefault = subLevel >= 6 ? 6 : subLevel + 1;

    if (expandNested) {
      sortOrder += 1;
      pushRow(rows, {
        id: subSlug,
        label: formatH3Label(sub),
        startPage,
        endPage,
        level: subLevel,
        sortOrder
      });
      nested.forEach((item, itemIndex) => {
        sortOrder += 1;
        pushRow(rows, {
          id: `${subSlug}-i${itemIndex + 1}-${slugPart(item?.title, 20)}`,
          label: String(item?.title || '').trim(),
          startPage: item.start_page ?? startPage,
          endPage: item.end_page ?? endPage,
          level: levelFromHeading(item.level || `H${itemLevelDefault}`),
          sortOrder
        });
      });
      return;
    }

    sortOrder += 1;
    pushRow(rows, {
      id: subSlug,
      label: formatH3Label(sub),
      startPage,
      endPage,
      level: subLevel,
      sortOrder
    });
  };

  function hasDirectUnitSubheadings(h1) {
    return !listH1ChildUnits(h1).length && Array.isArray(h1.subheadings) && h1.subheadings.length > 0;
  }

  (source.table_of_contents || []).forEach((h1, h1Index) => {
    const h1ChildMode = resolveH1ChildMode(h1);
    const h1Units = listH1ChildUnits(h1);

    if (hasDirectUnitSubheadings(h1)) {
      const unitSlug = h1.unit_number
        ? `${bookSlug}-u${String(h1.unit_number).padStart(2, '0')}`
        : `${bookSlug}-h1-${h1Index + 1}-${slugPart(h1.title, 20)}`;
      sortOrder += 1;
      pushRow(rows, {
        id: unitSlug,
        label: formatH2Label(h1),
        startPage: h1.start_page,
        endPage: h1.end_page,
        level: levelFromHeading(h1.level || 'H1'),
        sortOrder
      });
      listH3UnderUnit(h1, 'nested').forEach((sub, subIndex) => walkH3(h1, sub, unitSlug, subIndex));
      return;
    }

    const h1Slug = `${bookSlug}-h1-${h1Index + 1}-${slugPart(h1.title, 20)}`;
    sortOrder += 1;
    pushRow(rows, {
      id: h1Slug,
      label: formatH1Label(h1),
      startPage: h1.start_page,
      endPage: h1.end_page,
      level: levelFromHeading(h1.level),
      sortOrder
    });

    h1Units.forEach((unit, unitIndex) => {
      const unitSlug = unit.unit_number
        ? `${bookSlug}-u${String(unit.unit_number).padStart(2, '0')}`
        : unit.chapter_number
          ? `${bookSlug}-ch${String(unit.chapter_number).padStart(2, '0')}`
          : `${h1Slug}-u${unitIndex + 1}-${slugPart(unit.units_range || unit.title, 16)}`;
      sortOrder += 1;
      pushRow(rows, {
        id: unitSlug,
        label: formatH2Label(unit),
        startPage: unit.start_page,
        endPage: unit.end_page,
        level: levelFromHeading(unit.level || 'H2'),
        sortOrder
      });
      listH3UnderUnit(unit, h1ChildMode).forEach((sub, subIndex) => walkH3(unit, sub, unitSlug, subIndex));
    });
  });

  const tableOfContents = remapAuxiliaryTocPages(rows);
  const maxEndPage = tableOfContents.reduce((max, row) => Math.max(max, Number(row.endPage || 0)), 0);
  return {
    bookTitle: String(source.book_title || '').trim(),
    suggestedTotalPages: maxEndPage || null,
    tableOfContents
  };
}

function normalizeTitleKey(title) {
  return String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findBookByTitle(books, title) {
  const key = normalizeTitleKey(title);
  if (!key) return null;
  return (Array.isArray(books) ? books : []).find((book) => normalizeTitleKey(book.title) === key)
    || (Array.isArray(books) ? books : []).find((book) => normalizeTitleKey(book.title).includes(key))
    || (Array.isArray(books) ? books : []).find((book) => key.includes(normalizeTitleKey(book.title)))
    || null;
}

module.exports = {
  convertGeminiBookTocSource,
  findBookByTitle,
  normalizeTitleKey,
  parseBookPage,
  parseRomanNumeral,
  parsePrefixedBookPage
};
