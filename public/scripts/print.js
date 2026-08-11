// public/scripts/print.js

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
    if (window.PrintDocumentBuilder?.formatPrintedAtShort) {
        return window.PrintDocumentBuilder.formatPrintedAtShort(dateObj);
    }
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

function resolveBrandLogoUrl() {
    const logoRef = document.getElementById('printBrandLogoRef');
    const refUrl = String(logoRef?.dataset?.url || logoRef?.getAttribute('data-url') || '').trim();
    if (refUrl) return refUrl;
    try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-brand-logo-url').trim();
        const match = raw.match(/url\(["']?([^"')]+)["']?\)/i);
        if (match) return String(match[1] || '').trim();
    } catch (_) {
        // ignore
    }
    return '/uploads/GLOBAL/logo/Logo1.png';
}

function resolvePagePrintSummary() {
    const host = document.querySelector('[data-print-summary]');
    if (!host) return '';
    return String(host.dataset.printSummary || host.getAttribute('data-print-summary') || '').trim();
}

function resolvePagePrintLegendHtml() {
    const host = document.querySelector('[data-print-legend]');
    if (!host) return '';
    return String(host.innerHTML || '').trim();
}

function buildAutoFilterSummary(settings = {}) {
    const manual = String(settings.filterSummary || '').trim();
    if (manual) return manual;
    if (window.PrintDocumentBuilder?.buildFilterSummaryFromLocation) {
        return window.PrintDocumentBuilder.buildFilterSummaryFromLocation(location.search);
    }
    return '';
}

function buildPrintPlaceholderHtml() {
    return '<!doctype html><html><head><meta charset="utf-8"><title>Preparing Print</title></head><body style="font:14px Segoe UI,Arial,sans-serif;padding:24px">Preparing print preview…</body></html>';
}

/**
 * Prepares and opens a new window containing only the table data for printing.
 * @param {string} tableId The ID of the table element to print.
 * @param {string} titleSelector The selector for the main page title CONTAINER (e.g., '.page-heading').
 * @param {object} options Optional print settings.
 */
async function handlePrintTable(tableId, titleSelector, options = {}) {
    const tableElement = document.getElementById(tableId);
    const titleContainer = document.querySelector(titleSelector);
    const settings = options && typeof options === 'object' ? options : {};
    const builder = window.PrintDocumentBuilder;

    if (!tableElement) {
        console.error(`Table element with ID '${tableId}' not found.`);
        return;
    }
    if (!builder) {
        console.error('PrintDocumentBuilder is not loaded.');
        return;
    }

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

    const printWindow = window.open('', '_blank', 'height=720,width=1100');
    if (!printWindow) {
        console.error('Allow pop-ups for this site to open the print preview.');
        return;
    }

    try {
        printWindow.opener = null;
    } catch (_) {
        // ignore
    }

    printWindow.document.open();
    printWindow.document.write(buildPrintPlaceholderHtml());
    printWindow.document.close();

    try {
        const byLabelShort = (() => {
            const requestedByLabel = String(settings.requestedByLabel || settings.requestingUserLabel || '').trim();
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
    } catch (_) {
        // ignore
    }

    const css = await builder.ensurePrintTableCssLoaded();
    const tableHtml = builder.buildTableHtmlFromElement(tableElement);
    const filterSummary = buildAutoFilterSummary(settings);
    const pageSummary = resolvePagePrintSummary();
    const summary = [pageSummary, filterSummary].filter(Boolean).join(' · ');

    const printContent = builder.buildTablePrintDocument({
        title,
        printTitleHtml,
        orgName: String(settings.orgName || '').trim(),
        logoUrl: String(settings.logoUrl || '').trim() || (window.AppPrintManager?.resolveBrandLogoUrl ? window.AppPrintManager.resolveBrandLogoUrl() : resolveBrandLogoUrl()),
        includeOrg: settings.includeOrg !== false,
        includeHeaderNote: settings.includeHeaderNote === true,
        headerNote: String(settings.headerNote || '').trim(),
        summary,
        legendHtml: resolvePagePrintLegendHtml(),
        requestedByLabel: String(settings.requestedByLabel || settings.requestingUserLabel || '').trim(),
        tableHtml,
        orientation: settings.orientation,
        density: settings.density,
        css,
        sourcePath: location.pathname,
        mode: 'table',
        printedAt: new Date()
    });

    printWindow.document.open();
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();

    window.setTimeout(() => {
        try {
            printWindow.print();
        } catch (_) {
            // User can still print from the preview buttons.
        }
    }, 250);
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

document.addEventListener('DOMContentLoaded', () => {
    if (window.PrintDocumentBuilder?.ensurePrintTableCssLoaded) {
        void window.PrintDocumentBuilder.ensurePrintTableCssLoaded();
    }

    const printButton = document.getElementById('printTableBtn');
    if (!printButton) return;

    if (!window.AppPrintManager?.openSettings) {
        printButton.addEventListener('click', () => {
            void handlePrintTable('first-table', '.page-heading');
        });
        return;
    }

    printButton.addEventListener('click', () => {
        window.AppPrintManager.openSettings({
            mode: 'table',
            onConfirm: (settings) => {
                void handlePrintTable('first-table', '.page-heading', settings);
            }
        });
    });
});
