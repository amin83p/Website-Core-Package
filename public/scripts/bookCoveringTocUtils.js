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

  function buildPageToggleGroupsHtml(tableOfContents, selectedUnitIds, selectedPageNumbers, options = {}) {
    const escapeHtml = options.escapeHtml || ((v) => String(v || ''));
    const readOnly = Boolean(options.readOnly);
    const selectedPages = new Set(
      (Array.isArray(selectedPageNumbers) ? selectedPageNumbers : []).map((n) => Number(n)).filter((n) => Number.isFinite(n))
    );
    const units = getTocRowsByIds(tableOfContents, selectedUnitIds);
    if (!units.length) {
      return '<div class="text-muted small">Select at least one unit to choose pages.</div>';
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
    formatPageNumbersDisplay,
    buildPageToggleGroupsHtml,
    bindPageToggleGroups,
    collectSelectedPageNumbers
  };
})(window);
