// public/scripts/print.js

/**
 * Prepares and opens a new window containing only the table data for printing.
 * It respects the current visibility and order of columns set by the user (if any).
 * @param {string} tableId The ID of the table element to print.
 * @param {string} titleSelector The selector for the main page title CONTAINER (e.g., '.page-heading').
 * @param {object} options Optional print settings.
 */
function handlePrintTable(tableId, titleSelector, options = {}) {
    const tableElement = document.getElementById(tableId);
    const titleContainer = document.querySelector(titleSelector);
    const settings = options && typeof options === 'object' ? options : {};

    if (!tableElement) {
        console.error(`Table element with ID '${tableId}' not found.`);
        return;
    }

    // 1) Build title HTML from the title container (preserve heading tags)
    let title = 'Data Report';
    let printTitleHtml = '';

    if (titleContainer) {
        const headings = titleContainer.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings.length > 0) {
            title = headings[0].textContent.trim() || title;
            headings.forEach((h) => { printTitleHtml += h.outerHTML; });
        } else {
            printTitleHtml = titleContainer.innerHTML;
        }
    } else {
        printTitleHtml = `<h1>${escapeHtml(title)}</h1>`;
    }

    // 2) Prepare the print window + metadata
    const printWindow = window.open('', '', 'height=600,width=900');

    const printedAt = new Date();
    const printedAtLabel = formatPrintedAtShort(printedAt);

    const includeOrg = settings.includeOrg !== false;
    const orgName = String(settings.orgName || '').trim();

    const includeHeaderNote = settings.includeHeaderNote === true;
    const headerNote = String(settings.headerNote || '').trim();

    const orientation = String(settings.orientation || 'landscape').trim().toLowerCase() === 'portrait'
      ? 'portrait'
      : 'landscape';
    const density = String(settings.density || 'compact').trim().toLowerCase() === 'normal'
      ? 'normal'
      : 'compact';

    const requestedByLabel = String(settings.requestingUserLabel || '').trim();
    const requestedByHtml = requestedByLabel ? escapeHtml(requestedByLabel) : '';

    // Best-effort: browsers that print the window URL (and would show "about:blank")
    // may show a nicer URL after replaceState (still same-origin, no navigation).
    try {
        const byLabelShort = (() => {
            const id = extractTrailingParensId(requestedByLabel);
            if (id) return id;
            if (requestedByLabel && requestedByLabel.length <= 60) return requestedByLabel;
            return '';
        })();
        const basePath = String(location && location.pathname ? location.pathname : '/').trim() || '/';
        const qsParts = ['print=1'];
        if (byLabelShort) qsParts.push(`by=${encodeURIComponent(byLabelShort)}`);
        if (title) qsParts.push(`title=${encodeURIComponent(String(title).slice(0, 80))}`);
        printWindow.history.replaceState({}, '', `${basePath}?${qsParts.join('&')}`);
    } catch {}

    const pageCss = orientation === 'portrait'
      ? '@page { size: letter portrait; margin: 10mm; }'
      : '@page { size: letter landscape; margin: 10mm; }';

    const densityCss = density === 'normal'
      ? 'body { font-size: 12px; } th, td { padding: 7px; }'
      : 'body { font-size: 11px; } th, td { padding: 5px; }';

    const orgHtml = (includeOrg && orgName)
      ? `<div class="print-org">${escapeHtml(orgName)}</div>`
      : '';

    const noteHtml = (includeHeaderNote && headerNote)
      ? `<div class="print-note">${escapeHtml(headerNote)}</div>`
      : '';

    let printContent = `
        <html>
        <head>
            <title>${escapeHtml(title || 'Data Report')}</title>
            <style>
                ${pageCss}
                body { font-family: Arial, sans-serif; margin: 10px; }
                ${densityCss}
                h1 { margin: 0 0 8px 0; font-size: 1.4em; }
                h2 { margin: 0 0 6px 0; font-size: 1.25em; }
                h3 { margin: 0 0 6px 0; font-size: 1.1em; }

                .print-fixed-header { position: fixed; left: 0; right: 0; top: 0; padding: 10px 10px 6px 10px; background: #fff; }
                .print-fixed-footer { position: fixed; left: 0; right: 0; bottom: 0; padding: 6px 10px 10px 10px; background: #fff; }
                .print-fixed-header, .print-fixed-footer { color: #111; }

                .print-header-top, .print-footer-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
                .print-header-left, .print-footer-left { text-align: left; font-size: 0.95em; color: #222; }
                .print-header-right, .print-footer-right { text-align: right; font-size: 0.95em; color: #222; white-space: nowrap; }

                .print-org { font-weight: 700; font-size: 1.4em; text-align: center; margin: 6px 0 6px 0; }
                .print-title { text-align: left; margin: 0 0 4px 0; }
                .print-title h1, .print-title h2, .print-title h3, .print-title h4, .print-title h5, .print-title h6 { text-align: left; }
                .print-note { text-align: left; white-space: pre-wrap; margin: 0 0 4px 0; }

                .print-content { padding-top: 110px; padding-bottom: 50px; }

                table { width: 100%; border-collapse: collapse; margin-bottom: 16px; table-layout: fixed; }
                th, td { border: 1px solid #ccc; text-align: left; vertical-align: top; white-space: pre-wrap; word-break: break-word; }
                th { background-color: #f2f2f2; }

                @media print {
                    body { margin: 0; }
                    table { page-break-inside: auto; }
                    tr { page-break-inside: avoid; page-break-after: auto; }
                    thead { display: table-header-group; }
                }
            </style>
        </head>
        <body>
            <div class="print-fixed-header">
              <div class="print-header-top">
                <div class="print-header-left">Printed: ${escapeHtml(printedAtLabel)}</div>
                <div class="print-header-right"></div>
              </div>
              ${orgHtml}
              <div class="print-title">${printTitleHtml}</div>
              ${noteHtml}
            </div>
            <div class="print-fixed-footer">
              <div class="print-footer-row">
                <div class="print-footer-left">${requestedByHtml}</div>
                <div class="print-footer-right"></div>
              </div>
            </div>
            <div class="print-content">
            <table>
                <thead>
                    <tr>
    `;

    // 3) Header: visible columns, skip Actions
    const headerCells = Array.from(tableElement.querySelectorAll('thead th'));
    const visibleColumnIndexes = [];
    const columnMeta = new Map();

    headerCells.forEach((th, index) => {
        const label = th.textContent.trim().replace(/[\u25B2\u25BC]/g, '').trim();
        const isActionsColumn = label.toLowerCase() === 'actions' || th.classList.contains('table-actions');
        const isHidden = th.style.display === 'none' || th.classList.contains('d-none');
        if (isHidden || isActionsColumn) return;

        const width = String(th.style.width || '').trim();
        let align = 'left';
        if (th.classList.contains('text-end')) align = 'right';
        if (th.classList.contains('text-center')) align = 'center';

        columnMeta.set(index, { width, align, label });
        visibleColumnIndexes.push(index);

        const style = `${width ? `width:${escapeHtml(width)};` : ''}${align ? `text-align:${align};` : ''}`;
        printContent += `<th style="${style}">${escapeHtml(label)}</th>`;
    });

    printContent += `
                    </tr>
                </thead>
                <tbody>
    `;

    // 4) Body rows
    const bodyRows = Array.from(tableElement.querySelectorAll('tbody tr'));
    bodyRows.forEach((row) => {
        if (row.style.display === 'none') return;
        printContent += '<tr>';
        const bodyCells = Array.from(row.querySelectorAll('td'));
        visibleColumnIndexes.forEach((index) => {
            const cell = bodyCells[index];
            if (!cell) return;
            const meta = columnMeta.get(index) || {};
            const style = `${meta.align ? `text-align:${meta.align};` : ''}`;
            // Preserve multi-line cell text (e.g. code + name blocks)
            printContent += `<td style="${style}">${escapeHtml(cell.innerText.trim())}</td>`;
        });
        printContent += '</tr>';
    });

    printContent += `
                </tbody>
            </table>
            </div>
        </body>
        </html>
    `;

    // 5) Write + print
    printWindow.document.write(printContent);
    printWindow.document.close();

    setTimeout(() => {
        try {
            const headerEl = printWindow.document.querySelector('.print-fixed-header');
            const footerEl = printWindow.document.querySelector('.print-fixed-footer');
            const contentEl = printWindow.document.querySelector('.print-content');
            if (contentEl) {
                if (headerEl) contentEl.style.paddingTop = `${Math.ceil(headerEl.getBoundingClientRect().height) + 12}px`;
                if (footerEl) contentEl.style.paddingBottom = `${Math.ceil(footerEl.getBoundingClientRect().height) + 12}px`;
            }
        } catch {}

        printWindow.print();
        printWindow.close();
    }, 300);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[m]);
}

function extractTrailingParensId(label) {
    const m = String(label || '').trim().match(/\(([^)]+)\)\s*$/);
    return m ? String(m[1] || '').trim() : '';
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

function resolveActiveOrgName() {
    const fromDom = document.getElementById('activeOrgNameRef')?.dataset?.name;
    if (fromDom) return String(fromDom).trim();

    const user = window.__GENERIC_PICKER_USER__ || null;
    const activeOrgId = String(user?.activeOrgId || user?.primaryOrgId || '').trim();
    if (!activeOrgId || !Array.isArray(user?.allowedOrgs)) return '';
    const org = user.allowedOrgs.find((o) => String(o?.orgId || '') === activeOrgId) || null;
    return String(org?.name || org?.orgName || org?.organizationName || '').trim();
}

function resolveRequestingUserLabel() {
    const nameFromDom = document.getElementById('requestingUserNameRef')?.dataset?.name;
    const userIdFromDom = document.getElementById('user-id')?.dataset?.id;
    const rawName = String(nameFromDom || '').trim();
    const rawId = String(userIdFromDom || '').trim();
    if (rawName && rawId) return `${rawName} (${rawId})`;
    if (rawName) return rawName;

    const user = window.__GENERIC_PICKER_USER__ || null;
    const fallbackId = String(user?.id || rawId || '').trim();
    const identityName = String(user?.identity?.displayName || '').trim();
    const objectName = (user?.name && typeof user.name === 'object')
        ? `${user.name.first || ''} ${user.name.last || ''}`.trim()
        : '';
    const stringName = String((typeof user?.name === 'string' ? user.name : '') || '').trim();
    const fallbackName = identityName || objectName || stringName || String(user?.username || user?.email || '').trim();
    if (fallbackName && fallbackId) return `${fallbackName} (${fallbackId})`;
    return fallbackName || fallbackId || '';
}

function isPrintAdminUser() {
    const raw = document.getElementById('printAdminRef')?.dataset?.isAdmin;
    if (raw) return String(raw).trim().toLowerCase() === 'true';
    const user = window.__GENERIC_PICKER_USER__ || null;
    const role = String(user?.role || '').trim().toLowerCase();
    return Boolean(user?.isSystemAdmin || user?.isVirtualSuperAdmin || role === 'admin');
}

function loadPrintSettings() {
    const key = `tablePrintSettings_v1:${location.pathname}`;
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
}

function savePrintSettings(settings) {
    const key = `tablePrintSettings_v1:${location.pathname}`;
    try { localStorage.setItem(key, JSON.stringify(settings || {})); } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
    const printButton = document.getElementById('printTableBtn');
    if (!printButton) return;

    const modalEl = document.getElementById('printSettingsModal');
    const applyBtn = document.getElementById('printSettingsApplyBtn');

    if (!modalEl || !applyBtn || !window.bootstrap?.Modal) {
        printButton.addEventListener('click', () => handlePrintTable('first-table', '.page-heading'));
        return;
    }

    const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);

    function populateModal() {
        const stored = loadPrintSettings();
        const isAdmin = isPrintAdminUser();
        const orgName = resolveActiveOrgName() || '';

        document.getElementById('printSettingOrgName').value = isAdmin ? (stored.orgName || orgName) : orgName;
        document.getElementById('printSettingIncludeOrg').checked = isAdmin ? (stored.includeOrg !== false) : true;
        document.getElementById('printSettingHeaderNote').value = stored.headerNote || '';
        document.getElementById('printSettingIncludeHeaderNote').checked = isAdmin ? (stored.includeHeaderNote === true) : true;
        document.getElementById('printSettingOrientation').value = isAdmin && stored.orientation === 'portrait' ? 'portrait' : 'landscape';
        document.getElementById('printSettingDensity').value = isAdmin && stored.density === 'normal' ? 'normal' : 'compact';
    }

    printButton.addEventListener('click', () => {
        populateModal();
        modal.show();
    });

    applyBtn.addEventListener('click', () => {
        const isAdmin = isPrintAdminUser();
        const nextSettings = {
            includeOrg: isAdmin ? Boolean(document.getElementById('printSettingIncludeOrg').checked) : true,
            orgName: isAdmin ? String(document.getElementById('printSettingOrgName').value || '').trim() : (resolveActiveOrgName() || ''),
            includeHeaderNote: isAdmin ? Boolean(document.getElementById('printSettingIncludeHeaderNote').checked) : true,
            headerNote: String(document.getElementById('printSettingHeaderNote').value || ''),
            orientation: isAdmin ? String(document.getElementById('printSettingOrientation').value || 'landscape') : 'landscape',
            density: isAdmin ? String(document.getElementById('printSettingDensity').value || 'compact') : 'compact',
            requestingUserLabel: resolveRequestingUserLabel()
        };

        const persisted = isAdmin
          ? nextSettings
          : { headerNote: nextSettings.headerNote, includeHeaderNote: true };
        savePrintSettings(persisted);
        modal.hide();
        handlePrintTable('first-table', '.page-heading', nextSettings);
    });
});

