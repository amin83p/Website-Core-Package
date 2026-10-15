(function (global) {
  'use strict';

  function expandTocEntryPageNumbers(tocRow) {
    const start = Number(tocRow?.startPage);
    if (!Number.isFinite(start) || start < 1) return [];
    let end = Number(tocRow?.endPage);
    if (!Number.isFinite(end) || end < start) end = start;
    const pages = [];
    for (let page = start; page <= end; page += 1) pages.push(page);
    return pages;
  }

  function getTocRowsByIds(tableOfContents, selectedIds) {
    const ids = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id).trim()).filter(Boolean));
    return (Array.isArray(tableOfContents) ? tableOfContents : []).filter((row) => ids.has(String(row?.id || '').trim()));
  }

  function sortTocRows(tableOfContents) {
    return (Array.isArray(tableOfContents) ? tableOfContents : []).slice().sort((a, b) => {
      const orderA = Number(a?.sortOrder || 0);
      const orderB = Number(b?.sortOrder || 0);
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.label || '').localeCompare(String(b?.label || ''));
    });
  }

  function buildTocIndex(tableOfContents) {
    const byId = new Map();
    sortTocRows(tableOfContents).forEach((row) => {
      const id = String(row?.id || '').trim();
      if (id) byId.set(id, row);
    });
    return byId;
  }

  function resolveH1EntryId(tableOfContents, entryId) {
    const id = String(entryId || '').trim();
    if (!id) return '';
    const rows = sortTocRows(tableOfContents);
    const byId = buildTocIndex(tableOfContents);
    const entry = byId.get(id);
    if (!entry) return '';

    const level = Math.min(6, Math.max(1, Number(entry.level) || 1));
    if (level === 1) return id;

    let cursor = entry;
    const seen = new Set();
    while (cursor && !seen.has(String(cursor.id || ''))) {
      seen.add(String(cursor.id || ''));
      const parentId = String(cursor.parentId || '').trim();
      if (parentId) {
        const parent = byId.get(parentId);
        if (parent) {
          const parentLevel = Math.min(6, Math.max(1, Number(parent.level) || 1));
          if (parentLevel === 1) return String(parent.id || '').trim();
          cursor = parent;
          continue;
        }
      }
      break;
    }

    const idx = rows.findIndex((row) => String(row?.id || '').trim() === id);
    if (idx < 0) return '';
    for (let i = idx; i >= 0; i -= 1) {
      const row = rows[i];
      const rowLevel = Math.min(6, Math.max(1, Number(row?.level) || 1));
      if (rowLevel === 1) return String(row?.id || '').trim();
    }
    return '';
  }

  function normalizeTocEntryIdsToH1(tableOfContents, ids) {
    const out = [];
    const seen = new Set();
    (Array.isArray(ids) ? ids : []).forEach((rawId) => {
      const h1Id = resolveH1EntryId(tableOfContents, rawId);
      if (!h1Id || seen.has(h1Id)) return;
      seen.add(h1Id);
      out.push(h1Id);
    });
    return out;
  }

  function formatTocPageRange(startPage, endPage) {
    const start = Number(startPage);
    if (!Number.isFinite(start) || start < 1) return '—';
    let end = Number(endPage);
    if (!Number.isFinite(end) || end < start) end = start;
    if (end === start) return String(start);
    return `${start}–${end}`;
  }

  function formatTocPagesLabel(startPage, endPage) {
    const range = formatTocPageRange(startPage, endPage);
    if (range === '—') return range;
    return range.includes('–') ? `pp. ${range}` : `p. ${range}`;
  }

  function formatPageNumbersDisplay(pageNumbers) {
    const pages = (Array.isArray(pageNumbers) ? pageNumbers : [])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n >= 1)
      .sort((a, b) => a - b);
    if (!pages.length) return '';
    if (pages.length === 1) return String(pages[0]);
    const runs = [];
    let runStart = pages[0];
    let runEnd = pages[0];
    for (let i = 1; i < pages.length; i += 1) {
      if (pages[i] === runEnd + 1) runEnd = pages[i];
      else {
        runs.push(runStart === runEnd ? String(runStart) : `${runStart}–${runEnd}`);
        runStart = pages[i];
        runEnd = pages[i];
      }
    }
    runs.push(runStart === runEnd ? String(runStart) : `${runStart}–${runEnd}`);
    return runs.join(', ');
  }

  function buildSelectableTocTableHtml(tableOfContents, selectedH1Ids, options = {}) {
    const escapeHtml = options.escapeHtml || ((v) => String(v || ''));
    const rows = sortTocRows(tableOfContents);
    if (!rows.length) {
      return '<div class="text-muted small">This book has no table of contents.</div>';
    }
    const selected = new Set(normalizeTocEntryIdsToH1(tableOfContents, selectedH1Ids));
    const h1Rows = rows.filter((entry) => Math.min(6, Math.max(1, Number(entry?.level) || 1)) === 1);

    const chaptersHtml = h1Rows.map((h1Entry) => {
      const entryId = String(h1Entry?.id || '').trim();
      const label = escapeHtml(h1Entry?.label || entryId || '—');
      const isSelected = selected.has(entryId);
      const pageLabel = escapeHtml(formatTocPagesLabel(h1Entry.startPage, h1Entry.endPage));
      const childRows = rows.filter((entry) => {
        const level = Math.min(6, Math.max(1, Number(entry?.level) || 1));
        if (level <= 1) return false;
        return resolveH1EntryId(tableOfContents, String(entry?.id || '').trim()) === entryId;
      });
      const hasChildren = childRows.length > 0;
      const chapterClasses = [
        'book-coverage-toc-chapter',
        isSelected ? 'book-coverage-toc-chapter--selected' : '',
        hasChildren ? 'book-coverage-toc-chapter--has-children' : ''
      ].filter(Boolean).join(' ');

      const chevron = hasChildren
        ? (
          '<button type="button" class="book-coverage-toc-h1-chevron js-bc-toc-section-toggle" ' +
          'data-section-id="' + escapeHtml(entryId) + '" aria-expanded="false" aria-label="Show subheadings" tabindex="-1">' +
          '<i class="bi bi-chevron-right" aria-hidden="true"></i></button>'
        )
        : '<span class="book-coverage-toc-h1-chevron-spacer" aria-hidden="true"></span>';

      const childEntriesHtml = childRows.map((child) => {
        const childId = String(child?.id || '').trim();
        const childLevel = Math.min(6, Math.max(1, Number(child?.level) || 1));
        const childLabel = escapeHtml(child?.label || childId || '—');
        const childPages = escapeHtml(formatTocPagesLabel(child.startPage, child.endPage));
        const subDepth = Math.max(0, childLevel - 2);
        return (
          '<div class="book-coverage-toc-entry book-coverage-toc-row book-coverage-toc-row--child book-coverage-toc-section-child" ' +
          'style="--toc-sub-depth:' + subDepth + ';" data-entry-id="' + escapeHtml(childId) + '" data-h1-id="' + escapeHtml(entryId) + '" ' +
          'data-section-h1="' + escapeHtml(entryId) + '" data-level="' + childLevel + '" tabindex="0" role="button">' +
          '<span class="book-coverage-toc-entry-title">' + childLabel + '</span>' +
          '<span class="book-coverage-toc-entry-pages">' + childPages + '</span>' +
          '</div>'
        );
      }).join('');

      return (
        '<section class="' + chapterClasses + '" data-section-id="' + escapeHtml(entryId) + '" data-section-expanded="false"' +
        (hasChildren ? ' data-has-children="true"' : '') + '>' +
        '<header class="book-coverage-toc-chapter-head book-coverage-toc-row book-coverage-toc-row--h1" ' +
        'data-entry-id="' + escapeHtml(entryId) + '" data-h1-id="' + escapeHtml(entryId) + '" data-level="1" tabindex="0" role="button">' +
        '<span class="book-coverage-toc-chapter-check">' +
        '<input type="checkbox" class="form-check-input js-bc-h1-pick" value="' + escapeHtml(entryId) + '"' +
        (isSelected ? ' checked' : '') + ' aria-label="Select chapter">' +
        '</span>' +
        chevron +
        '<span class="book-coverage-toc-chapter-title">' + label + '</span>' +
        '<span class="book-coverage-toc-chapter-pages">' + pageLabel + '</span>' +
        '</header>' +
        (hasChildren
          ? '<div class="book-coverage-toc-chapter-body">' + childEntriesHtml + '</div>'
          : '') +
        '</section>'
      );
    }).join('');

    return (
      '<div class="book-coverage-toc-list-wrap">' +
      '<div class="book-coverage-toc-list-header">' +
      '<span class="book-coverage-toc-list-header-title">Chapters</span>' +
      '<span class="book-coverage-toc-list-header-pages">Pages</span>' +
      '</div>' +
      '<div class="book-coverage-toc-list">' + chaptersHtml + '</div>' +
      '</div>'
    );
  }

  function byIdSafe(rows, id) {
    const target = String(id || '').trim();
    return (Array.isArray(rows) ? rows : []).find((row) => String(row?.id || '').trim() === target) || null;
  }

  function findH1Checkbox(container, h1Id) {
    const target = String(h1Id || '').trim();
    if (!container || !target) return null;
    return Array.from(container.querySelectorAll('.js-bc-h1-pick')).find(
      (input) => String(input.value || '').trim() === target
    ) || null;
  }

  function collectSelectedH1Ids(container) {
    if (!container) return [];
    const ids = [];
    container.querySelectorAll('.js-bc-h1-pick:checked').forEach((input) => {
      const val = String(input.value || '').trim();
      if (val) ids.push(val);
    });
    return ids;
  }

  function syncRowSelectionStyles(container) {
    if (!container) return;
    container.querySelectorAll('.book-coverage-toc-row').forEach((row) => {
      const h1Id = String(row.dataset.h1Id || '').trim();
      const checkbox = row.querySelector('.js-bc-h1-pick');
      const h1Checkbox = h1Id ? findH1Checkbox(container, h1Id) : null;
      const childSelected = h1Checkbox ? h1Checkbox.checked : (checkbox ? checkbox.checked : false);
      row.classList.toggle('book-coverage-toc-row--selected', childSelected);
    });
    container.querySelectorAll('.book-coverage-toc-chapter').forEach((chapter) => {
      const h1Id = String(chapter.dataset.sectionId || '').trim();
      const h1Checkbox = h1Id ? findH1Checkbox(container, h1Id) : null;
      chapter.classList.toggle('book-coverage-toc-chapter--selected', Boolean(h1Checkbox?.checked));
    });
  }

  function findH1SectionRow(container, h1Id) {
    const target = String(h1Id || '').trim();
    if (!container || !target) return null;
    return Array.from(container.querySelectorAll('.book-coverage-toc-chapter')).find(
      (chapter) => String(chapter.dataset.sectionId || '').trim() === target
    ) || null;
  }

  function setH1SectionExpanded(container, h1Id, expanded) {
    const sectionRow = findH1SectionRow(container, h1Id);
    if (!sectionRow || sectionRow.dataset.hasChildren !== 'true') return;
    const isExpanded = Boolean(expanded);
    sectionRow.dataset.sectionExpanded = isExpanded ? 'true' : 'false';
    sectionRow.classList.toggle('book-coverage-toc-chapter--expanded', isExpanded);
    const toggleBtn = sectionRow.querySelector('.js-bc-toc-section-toggle');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      toggleBtn.setAttribute('aria-label', isExpanded ? 'Hide subheadings' : 'Show subheadings');
    }
  }

  function toggleH1SectionExpanded(container, h1Id) {
    const sectionRow = findH1SectionRow(container, h1Id);
    if (!sectionRow) return false;
    const next = sectionRow.dataset.sectionExpanded !== 'true';
    setH1SectionExpanded(container, h1Id, next);
    return next;
  }

  function syncH1SectionWithSelection(container, h1Id) {
    const checkbox = findH1Checkbox(container, h1Id);
    const sectionRow = findH1SectionRow(container, h1Id);
    if (!sectionRow || !checkbox) return;
    setH1SectionExpanded(container, h1Id, checkbox.checked);
  }

  function bindSelectableTocTable(container, tableOfContents, options = {}) {
    if (!container) return;
    const onChange = typeof options.onChange === 'function' ? options.onChange : null;

    function emitChange() {
      syncRowSelectionStyles(container);
      if (onChange) onChange(collectSelectedH1Ids(container));
    }

    container.querySelectorAll('.js-bc-h1-pick').forEach((input) => {
      input.addEventListener('change', (event) => {
        event.stopPropagation();
        const h1Id = String(input.value || '').trim();
        syncH1SectionWithSelection(container, h1Id);
        emitChange();
      });
      input.addEventListener('click', (event) => event.stopPropagation());
    });

    container.querySelectorAll('.js-bc-toc-section-toggle').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const h1Id = String(btn.dataset.sectionId || '').trim();
        if (h1Id) toggleH1SectionExpanded(container, h1Id);
      });
    });

    container.querySelectorAll('.book-coverage-toc-row').forEach((row) => {
      const handler = (event) => {
        if (event.target.closest('.js-bc-h1-pick') || event.target.closest('.js-bc-toc-section-toggle')) return;
        const entryId = String(row.dataset.entryId || '').trim();
        const level = Number(row.dataset.level || 0);
        const h1Id = resolveH1EntryId(tableOfContents, entryId) || String(row.dataset.h1Id || '').trim();
        if (!h1Id) return;
        const checkbox = findH1Checkbox(container, h1Id);
        if (!checkbox) return;
        checkbox.checked = !checkbox.checked;
        if (level === 1) {
          syncH1SectionWithSelection(container, h1Id);
        } else {
          setH1SectionExpanded(container, h1Id, true);
        }
        emitChange();
      };
      row.addEventListener('click', handler);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handler(event);
        }
      });
    });

    emitChange();
  }

  function buildPageToggleGroupsHtml(tableOfContents, selectedUnitIds, selectedPageNumbers, options = {}) {
    const escapeHtml = options.escapeHtml || ((v) => String(v || ''));
    const readOnly = Boolean(options.readOnly);
    const selectedPages = new Set(
      (Array.isArray(selectedPageNumbers) ? selectedPageNumbers : []).map((n) => Number(n)).filter((n) => Number.isFinite(n))
    );
    const h1Ids = normalizeTocEntryIdsToH1(tableOfContents, selectedUnitIds);
    const units = getTocRowsByIds(tableOfContents, h1Ids);
    if (!units.length) {
      return '<div class="text-muted small">Select at least one chapter (H1) to choose pages.</div>';
    }
    return units.map((unit) => {
      const pages = expandTocEntryPageNumbers(unit);
      const label = escapeHtml(unit.label || unit.id || 'Unit');
      const pageButtons = pages.map((page) => {
        const active = selectedPages.has(page) ? ' active' : '';
        const disabled = readOnly ? ' disabled' : '';
        return (
          '<button type="button" class="btn btn-sm btn-outline-secondary session-bc-page-toggle' + active + '" data-page="' + page + '"' + disabled + '>' + page + '</button>'
        );
      }).join('');
      return (
        '<div class="session-bc-page-unit mb-3" data-unit-id="' + escapeHtml(unit.id || '') + '">' +
        '<div class="fw-semibold small mb-2">' + label + '</div>' +
        '<div class="d-flex flex-wrap gap-1 session-bc-page-toggle-row">' + pageButtons + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function bindPageToggleGroups(container, onChange) {
    if (!container) return;
    container.querySelectorAll('.session-bc-page-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        btn.classList.toggle('active');
        if (typeof onChange === 'function') onChange(collectSelectedPageNumbers(container));
      });
    });
  }

  function collectSelectedPageNumbers(container) {
    if (!container) return [];
    const pages = [];
    container.querySelectorAll('.session-bc-page-toggle.active').forEach((btn) => {
      const page = Number(btn.dataset.page);
      if (Number.isFinite(page) && page >= 1) pages.push(page);
    });
    return pages.sort((a, b) => a - b);
  }

  global.BookCoveringTocUtils = {
    expandTocEntryPageNumbers,
    getTocRowsByIds,
    sortTocRows,
    resolveH1EntryId,
    normalizeTocEntryIdsToH1,
    formatTocPageRange,
    formatPageNumbersDisplay,
    buildSelectableTocTableHtml,
    bindSelectableTocTable,
    collectSelectedH1Ids,
    buildPageToggleGroupsHtml,
    bindPageToggleGroups,
    collectSelectedPageNumbers
  };
})(window);
