// public/scripts/appPrintManager.js
(function initAppPrintManager(global) {
  'use strict';

  const STORAGE_PREFIX = 'appPrintSettings_v1:';
  let pendingPrint = null;
  let modalInstance = null;

  function cleanString(value, max = 1000) {
    const text = String(value ?? '').replace(/\0/g, '').trim();
    return text.length > max ? text.slice(0, max) : text;
  }

  function escapeHtml(value) {
    return cleanString(value, 10000).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function normalizeOrientation(value) {
    return String(value || 'landscape').trim().toLowerCase() === 'portrait' ? 'portrait' : 'landscape';
  }

  function normalizeDensity(value) {
    return String(value || 'compact').trim().toLowerCase() === 'normal' ? 'normal' : 'compact';
  }

  function getElementValue(id) {
    return cleanString(global.document?.getElementById(id)?.value || '');
  }

  function setElementValue(id, value) {
    const el = global.document?.getElementById(id);
    if (el) el.value = value == null ? '' : String(value);
  }

  function getElementChecked(id) {
    return Boolean(global.document?.getElementById(id)?.checked);
  }

  function setElementChecked(id, checked) {
    const el = global.document?.getElementById(id);
    if (el) el.checked = Boolean(checked);
  }

  function resolveBrandLogoUrl() {
    const logoRef = global.document?.getElementById('printBrandLogoRef')
      || global.document?.getElementById('printModalBrandLogoRef');
    const refUrl = cleanString(logoRef?.dataset?.url || logoRef?.getAttribute('data-url') || '');
    if (refUrl) return refUrl;
    try {
      const raw = global.document
        ? getComputedStyle(global.document.documentElement).getPropertyValue('--app-brand-logo-url').trim()
        : '';
      const match = raw.match(/url\(["']?([^"')]+)["']?\)/i);
      if (match) return cleanString(match[1] || '');
    } catch (_) {
      // ignore
    }
    return '/uploads/GLOBAL/logo/Logo1.png';
  }

  function resolveActiveOrgName() {
    const fromDom = global.document?.getElementById('activeOrgNameRef')?.dataset?.name
      || global.document?.getElementById('printModalActiveOrgNameRef')?.dataset?.name;
    if (fromDom) return cleanString(fromDom);

    const user = global.__GENERIC_PICKER_USER__ || null;
    const activeOrgId = cleanString(user?.activeOrgId || user?.primaryOrgId || '');
    if (!activeOrgId || !Array.isArray(user?.allowedOrgs)) return '';
    const org = user.allowedOrgs.find((o) => String(o?.orgId || o?.id || '') === activeOrgId) || null;
    return cleanString(org?.name || org?.orgName || org?.organizationName || '');
  }

  function resolveRequestingUserLabel() {
    const nameFromDom = global.document?.getElementById('requestingUserNameRef')?.dataset?.name
      || global.document?.getElementById('printModalRequestingUserNameRef')?.dataset?.name;
    const userIdFromDom = global.document?.getElementById('user-id')?.dataset?.id;
    const rawName = cleanString(nameFromDom || '');
    const rawId = cleanString(userIdFromDom || '');
    if (rawName && rawId) return `${rawName} (${rawId})`;
    if (rawName) return rawName;

    const user = global.__GENERIC_PICKER_USER__ || null;
    const fallbackId = cleanString(user?.id || rawId || '');
    const identityName = cleanString(user?.identity?.displayName || '');
    const objectName = (user?.name && typeof user.name === 'object')
      ? cleanString(`${user.name.first || ''} ${user.name.last || ''}`)
      : '';
    const stringName = cleanString((typeof user?.name === 'string' ? user.name : '') || '');
    const fallbackName = identityName || objectName || stringName || cleanString(user?.username || user?.email || '');
    if (fallbackName && fallbackId) return `${fallbackName} (${fallbackId})`;
    return fallbackName || fallbackId || '';
  }

  function isPrintAdminUser() {
    const raw = global.document?.getElementById('printAdminRef')?.dataset?.isAdmin
      || global.document?.getElementById('printModalAdminRef')?.dataset?.isAdmin;
    if (raw) return String(raw).trim().toLowerCase() === 'true';
    const user = global.__GENERIC_PICKER_USER__ || null;
    const role = String(user?.role || '').trim().toLowerCase();
    return Boolean(user?.isSystemAdmin || user?.isVirtualSuperAdmin || role === 'admin');
  }

  function getStorageKey(mode = 'default', sourcePath = '') {
    const path = cleanString(sourcePath || global.location?.pathname || '/', 500) || '/';
    const safeMode = cleanString(mode || 'default', 80) || 'default';
    return `${STORAGE_PREFIX}${path}:${safeMode}`;
  }

  function loadSettings(mode = 'default', sourcePath = '') {
    try {
      return JSON.parse(global.localStorage?.getItem(getStorageKey(mode, sourcePath)) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function saveSettings(settings, mode = 'default', sourcePath = '') {
    try {
      global.localStorage?.setItem(getStorageKey(mode, sourcePath), JSON.stringify(settings || {}));
    } catch (_) {
      // ignore localStorage failures
    }
  }

  function normalizeSettings(raw = {}) {
    return {
      includeOrg: raw.includeOrg !== false,
      orgName: cleanString(raw.orgName || ''),
      includeHeaderNote: raw.includeHeaderNote === true,
      headerNote: cleanString(raw.headerNote || '', 3000),
      orientation: normalizeOrientation(raw.orientation),
      density: normalizeDensity(raw.density),
      requestedByLabel: cleanString(raw.requestedByLabel || resolveRequestingUserLabel(), 240),
      logoUrl: cleanString(raw.logoUrl || resolveBrandLogoUrl(), 1200)
    };
  }

  function buildDefaultSettings(options = {}) {
    const mode = cleanString(options.mode || 'default', 80) || 'default';
    const sourcePath = cleanString(options.sourcePath || global.location?.pathname || '/', 500) || '/';
    const stored = loadSettings(mode, sourcePath);
    const isAdmin = isPrintAdminUser();
    const orgName = resolveActiveOrgName();
    const defaults = options.defaults && typeof options.defaults === 'object' ? options.defaults : {};
    const merged = {
      includeOrg: true,
      orgName,
      includeHeaderNote: false,
      headerNote: '',
      orientation: 'landscape',
      density: 'compact',
      ...defaults,
      ...stored,
      requestedByLabel: defaults.requestedByLabel || resolveRequestingUserLabel(),
      logoUrl: defaults.logoUrl || resolveBrandLogoUrl()
    };
    if (!isAdmin) {
      merged.includeOrg = true;
      merged.orgName = orgName;
    }
    return normalizeSettings(merged);
  }

  function populateModal(settings) {
    const isAdmin = isPrintAdminUser();
    setElementValue('printSettingOrgName', isAdmin ? settings.orgName : resolveActiveOrgName());
    setElementChecked('printSettingIncludeOrg', isAdmin ? settings.includeOrg : true);
    setElementValue('printSettingHeaderNote', settings.headerNote || '');
    setElementChecked('printSettingIncludeHeaderNote', isAdmin ? settings.includeHeaderNote : true);
    setElementValue('printSettingOrientation', settings.orientation);
    setElementValue('printSettingDensity', settings.density);
  }

  function readModalSettings(baseSettings = {}) {
    const isAdmin = isPrintAdminUser();
    const settings = normalizeSettings({
      ...baseSettings,
      includeOrg: isAdmin ? getElementChecked('printSettingIncludeOrg') : true,
      orgName: isAdmin ? getElementValue('printSettingOrgName') : resolveActiveOrgName(),
      includeHeaderNote: isAdmin ? getElementChecked('printSettingIncludeHeaderNote') : true,
      headerNote: getElementValue('printSettingHeaderNote'),
      orientation: getElementValue('printSettingOrientation'),
      density: getElementValue('printSettingDensity'),
      requestedByLabel: resolveRequestingUserLabel(),
      logoUrl: resolveBrandLogoUrl()
    });
    return settings;
  }

  function openSettings(options = {}) {
    const modalEl = global.document?.getElementById('printSettingsModal');
    const settings = buildDefaultSettings(options);
    const mode = cleanString(options.mode || 'default', 80) || 'default';
    const sourcePath = cleanString(options.sourcePath || global.location?.pathname || '/', 500) || '/';
    const onConfirm = typeof options.onConfirm === 'function' ? options.onConfirm : null;

    if (!modalEl || !global.bootstrap?.Modal) {
      if (onConfirm) onConfirm(settings);
      return Promise.resolve(settings);
    }

    populateModal(settings);
    modalInstance = global.bootstrap.Modal.getOrCreateInstance(modalEl);

    return new Promise((resolve) => {
      pendingPrint = { mode, sourcePath, settings, onConfirm, resolve };
      modalInstance.show();
    });
  }

  function confirmPendingPrint() {
    if (!pendingPrint) return;
    const pending = pendingPrint;
    pendingPrint = null;
    const nextSettings = readModalSettings(pending.settings);
    saveSettings(nextSettings, pending.mode, pending.sourcePath);
    if (modalInstance) modalInstance.hide();
    if (pending.onConfirm) pending.onConfirm(nextSettings);
    pending.resolve(nextSettings);
  }

  function buildPreviewControlsHtml(settings = {}) {
    const orientation = normalizeOrientation(settings.orientation);
    const landscapeActive = orientation === 'landscape';
    const portraitActive = orientation === 'portrait';
    return `
      <div class="screen-actions no-print">
        <span class="screen-actions-label">Orientation:</span>
        <button type="button" data-print-orientation="landscape" class="${landscapeActive ? 'is-active' : ''}" aria-pressed="${landscapeActive ? 'true' : 'false'}">Landscape</button>
        <button type="button" data-print-orientation="portrait" class="${portraitActive ? 'is-active' : ''}" aria-pressed="${portraitActive ? 'true' : 'false'}">Portrait</button>
        <button type="button" onclick="window.print()">Print</button>
        <button type="button" onclick="window.close()">Close</button>
      </div>
      <p class="screen-actions-hint no-print">Change orientation here, then click Print. Browser Scale (%) still applies in the print dialog.</p>
    `;
  }

  function buildPrintNoteHtml(settings = {}) {
    const next = normalizeSettings(settings);
    return next.includeHeaderNote && next.headerNote
      ? `<div class="print-note">${escapeHtml(next.headerNote)}</div>`
      : '';
  }

  function appendSettingsToSearchParams(params, settings = {}) {
    const target = params instanceof URLSearchParams ? params : new URLSearchParams();
    const next = normalizeSettings(settings);
    target.set('printOrientation', next.orientation);
    target.set('printDensity', next.density);
    target.set('printIncludeOrg', next.includeOrg ? 'true' : 'false');
    target.set('printOrgName', next.orgName);
    target.set('printIncludeHeaderNote', next.includeHeaderNote ? 'true' : 'false');
    target.set('printHeaderNote', next.headerNote);
    target.set('printRequestedByLabel', next.requestedByLabel);
    return target;
  }

  function buildPrintPlaceholderHtml(title = 'Preparing Print') {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font:14px Segoe UI,Arial,sans-serif;padding:24px">Preparing print preview...</body></html>`;
  }

  function openHtmlPreview(options = {}) {
    const title = cleanString(options.title || 'Print Preview', 160);
    const html = String(options.html || '');
    const settings = normalizeSettings(options.settings || {});
    const sourcePath = cleanString(options.sourcePath || global.location?.pathname || '/', 500) || '/';
    const view = cleanString(options.view || 'print', 80) || 'print';
    const autoPrint = options.autoPrint !== false;
    const printWindow = global.open('', '_blank', 'height=720,width=1100');

    if (!printWindow) {
      return null;
    }

    try { printWindow.opener = null; } catch (_) {}
    printWindow.document.open();
    printWindow.document.write(buildPrintPlaceholderHtml(title));
    printWindow.document.close();

    try {
      const qsParts = ['print=1'];
      if (view) qsParts.push(`view=${encodeURIComponent(view)}`);
      if (settings.requestedByLabel) qsParts.push(`by=${encodeURIComponent(settings.requestedByLabel.slice(0, 80))}`);
      printWindow.history.replaceState({}, '', `${sourcePath}?${qsParts.join('&')}`);
    } catch (_) {}

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();

    if (autoPrint) {
      global.setTimeout(() => {
        try { printWindow.print(); } catch (_) {}
      }, 250);
    }

    return printWindow;
  }

  function bindModal() {
    const applyBtn = global.document?.getElementById('printSettingsApplyBtn');
    if (applyBtn && !applyBtn.dataset.appPrintManagerBound) {
      applyBtn.dataset.appPrintManagerBound = 'true';
      applyBtn.addEventListener('click', confirmPendingPrint);
    }
  }

  const api = {
    openSettings,
    openHtmlPreview,
    buildDefaultSettings,
    normalizeSettings,
    resolveBrandLogoUrl,
    resolveActiveOrgName,
    resolveRequestingUserLabel,
    isPrintAdminUser,
    loadSettings,
    saveSettings,
    getStorageKey,
    buildPreviewControlsHtml,
    buildPrintNoteHtml,
    appendSettingsToSearchParams,
    buildPrintPlaceholderHtml
  };

  global.AppPrintManager = api;

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', bindModal);
    } else {
      bindModal();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
