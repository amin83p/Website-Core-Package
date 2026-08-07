// public/scripts/printDocumentBuilder.js
(function initPrintDocumentBuilder(global) {
  'use strict';

  const FALLBACK_PRINT_TABLE_CSS = `
    body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11px; color: #172033; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #cfd7e3; padding: 5px 6px; vertical-align: top; }
    th { background: #f4f7fb; }
  `;

  let cachedPrintTableCss = '';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function formatPrintedAtShort(dateObj) {
    const dt = dateObj instanceof Date ? dateObj : new Date(dateObj);
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(dt);
    } catch {
      return dt.toLocaleString();
    }
  }

  function buildPageCss(orientation = 'landscape') {
    return orientation === 'portrait'
      ? '@page { size: letter portrait; margin: 10mm; }'
      : '@page { size: letter landscape; margin: 10mm; }';
  }

  function normalizeOrientation(value) {
    return String(value || 'landscape').trim().toLowerCase() === 'portrait'
      ? 'portrait'
      : 'landscape';
  }

  function normalizeDensity(value) {
    return String(value || 'compact').trim().toLowerCase() === 'normal'
      ? 'normal'
      : 'compact';
  }

  function isActionsHeader(th) {
    if (!th) return false;
    const label = String(th.textContent || '').trim().replace(/[\u25B2\u25BC]/g, '').trim().toLowerCase();
    return label === 'actions' || th.classList.contains('table-actions');
  }

  function isHiddenColumn(th) {
    if (!th) return true;
    return th.style.display === 'none' || th.classList.contains('d-none');
  }

  function resolveColumnAlign(th) {
    if (th.classList.contains('text-end')) return 'right';
    if (th.classList.contains('text-center')) return 'center';
    return 'left';
  }

  function stripInteractiveMarkup(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll(
      'button, .btn, .dropdown, .dropdown-menu, .table-actions, .row-actions-wrap, .rolling-row-actions-wrap, .rolling-row-actions-menu, input, select, textarea'
    ).forEach((node) => node.remove());
    clone.querySelectorAll('.sort-icon').forEach((node) => node.remove());
    return clone.innerHTML.trim();
  }

  function extractPrintableCellHtml(cell) {
    if (!cell) return '';
    const explicit = String(cell.dataset?.printValue || '').trim();
    if (explicit) return escapeHtml(explicit).replace(/\n/g, '<br>');
    const cleaned = stripInteractiveMarkup(cell);
    if (cleaned) return cleaned;
    return escapeHtml(String(cell.innerText || '').trim()).replace(/\n/g, '<br>');
  }

  function buildTableHtmlFromElement(tableElement) {
    if (!tableElement) return '<table class="print-table"><tbody><tr><td>No table data.</td></tr></tbody></table>';

    const headerCells = Array.from(tableElement.querySelectorAll('thead th'));
    const visibleColumnIndexes = [];
    const columnMeta = new Map();

    headerCells.forEach((th, index) => {
      if (isHiddenColumn(th) || isActionsHeader(th)) return;
      const label = String(th.textContent || '').trim().replace(/[\u25B2\u25BC]/g, '').trim();
      const width = String(th.style.width || '').trim();
      const align = resolveColumnAlign(th);
      columnMeta.set(index, { width, align, label });
      visibleColumnIndexes.push(index);
    });

    let html = '<table class="print-table"><thead><tr>';
    visibleColumnIndexes.forEach((index) => {
      const meta = columnMeta.get(index) || {};
      const style = `${meta.width ? `width:${escapeHtml(meta.width)};` : ''}${meta.align ? `text-align:${meta.align};` : ''}`;
      html += `<th style="${style}">${escapeHtml(meta.label || '')}</th>`;
    });
    html += '</tr></thead><tbody>';

    const bodyRows = Array.from(tableElement.querySelectorAll('tbody tr'));
    if (!bodyRows.length) {
      html += `<tr><td colspan="${Math.max(visibleColumnIndexes.length, 1)}" class="text-center">No rows to print.</td></tr>`;
    } else {
      bodyRows.forEach((row) => {
        if (row.style.display === 'none') return;
        html += '<tr>';
        const bodyCells = Array.from(row.querySelectorAll('td'));
        visibleColumnIndexes.forEach((index) => {
          const cell = bodyCells[index];
          const meta = columnMeta.get(index) || {};
          const style = meta.align ? `text-align:${meta.align};` : '';
          html += `<td style="${style}">${extractPrintableCellHtml(cell)}</td>`;
        });
        html += '</tr>';
      });
    }

    html += '</tbody></table>';
    return html;
  }

  function buildFilterSummaryFromLocation(search = '') {
    try {
      const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
      const parts = [];
      const mapping = [
        ['enrollmentGroup', 'Enrollment group'],
        ['periodStatus', 'Period status'],
        ['funderId', 'Funder'],
        ['targetType', 'Target type'],
        ['status', 'Status'],
        ['assignment', 'Assignment'],
        ['severity', 'Severity'],
        ['sourceType', 'Source']
      ];
      mapping.forEach(([key, label]) => {
        const value = String(params.get(key) || '').trim();
        if (value) parts.push(`${label}: ${value}`);
      });
      const q = String(params.get('q') || '').trim();
      if (q && q !== 'aaa') parts.push(`Search: ${q}`);
      return parts.join(' · ');
    } catch {
      return '';
    }
  }

  function buildTablePrintDocument(options = {}) {
    const title = String(options.title || 'Data Report').trim() || 'Data Report';
    const printTitleHtml = String(options.printTitleHtml || '').trim()
      || `<h1>${escapeHtml(title)}</h1>`;
    const orgName = String(options.orgName || '').trim();
    const logoUrl = String(options.logoUrl || '').trim();
    const includeOrg = options.includeOrg !== false;
    const includeHeaderNote = options.includeHeaderNote === true;
    const headerNote = String(options.headerNote || '').trim();
    const summary = String(options.summary || '').trim();
    const legendHtml = String(options.legendHtml || '').trim();
    const requestedByLabel = String(options.requestedByLabel || '').trim();
    const tableHtml = String(options.tableHtml || '').trim();
    const orientation = normalizeOrientation(options.orientation);
    const density = normalizeDensity(options.density);
    const printedAtLabel = formatPrintedAtShort(options.printedAt || new Date());
    const css = String(options.css || cachedPrintTableCss || FALLBACK_PRINT_TABLE_CSS).trim();

    const logoHtml = logoUrl
      ? `<img class="print-logo" src="${escapeHtml(logoUrl)}" alt="Organization logo">`
      : '';

    const orgHtml = includeOrg && orgName
      ? `<div class="organization-name">${escapeHtml(orgName)}</div>`
      : '';

    const noteHtml = includeHeaderNote && headerNote
      ? `<div class="print-note">${escapeHtml(headerNote)}</div>`
      : '';

    const summaryHtml = summary
      ? `<div class="print-summary">${escapeHtml(summary)}</div>`
      : '';

    const legendBlock = legendHtml
      ? `<div class="print-legend">${legendHtml}</div>`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    ${buildPageCss(orientation)}
    ${css}
  </style>
</head>
<body class="print-density-${density}">
  <div class="print-sheet">
    <div class="screen-actions no-print">
      <button type="button" onclick="window.print()">Print</button>
      <button type="button" onclick="window.close()">Close</button>
    </div>
    <div class="identity-block">
      <div class="identity-copy">
        ${orgHtml}
        <div class="print-title">${printTitleHtml}</div>
        ${summaryHtml}
        <div class="document-meta">
          <span><strong>Printed:</strong> ${escapeHtml(printedAtLabel)}</span>
          ${requestedByLabel ? `<span><strong>Requested by:</strong> ${escapeHtml(requestedByLabel)}</span>` : ''}
        </div>
      </div>
      ${logoHtml}
    </div>
    ${noteHtml}
    <div class="print-content">
      ${tableHtml}
    </div>
    ${legendBlock}
    <div class="doc-footer">Generated from ${escapeHtml(String(options.sourcePath || '/'))}</div>
  </div>
</body>
</html>`;
  }

  async function ensurePrintTableCssLoaded() {
    if (cachedPrintTableCss) return cachedPrintTableCss;
    try {
      const response = await fetch('/styles/print-table.css', { cache: 'no-cache' });
      if (response.ok) {
        cachedPrintTableCss = await response.text();
        return cachedPrintTableCss;
      }
    } catch (_) {
      // Fall back to embedded minimal CSS when fetch is unavailable.
    }
    cachedPrintTableCss = FALLBACK_PRINT_TABLE_CSS;
    return cachedPrintTableCss;
  }

  function setPrintTableCss(cssText) {
    cachedPrintTableCss = String(cssText || '').trim();
  }

  const api = {
    escapeHtml,
    formatPrintedAtShort,
    buildPageCss,
    normalizeOrientation,
    normalizeDensity,
    isActionsHeader,
    extractPrintableCellHtml,
    buildTableHtmlFromElement,
    buildFilterSummaryFromLocation,
    buildTablePrintDocument,
    ensurePrintTableCssLoaded,
    setPrintTableCss,
    FALLBACK_PRINT_TABLE_CSS
  };

  global.PrintDocumentBuilder = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
