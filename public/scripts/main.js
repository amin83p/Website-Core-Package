/**
 * MAIN.JS
 * Global logic for Layout, UI Interactions, and Common Actions.
 */

// Ensure mutating same-origin fetch calls carry the current Action State token.
(function installActionStateFetchTokenBridge() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    if (window.__actionStateFetchTokenBridgeInstalled) return;
    window.__actionStateFetchTokenBridgeInstalled = true;

    const nativeFetch = window.fetch.bind(window);
    const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

    function resolveMethod(input, init) {
        const initMethod = init && typeof init === 'object' ? init.method : undefined;
        const inputMethod = input && typeof input === 'object' ? input.method : undefined;
        return String(initMethod || inputMethod || 'GET').trim().toUpperCase();
    }

    function resolveRequestUrl(input) {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        return '';
    }

    function isSameOrigin(urlToken) {
        try {
            const absolute = new URL(String(urlToken || ''), window.location.href);
            return absolute.origin === window.location.origin;
        } catch (_) {
            return false;
        }
    }

    function resolveActionStateToken() {
        const input = document.querySelector('input[name="actionStateId"]');
        const token = String(input?.value || '').trim();
        return token || '';
    }

    function mergeHeaders(input, init) {
        const headers = new Headers();
        if (input && typeof input === 'object' && input.headers) {
            new Headers(input.headers).forEach((value, key) => headers.set(key, value));
        }
        if (init && typeof init === 'object' && init.headers) {
            new Headers(init.headers).forEach((value, key) => headers.set(key, value));
        }
        return headers;
    }

    window.fetch = function patchedFetch(input, init) {
        try {
            const method = resolveMethod(input, init);
            if (!MUTATING_METHODS.has(method)) {
                return nativeFetch(input, init);
            }

            const requestUrl = resolveRequestUrl(input);
            if (!requestUrl || !isSameOrigin(requestUrl)) {
                return nativeFetch(input, init);
            }

            // Auxiliary school person-profile saves must not consume the parent form token.
            if (/\/school\/identity\/api\/linked-person\//i.test(requestUrl)) {
                return nativeFetch(input, init);
            }

            const headers = mergeHeaders(input, init);
            if (headers.has('x-skip-action-state-token') || headers.has('x-skip-action-state-bridge')) {
                return nativeFetch(input, init);
            }

            const token = resolveActionStateToken();
            if (!token) {
                return nativeFetch(input, init);
            }

            if (!headers.has('x-action-state-id')) {
                headers.set('X-Action-State-Id', token);
            }

            const nextInit = {
                ...(init && typeof init === 'object' ? init : {}),
                headers
            };
            return nativeFetch(input, nextInit);
        } catch (_) {
            return nativeFetch(input, init);
        }
    };
})();

// Redirect blocked users to policy restriction page when background fetches hit policy bans.
(function installPolicyRestrictedFetchRedirectBridge() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    if (window.__policyRestrictedFetchBridgeInstalled) return;
    window.__policyRestrictedFetchBridgeInstalled = true;

    const nativeFetch = window.fetch.bind(window);
    const FALLBACK_REDIRECT = '/dashboard';

    function scheduleRedirect(targetUrl) {
        const nextUrl = String(targetUrl || '').trim() || FALLBACK_REDIRECT;
        if (window.__policyRestrictedRedirecting) return;
        window.__policyRestrictedRedirecting = true;
        try {
            if (typeof window.hideGlobalLoadingModal === 'function') {
                window.hideGlobalLoadingModal('all');
            }
        } catch (_) {}
        window.setTimeout(() => {
            window.location.assign(nextUrl);
        }, 0);
    }

    async function inspectRestrictedResponse(response) {
        if (!response || response.status !== 403) return;

        const restrictedHeader = String(response.headers?.get('x-access-restricted') || '').trim().toLowerCase();
        if (restrictedHeader === 'policy') {
            scheduleRedirect(FALLBACK_REDIRECT);
            return;
        }

        const contentType = String(response.headers?.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) return;

        let payload = null;
        try {
            payload = await response.clone().json();
        } catch (_) {
            payload = null;
        }
        if (!payload || typeof payload !== 'object') return;

        const status = String(payload.status || '').trim().toLowerCase();
        const deniedCode = String(payload.deniedCode || '').trim().toUpperCase();
        const isPolicyRestricted =
            status === 'access_restricted'
            || deniedCode === 'WEBSITE_POLICY_BAN'
            || deniedCode === 'WEBSITE_POLICY_BANNED_USER'
            || deniedCode === 'ORG_POLICY_BAN'
            || deniedCode === 'ORG_POLICY_BANNED_USER';

        if (!isPolicyRestricted) return;
        scheduleRedirect(payload.redirectUrl || FALLBACK_REDIRECT);
    }

    window.fetch = async function policyRestrictedAwareFetch(...args) {
        const response = await nativeFetch(...args);
        inspectRestrictedResponse(response).catch(() => {});
        return response;
    };
})();

//#region 1. UI: Global Loading Modal
// =============================================================================
let loadingTokenSequence = 0;
const loadingTokens = new Set();
let loadingViewState = {
    title: 'Please wait',
    note: 'Processing your request...',
    operation: '',
    progress: null
};

function getLoadingElements() {
    const root = document.getElementById('globalLoadingModal');
    if (!root) return null;
    return {
        root,
        title: document.getElementById('globalLoadingTitle'),
        note: document.getElementById('globalLoadingNote'),
        operationWrap: document.getElementById('globalLoadingOperationWrap'),
        operation: document.getElementById('globalLoadingOperation'),
        progressWrap: document.getElementById('globalLoadingProgressWrap'),
        progressBar: document.getElementById('globalLoadingProgressBar')
    };
}

function normalizeLoadingState(input = {}) {
    if (typeof input === 'string') {
        return {
            ...loadingViewState,
            note: String(input || '').trim() || 'Processing your request...'
        };
    }

    if (!input || typeof input !== 'object') {
        return { ...loadingViewState };
    }

    const next = {
        ...loadingViewState
    };

    if (Object.prototype.hasOwnProperty.call(input, 'title')) {
        next.title = String(input.title || '').trim() || 'Please wait';
    }

    if (Object.prototype.hasOwnProperty.call(input, 'note') || Object.prototype.hasOwnProperty.call(input, 'message')) {
        next.note = String(input.note ?? input.message ?? '').trim() || 'Processing your request...';
    }

    if (Object.prototype.hasOwnProperty.call(input, 'operation')) {
        next.operation = String(input.operation || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(input, 'progress')) {
        if (input.progress === null || input.progress === undefined || input.progress === '') {
            next.progress = null;
        } else {
            const progress = Number(input.progress);
            next.progress = Number.isFinite(progress)
                ? Math.max(0, Math.min(100, Math.round(progress)))
                : null;
        }
    }

    return next;
}

function renderLoadingState(isVisible = true) {
    const el = getLoadingElements();
    if (!el) return;

    if (el.title) el.title.textContent = loadingViewState.title || 'Please wait';
    if (el.note) el.note.textContent = loadingViewState.note || 'Processing your request...';

    const operation = String(loadingViewState.operation || '').trim();
    if (el.operationWrap && el.operation) {
        if (operation) {
            el.operation.textContent = operation;
            el.operationWrap.classList.remove('d-none');
        } else {
            el.operation.textContent = '';
            el.operationWrap.classList.add('d-none');
        }
    }

    if (el.progressWrap && el.progressBar) {
        if (loadingViewState.progress === null) {
            el.progressWrap.classList.add('d-none');
            el.progressBar.style.width = '0%';
            el.progressBar.textContent = '0%';
            el.progressBar.setAttribute('aria-valuenow', '0');
        } else {
            const progress = Number(loadingViewState.progress || 0);
            el.progressWrap.classList.remove('d-none');
            el.progressBar.style.width = `${progress}%`;
            el.progressBar.textContent = `${progress}%`;
            el.progressBar.setAttribute('aria-valuenow', String(progress));
        }
    }

    if (isVisible) {
        el.root.classList.add('is-visible');
        el.root.setAttribute('aria-hidden', 'false');
    } else {
        el.root.classList.remove('is-visible');
        el.root.setAttribute('aria-hidden', 'true');
    }
}

function showLoading(options = {}) {
    const token = `loading_${Date.now()}_${++loadingTokenSequence}`;
    loadingTokens.add(token);
    loadingViewState = normalizeLoadingState(options);
    renderLoadingState(true);
    return token;
}

function hideLoading(tokenOrOptions = null) {
    const forceHide = tokenOrOptions && typeof tokenOrOptions === 'object' && tokenOrOptions.force === true;
    if (forceHide) {
        loadingTokens.clear();
        renderLoadingState(false);
        return;
    }

    if (typeof tokenOrOptions === 'string' && tokenOrOptions.trim()) {
        loadingTokens.delete(tokenOrOptions.trim());
    } else if (loadingTokens.size > 0) {
        const mostRecentToken = Array.from(loadingTokens).pop();
        if (mostRecentToken) loadingTokens.delete(mostRecentToken);
    }

    if (loadingTokens.size === 0) {
        renderLoadingState(false);
    }
}

function updateLoading(options = {}) {
    loadingViewState = normalizeLoadingState(options);
    if (loadingTokens.size > 0) {
        renderLoadingState(true);
    }
}

function setLoadingProgress(progress, options = {}) {
    const extra = options && typeof options === 'object' ? options : {};
    updateLoading({
        ...extra,
        progress
    });
}

window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.updateLoading = updateLoading;
window.setLoadingProgress = setLoadingProgress;

window.addEventListener('pageshow', function (event) {
    if (event.persisted) hideLoading({ force: true });
});

window.addEventListener('load', function () {
    hideLoading({ force: true });
});
//#endregion

//#region 2. UI: Header Layout, Search & Profile Switch
// =============================================================================

function syncHeaderTaglineVisibility() {
    const header = document.getElementById('main-header');
    if (!header) return;
    const tagline = header.querySelector('.tagline');
    if (!(tagline instanceof HTMLElement)) return;

    tagline.classList.remove('tagline-overflow-hidden');
    const style = window.getComputedStyle(tagline);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    if (!tagline.clientWidth) return;

    const overflowsSingleLine = tagline.scrollWidth > (tagline.clientWidth + 1);
    if (overflowsSingleLine) {
        tagline.classList.add('tagline-overflow-hidden');
    }
}

let headerOffsetLastHeaderHeight = '';
let headerOffsetLastNoticeHeight = '';

function adjustHeaderOffset(options = {}) {
    const header = document.getElementById('main-header');
    const notice = document.querySelector('.notice-bar');
    const root = document.documentElement;
    const syncTagline = options.syncTagline !== false;

    if (!header) return;
    if (syncTagline) syncHeaderTaglineVisibility();

    const headerRect = header.getBoundingClientRect();
    const headerH = Math.max(0, Number(headerRect.height || header.offsetHeight || 0));
    const noticeH = Math.max(0, Number(notice ? notice.offsetHeight : 0));
    const headerHeightPx = `${headerH.toFixed(2)}px`;
    const noticeHeightPx = `${noticeH.toFixed(2)}px`;

    if (headerHeightPx !== headerOffsetLastHeaderHeight) {
        root.style.setProperty('--header-height', headerHeightPx);
        headerOffsetLastHeaderHeight = headerHeightPx;
    }
    if (noticeHeightPx !== headerOffsetLastNoticeHeight) {
        root.style.setProperty('--notice-height', noticeHeightPx);
        headerOffsetLastNoticeHeight = noticeHeightPx;
    }
}

let headerOffsetRefreshRafId = 0;
let headerOffsetRefreshTimerId = null;
let headerOffsetResizeObserverBound = false;
let headerOffsetTransitionActive = false;
let headerOffsetTransitionSafetyTimerId = null;

function markHeaderOffsetTransitionActive(active) {
    headerOffsetTransitionActive = Boolean(active);
    if (headerOffsetTransitionSafetyTimerId) {
        clearTimeout(headerOffsetTransitionSafetyTimerId);
        headerOffsetTransitionSafetyTimerId = null;
    }
    if (headerOffsetTransitionActive) {
        headerOffsetTransitionSafetyTimerId = setTimeout(() => {
            headerOffsetTransitionActive = false;
            headerOffsetTransitionSafetyTimerId = null;
        }, 420);
    }
}

function scheduleHeaderOffsetRefresh(options = {}) {
    const syncTagline = options.syncTagline !== false;
    const settle = options.settle !== false;

    if (headerOffsetRefreshRafId) {
        cancelAnimationFrame(headerOffsetRefreshRafId);
        headerOffsetRefreshRafId = 0;
    }
    if (headerOffsetRefreshTimerId) {
        clearTimeout(headerOffsetRefreshTimerId);
        headerOffsetRefreshTimerId = null;
    }

    headerOffsetRefreshRafId = requestAnimationFrame(() => {
        adjustHeaderOffset({ syncTagline });
        headerOffsetRefreshRafId = 0;
    });
    if (settle) {
        headerOffsetRefreshTimerId = setTimeout(() => {
            adjustHeaderOffset({ syncTagline: false });
            headerOffsetRefreshTimerId = null;
        }, 220);
    }
}

function ensureHeaderOffsetResizeObserver() {
    if (headerOffsetResizeObserverBound) return;
    if (typeof ResizeObserver !== 'function') return;

    const header = document.getElementById('main-header');
    if (!header) return;
    const notice = document.querySelector('.notice-bar');
    const observer = new ResizeObserver(() => {
        if (headerOffsetTransitionActive) return;
        scheduleHeaderOffsetRefresh({ syncTagline: false });
    });
    observer.observe(header);
    if (notice) observer.observe(notice);
    headerOffsetResizeObserverBound = true;
}

const APP_ZOOM_STORAGE_KEY = 'app_ui_zoom';
const APP_ZOOM_MIN = 0.8;
const APP_ZOOM_MAX = 1.3;
const APP_ZOOM_STEP = 0.05;
const APP_ZOOM_MIN_PERCENT = Math.round(APP_ZOOM_MIN * 100);
const APP_ZOOM_MAX_PERCENT = Math.round(APP_ZOOM_MAX * 100);
const APP_ZOOM_STEP_PERCENT = Math.round(APP_ZOOM_STEP * 100);
const HEADER_COMPACT_STORAGE_KEY = 'app_header_compact';
const APP_FONT_SCALE_STORAGE_KEY = 'app_ui_font_scale';
const APP_FONT_SCALE_MIN = 0.85;
const APP_FONT_SCALE_MAX = 1.2;
const APP_FONT_SCALE_STEP = 0.05;
const APP_FONT_SCALE_MIN_PERCENT = Math.round(APP_FONT_SCALE_MIN * 100);
const APP_FONT_SCALE_MAX_PERCENT = Math.round(APP_FONT_SCALE_MAX * 100);
const APP_FONT_SCALE_STEP_PERCENT = Math.round(APP_FONT_SCALE_STEP * 100);
const APP_PAGE_WIDTH_STORAGE_KEY = 'app_page_width';
const APP_PAGE_WIDTH_MODES = new Set(['standard', 'wide', 'full']);
const APP_PAGE_WIDTH_CLASS_MAP = {
    standard: '',
    wide: 'app-page-width-wide',
    full: 'app-page-width-full'
};

function normalizeAppPageWidth(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    return APP_PAGE_WIDTH_MODES.has(normalized) ? normalized : 'standard';
}

function getStoredAppPageWidth() {
    try {
        return normalizeAppPageWidth(localStorage.getItem(APP_PAGE_WIDTH_STORAGE_KEY));
    } catch (_) {
        return 'standard';
    }
}

function updateAppPageWidthUi(mode) {
    const normalized = normalizeAppPageWidth(mode);
    const standardInput = document.getElementById('appPageWidthStandard');
    const wideInput = document.getElementById('appPageWidthWide');
    const fullInput = document.getElementById('appPageWidthFull');
    if (standardInput) standardInput.checked = normalized === 'standard';
    if (wideInput) wideInput.checked = normalized === 'wide';
    if (fullInput) fullInput.checked = normalized === 'full';
}

function applyAppPageWidth(mode, options = {}) {
    const persist = options.persist !== false;
    const normalized = normalizeAppPageWidth(mode);
    const root = document.documentElement;
    if (root) {
        root.classList.remove('app-page-width-wide', 'app-page-width-full');
        const widthClass = APP_PAGE_WIDTH_CLASS_MAP[normalized];
        if (widthClass) root.classList.add(widthClass);
    }
    updateAppPageWidthUi(normalized);
    if (persist) {
        try {
            localStorage.setItem(APP_PAGE_WIDTH_STORAGE_KEY, normalized);
        } catch (_) {}
    }
    return normalized;
}

function initAppPageWidthControls() {
    const menuBlock = document.getElementById('appPageWidthMenuBlock');
    const standardInput = document.getElementById('appPageWidthStandard');
    const wideInput = document.getElementById('appPageWidthWide');
    const fullInput = document.getElementById('appPageWidthFull');

    applyAppPageWidth(getStoredAppPageWidth(), { persist: false });

    if (!menuBlock || !standardInput || !wideInput || !fullInput) return;

    ['click', 'mousedown', 'pointerdown'].forEach((eventName) => {
        menuBlock.addEventListener(eventName, (event) => {
            event.stopPropagation();
        });
    });

    [standardInput, wideInput, fullInput].forEach((input) => {
        input.addEventListener('change', () => {
            if (!input.checked) return;
            applyAppPageWidth(input.value);
        });
    });
}

function clampAppZoom(level) {
    const parsed = Number(level);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, parsed));
}

function getStoredAppZoom() {
    try {
        const raw = localStorage.getItem(APP_ZOOM_STORAGE_KEY);
        return clampAppZoom(raw ? Number(raw) : 1);
    } catch (_) {
        return 1;
    }
}

function getCurrentAppZoom() {
    if (!document?.body) return 1;
    const zoomValue = Number.parseFloat(document.body.dataset.appZoom || '');
    return Number.isFinite(zoomValue) ? clampAppZoom(zoomValue) : 1;
}

function clampAndSnapAppZoomPercent(value) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return 100;
    const clamped = Math.min(APP_ZOOM_MAX_PERCENT, Math.max(APP_ZOOM_MIN_PERCENT, parsed));
    const snapped = Math.round(clamped / APP_ZOOM_STEP_PERCENT) * APP_ZOOM_STEP_PERCENT;
    return Math.min(APP_ZOOM_MAX_PERCENT, Math.max(APP_ZOOM_MIN_PERCENT, snapped));
}

function clampAppFontScale(level) {
    const parsed = Number(level);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(APP_FONT_SCALE_MAX, Math.max(APP_FONT_SCALE_MIN, parsed));
}

function clampAndSnapAppFontPercent(value) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return 100;
    const clamped = Math.min(APP_FONT_SCALE_MAX_PERCENT, Math.max(APP_FONT_SCALE_MIN_PERCENT, parsed));
    const snapped = Math.round(clamped / APP_FONT_SCALE_STEP_PERCENT) * APP_FONT_SCALE_STEP_PERCENT;
    return Math.min(APP_FONT_SCALE_MAX_PERCENT, Math.max(APP_FONT_SCALE_MIN_PERCENT, snapped));
}

function getStoredAppFontScale() {
    try {
        const raw = localStorage.getItem(APP_FONT_SCALE_STORAGE_KEY);
        return clampAppFontScale(raw ? Number(raw) : 1);
    } catch (_) {
        return 1;
    }
}

function updateAppFontScaleUi(scale) {
    const levelPercent = Math.round(scale * 100);
    const rangeInput = document.getElementById('appFontRange');
    const numberInput = document.getElementById('appFontNumber');
    const resetBtn = document.getElementById('appFontResetBtn');
    if (rangeInput) rangeInput.value = String(levelPercent);
    if (numberInput) numberInput.value = String(levelPercent);
    if (resetBtn) resetBtn.disabled = Math.abs(scale - 1) < 0.001;
}

function applyAppFontScale(level, options = {}) {
    const { persist = true } = options;
    const clamped = clampAppFontScale(level);
    const htmlEl = document.documentElement;

    htmlEl.style.setProperty('--app-ui-font-scale', String(clamped));
    htmlEl.style.fontSize = `${Math.round(clamped * 100)}%`;
    htmlEl.style.setProperty('font-size', `${Math.round(clamped * 100)}%`);
    updateAppFontScaleUi(clamped);

    if (persist) {
        try {
            localStorage.setItem(APP_FONT_SCALE_STORAGE_KEY, String(clamped));
        } catch (_) {}
    }

    scheduleHeaderOffsetRefresh();
    return clamped;
}

function updateAppZoomUi(level) {
    const levelPercent = Math.round(level * 100);
    const rangeInput = document.getElementById('appZoomRange');
    const numberInput = document.getElementById('appZoomNumber');
    const resetBtn = document.getElementById('appZoomResetBtn');
    if (rangeInput) rangeInput.value = String(levelPercent);
    if (numberInput) numberInput.value = String(levelPercent);
    if (resetBtn) resetBtn.disabled = Math.abs(level - 1) < 0.001;
}

function applyAppZoom(level, options = {}) {
    const { persist = true } = options;
    const clamped = clampAppZoom(level);
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    if (!bodyEl) return clamped;

    const inverseCanvasSize = (100 / clamped).toFixed(4);
    const zoomIsDefault = Math.abs(clamped - 1) < 0.001;
    // Use transform instead of native CSS zoom. Native zoom can shift the body
    // origin in Chromium when shrinking the app, leaving a vertical white gutter.
    // The inverse canvas width keeps the transformed app covering the viewport.
    htmlEl.style.overflowX = zoomIsDefault ? '' : 'hidden';
    bodyEl.style.overflowX = zoomIsDefault ? '' : 'hidden';
    bodyEl.style.marginLeft = '';
    bodyEl.style.marginRight = '';

    if (zoomIsDefault) {
        bodyEl.style.zoom = '';
        bodyEl.style.transform = '';
        bodyEl.style.transformOrigin = '';
        bodyEl.style.width = '';
        bodyEl.style.minHeight = '';
    } else {
        bodyEl.style.zoom = '';
        bodyEl.style.transformOrigin = 'top left';
        bodyEl.style.transform = `scale(${clamped})`;
        bodyEl.style.width = `${inverseCanvasSize}%`;
        bodyEl.style.minHeight = `${inverseCanvasSize}vh`;
    }

    bodyEl.dataset.appZoom = String(clamped);
    htmlEl.style.setProperty('--app-ui-zoom', String(clamped));
    updateAppZoomUi(clamped);
    if (persist) {
        try {
            localStorage.setItem(APP_ZOOM_STORAGE_KEY, String(clamped));
        } catch (_) {}
    }

    scheduleHeaderOffsetRefresh();
    return clamped;
}

function initAppZoomControls() {
    const zoomMenuBlock = document.getElementById('appZoomMenuBlock');
    const rangeInput = document.getElementById('appZoomRange');
    const numberInput = document.getElementById('appZoomNumber');
    const resetBtn = document.getElementById('appZoomResetBtn');
    const settingsModal = document.getElementById('appSettingsModal');
    applyAppZoom(getStoredAppZoom(), { persist: false });

    if (!zoomMenuBlock || !rangeInput || !numberInput || !resetBtn) return;

    ['click', 'mousedown', 'pointerdown'].forEach((eventName) => {
        zoomMenuBlock.addEventListener(eventName, (event) => {
            event.stopPropagation();
        });
    });

    rangeInput.addEventListener('input', (event) => {
        const percent = clampAndSnapAppZoomPercent(event.target.value);
        applyAppZoom(percent / 100);
    });

    numberInput.addEventListener('input', (event) => {
        const percent = clampAndSnapAppZoomPercent(event.target.value);
        applyAppZoom(percent / 100);
    });

    numberInput.addEventListener('change', (event) => {
        const percent = clampAndSnapAppZoomPercent(event.target.value);
        applyAppZoom(percent / 100);
    });

    numberInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const percent = clampAndSnapAppZoomPercent(numberInput.value);
        applyAppZoom(percent / 100);
    });

    resetBtn.addEventListener('click', (event) => {
        event.preventDefault();
        applyAppZoom(1);
    });

    if (settingsModal) {
        settingsModal.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            const modalApi = window.bootstrap && window.bootstrap.Modal;
            if (!modalApi || typeof modalApi.getOrCreateInstance !== 'function') return;
            const modalInstance = modalApi.getOrCreateInstance(settingsModal);
            if (modalInstance && typeof modalInstance.hide === 'function') {
                modalInstance.hide();
            }
        });

        settingsModal.addEventListener('shown.bs.modal', () => {
            rangeInput.focus();
        });
    }
}

function initAppFontControls() {
    const fontMenuBlock = document.getElementById('appFontMenuBlock');
    const rangeInput = document.getElementById('appFontRange');
    const numberInput = document.getElementById('appFontNumber');
    const resetBtn = document.getElementById('appFontResetBtn');

    applyAppFontScale(getStoredAppFontScale(), { persist: false });

    if (!fontMenuBlock || !rangeInput || !numberInput || !resetBtn) return;

    ['click', 'mousedown', 'pointerdown'].forEach((eventName) => {
        fontMenuBlock.addEventListener(eventName, (event) => {
            event.stopPropagation();
        });
    });

    rangeInput.addEventListener('input', (event) => {
        const percent = clampAndSnapAppFontPercent(event.target.value);
        applyAppFontScale(percent / 100);
    });

    numberInput.addEventListener('input', (event) => {
        const percent = clampAndSnapAppFontPercent(event.target.value);
        applyAppFontScale(percent / 100);
    });

    numberInput.addEventListener('change', (event) => {
        const percent = clampAndSnapAppFontPercent(event.target.value);
        applyAppFontScale(percent / 100);
    });

    numberInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const percent = clampAndSnapAppFontPercent(numberInput.value);
        applyAppFontScale(percent / 100);
    });

    resetBtn.addEventListener('click', (event) => {
        event.preventDefault();
        applyAppFontScale(1);
    });
}

function getStoredHeaderCompactPreference() {
    try {
        return localStorage.getItem(HEADER_COMPACT_STORAGE_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function setHeaderCompactState(header, toggleBtn, isCompact, options = {}) {
    const persist = options.persist !== false;
    if (!header) return;

    header.classList.toggle('header-minimized', Boolean(isCompact));
    if (document.body) {
        document.body.classList.toggle('header-layout-compact', Boolean(isCompact));
    }
    if (Boolean(isCompact)) {
        header.classList.remove('shrunk');
    }

    if (toggleBtn) {
        const icon = toggleBtn.querySelector('i');
        if (icon) {
            icon.className = isCompact ? 'bi bi-chevron-down' : 'bi bi-chevron-up';
        }
        toggleBtn.setAttribute('aria-pressed', isCompact ? 'true' : 'false');
        toggleBtn.setAttribute('title', isCompact ? 'Expand header' : 'Minimize header');
        toggleBtn.setAttribute('aria-label', isCompact ? 'Expand header' : 'Minimize header');
    }

    if (persist) {
        try {
            localStorage.setItem(HEADER_COMPACT_STORAGE_KEY, isCompact ? '1' : '0');
        } catch (_) {}
    }

    scheduleHeaderOffsetRefresh();
}

function initHeaderInteractions() {
    const header = document.getElementById('main-header');
    const noticeBar = document.querySelector('.notice-bar');
    const searchBtn = document.querySelector('button[title="Search"]') || document.querySelector('.search-btn');
    const searchForm = document.querySelector('.search-form');
    const compactToggleBtn = document.getElementById('headerCompactToggle');
    const headerContent = header ? header.querySelector('.header-content') : null;
    
    if (!header) return;
    ensureHeaderOffsetResizeObserver();

    if (compactToggleBtn) {
        setHeaderCompactState(header, compactToggleBtn, getStoredHeaderCompactPreference(), { persist: false });
        compactToggleBtn.addEventListener('click', (event) => {
            event.preventDefault();
            const nextState = !header.classList.contains('header-minimized');
            setHeaderCompactState(header, compactToggleBtn, nextState, { persist: true });
        });
    }

    header.addEventListener('transitionend', (event) => {
        if (!event) return;
        const target = event.target;
        if (target === header || target === headerContent) {
            markHeaderOffsetTransitionActive(false);
            scheduleHeaderOffsetRefresh();
        }
    });
    header.addEventListener('transitionstart', (event) => {
        if (!event) return;
        const target = event.target;
        if (target === header || target === headerContent) {
            markHeaderOffsetTransitionActive(true);
        }
    });
    header.addEventListener('transitioncancel', (event) => {
        if (!event) return;
        const target = event.target;
        if (target === header || target === headerContent) {
            markHeaderOffsetTransitionActive(false);
            scheduleHeaderOffsetRefresh({ syncTagline: false, settle: false });
        }
    });

    // 1. Scroll Handler
    let isScrolling = false;
    let wasShrunk = header.classList.contains('shrunk');
    window.addEventListener('scroll', () => {
        if (isScrolling) return;
        isScrolling = true;
        window.requestAnimationFrame(() => {
            if (header.classList.contains('header-minimized')) {
                isScrolling = false;
                return;
            }
            const nextShrunk = window.scrollY > 100;
            if (nextShrunk === wasShrunk) {
                isScrolling = false;
                return;
            }
            wasShrunk = nextShrunk;
            header.classList.toggle('shrunk', nextShrunk);
            if (noticeBar) noticeBar.classList.toggle('hidden', nextShrunk);
            markHeaderOffsetTransitionActive(true);
            isScrolling = false;
        });
    }, { passive: true });

    // 2. Search Toggle Logic
    if (searchBtn && searchForm) {
        const searchInput = searchForm.querySelector('.search-input');
        const newBtn = searchBtn.cloneNode(true);
        searchBtn.parentNode.replaceChild(newBtn, searchBtn);

        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault(); 

            const isOpen = searchForm.classList.contains('active');
            searchForm.classList.toggle('active');
            header.classList.toggle('search-open', !isOpen);
            
            if (!isOpen && searchInput) {
                setTimeout(() => searchInput.focus(), 100); 
            } else if (searchInput) {
                searchInput.blur();
            }
        });

        document.addEventListener('click', (e) => {
            if (searchForm.classList.contains('active') && 
                !newBtn.contains(e.target) && 
                !searchForm.contains(e.target)) {
                searchForm.classList.remove('active');
                header.classList.remove('search-open');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && searchForm.classList.contains('active')) {
                searchForm.classList.remove('active');
                header.classList.remove('search-open');
            }
        });
    }
}

// B. Profile Switcher Logic
window.toggleProfileMode = async function(targetMode) {
    try {
        const btn = document.getElementById('profileModeSwitchBtn');
        if (!btn) return;

        const originalHtml = btn.innerHTML;
        const targetLabel = targetMode === 'SYSTEM' ? 'System Admin' : 'Local Member';
        
        btn.disabled = true;
        btn.innerHTML = `<div class="d-flex align-items-center gap-2"><div class="spinner-border spinner-border-sm text-secondary" role="status"></div><span class="small text-muted">Switching...</span></div>`;

        const response = await fetch('/switch-mode', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-AJAX-Request': 'true' },
            body: JSON.stringify({ mode: targetMode })
        });

        const result = await response.json();

        if (result.status === 'success') {
            if (typeof showMessageModal === 'function') {
                await showMessageModal({
                    title: 'Context Switched',
                    message: `You are now viewing this organization as a <b>${targetLabel}</b>.`,
                    icon: 'success',
                    buttons: [{ text: 'OK', class: 'btn-success' }] 
                });
            }
            window.location.reload();
        } else {
            handleSwitchError(result.message || 'Switch failed.', btn, originalHtml);
        }
    } catch (error) {
        console.error('Switch failed:', error);
        handleSwitchError('Network error while switching profile mode.', btn, originalHtml);
    }
};

async function handleSwitchError(msg, btn, originalHtml) {
    if (typeof showMessageModal === 'function') {
        await showMessageModal({ title: 'Error', message: msg, icon: 'error', buttons: [{ text: 'OK', class: 'btn-danger' }] });
    } else {
        alert(msg);
    }
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

window.addEventListener('load', () => scheduleHeaderOffsetRefresh({ syncTagline: true }));
window.addEventListener('resize', () => scheduleHeaderOffsetRefresh({ syncTagline: false }));
//#endregion

//#region 2b. UI: Header Main Menu
// =============================================================================
function initHeaderApplicationMenu() {
    const menuLists = Array.from(document.querySelectorAll('[data-header-app-menu-list]'));
    if (!menuLists.length) return;

    let loadPromise = null;
    let rootNodes = [];
    let loadedOnce = false;

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderRawSvgIcon(value) {
        const raw = String(value || '').trim();
        const match = raw.match(/<svg[\s\S]*<\/svg>/i);
        return match ? match[0] : '';
    }

    function renderIcon(icon) {
        const fallback = '<i class="bi bi-grid-fill me-2"></i>';
        if (!icon || !icon.value) return fallback;
        const type = String(icon.type || '').toLowerCase();
        const value = String(icon.value || '').trim();
        if (!value) return fallback;
        if (type === 'class') return `<i class="${escapeHtml(value)} me-2"></i>`;
        if (type === 'image') return `<img src="${escapeHtml(value)}" alt="" class="me-2" style="width:1rem;height:1rem;object-fit:contain;">`;
        if (type === 'raw') {
            const svg = renderRawSvgIcon(value);
            return svg ? `<span class="header-app-menu-icon me-2">${svg}</span>` : fallback;
        }
        return fallback;
    }

    function nodeLabel(node) {
        return escapeHtml(node?.title || node?.name || node?.id || 'Menu Item');
    }

    function nodeUrl(node) {
        return String(node?.url || '').trim();
    }

    function renderStatus(message, iconClass = 'bi-hourglass-split') {
        return `<li><span class="dropdown-item py-2 text-muted small"><i class="bi ${escapeHtml(iconClass)} me-2"></i>${escapeHtml(message)}</span></li>`;
    }

    function renderNode(node) {
        const children = Array.isArray(node?.children) ? node.children : [];
        const label = nodeLabel(node);
        const href = escapeHtml(nodeUrl(node));
        const icon = renderIcon(node?.icon);

        if (children.length) {
            const openLink = href
                ? `<li><a class="dropdown-item py-2 fw-semibold" href="${href}" data-no-wait="true">${icon}Open ${label}</a></li><li><hr class="dropdown-divider my-1"></li>`
                : '';
            return `<li class="dropdown-submenu header-public-submenu">
                <button class="dropdown-item py-2 d-flex align-items-center justify-content-between gap-2 header-public-submenu-toggle" type="button" aria-expanded="false" data-public-submenu-toggle="true">
                    <span>${icon}${label}</span><i class="bi bi-chevron-right small"></i>
                </button>
                <ul class="dropdown-menu shadow-lg border-0 py-2">
                    ${openLink}
                    ${children.map(renderNode).join('')}
                </ul>
            </li>`;
        }

        if (!href) return `<li><span class="dropdown-item py-2 text-muted">${icon}${label}</span></li>`;
        return `<li><a class="dropdown-item py-2" href="${href}" data-no-wait="true">${icon}${label}</a></li>`;
    }

    function renderMenus() {
        const content = rootNodes.length
            ? rootNodes.map(renderNode).join('')
            : renderStatus('No application menu items are available.', 'bi-info-circle');

        menuLists.forEach((listEl) => {
            listEl.innerHTML = content;
        });
    }

    function setLoadingState() {
        menuLists.forEach((listEl) => {
            listEl.innerHTML = renderStatus('Loading menu...');
        });
    }

    function setErrorState() {
        menuLists.forEach((listEl) => {
            listEl.innerHTML = renderStatus('Could not load menu items.', 'bi-exclamation-circle');
        });
    }

    async function loadMenu() {
        if (loadedOnce) {
            renderMenus();
            return;
        }
        if (loadPromise) {
            await loadPromise;
            return;
        }

        setLoadingState();
        loadPromise = (async () => {
            try {
                const res = await fetch('/sections/start-menu', { credentials: 'include' });
                const data = await res.json();
                if (!res.ok || data.status !== 'success') {
                    throw new Error(data.message || 'Failed to load header menu.');
                }
                rootNodes = Array.isArray(data.sections) ? data.sections : [];
                loadedOnce = true;
                renderMenus();
            } catch (error) {
                console.error('[HeaderAppMenu] Error:', error);
                rootNodes = [];
                setErrorState();
            } finally {
                loadPromise = null;
            }
        })();
        await loadPromise;
    }

    document.querySelectorAll('[data-header-app-menu-trigger]').forEach((trigger) => {
        trigger.addEventListener('click', () => {
            loadMenu();
        });
        trigger.addEventListener('mouseenter', () => {
            loadMenu();
        }, { once: true });
        trigger.addEventListener('focus', () => {
            loadMenu();
        }, { once: true });
    });

    document.querySelectorAll('[data-header-app-menu-root]').forEach((root) => {
        root.addEventListener('show.bs.dropdown', () => {
            loadMenu();
        });
    });
}
//#endregion

//#region 3. Logic: Global Actions (Delete & Cancel)
// =============================================================================
function escapeDeleteBlockedHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderDeleteBlockedPreview(preview = {}) {
    const label = escapeDeleteBlockedHtml(preview.label || preview.id || 'This record');
    const blockers = Array.isArray(preview.blockers) ? preview.blockers : [];
    const totalReferences = blockers.reduce((sum, row) => sum + Number(row?.count || 0), 0);

    if (!blockers.length) {
        return `<p class="mb-0">Cannot delete <strong>${label}</strong> because related records exist.</p>`;
    }

    const items = blockers.map((blocker, index) => {
        const blockerLabel = escapeDeleteBlockedHtml(blocker.label || blocker.message || blocker.code || 'Reference');
        const count = Number(blocker.count || 0);
        const samples = Array.isArray(blocker.samples) ? blocker.samples : [];
        const extra = Math.max(0, count - samples.length);
        const hint = blocker.resolveHint
            ? `<div class="small text-muted mt-2"><i class="bi bi-lightbulb me-1"></i>${escapeDeleteBlockedHtml(blocker.resolveHint)}</div>`
            : '';
        const sampleHtml = samples.map((sample) => {
            const sampleLabel = escapeDeleteBlockedHtml(sample.label || sample.id || 'Record');
            if (sample.href) {
                return `<li class="list-group-item py-2"><a href="${escapeDeleteBlockedHtml(sample.href)}" target="_blank" rel="noopener noreferrer">${sampleLabel}</a></li>`;
            }
            return `<li class="list-group-item py-2">${sampleLabel}</li>`;
        }).join('');
        const extraHtml = extra > 0 ? `<li class="list-group-item py-2 text-muted">…and ${extra} more</li>` : '';
        const samplesBlock = (samples.length || extra)
            ? `<ul class="list-group list-group-flush mt-2 mb-0">${sampleHtml}${extraHtml}</ul>`
            : '';

        return `<div class="border rounded p-3 mb-2 bg-light-subtle">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
                <span class="badge text-bg-warning">${index + 1}</span>
                <strong>${blockerLabel}</strong>
                <span class="badge rounded-pill text-bg-secondary">${count} reference${count === 1 ? '' : 's'}</span>
            </div>
            ${hint}
            ${samplesBlock}
        </div>`;
    }).join('');

    return `<div class="delete-blocked-modal-preview text-start">
        <p class="mb-3">Cannot delete <strong>${label}</strong>. This record is linked to <strong>${totalReferences}</strong> related item${totalReferences === 1 ? '' : 's'}.</p>
        <div class="small fw-semibold text-uppercase text-muted mb-2">Resolve these references first</div>
        ${items}
    </div>`;
}

function buildDeleteActionError(result = {}, response) {
    const err = new Error(result.message || `Delete failed with status ${response?.status || 400}.`);
    err.code = result.code || '';
    err.preview = result.preview || result.details || result.data || null;
    return err;
}

function initGlobalActions() {
    document.body.addEventListener('click', async (e) => {
        const target = e.target.closest('button, a');
        if (!target) return;

        // A. ARCHIVE
        if (target.classList.contains('archive-btn')) {
            await handleArchiveAction(e, target);
            return;
        }

        // A. DELETE
        if (target.classList.contains('delete-btn')) {
            await handleDeleteAction(e, target);
        }
        // B. CANCEL
        else if (target.id === 'btnCancelAction' || target.closest('#btnCancelAction')) {
            const btn = target.closest('#btnCancelAction') || target;
            await handleCancelAction(e, btn);
        }
    });
}

async function handleDeleteAction1(btn) {
    const urlRefEl = document.getElementById('urlRef');
    if (!urlRefEl) {
        console.warn('Delete button clicked, but #urlRef hidden input is missing.');
        return;
    }

    const urlRef = urlRefEl.dataset.id;
    const id = btn.dataset.id;
    const user = btn.dataset.user; // Optional sub-ID

    // FIX: Encode components to handle special characters (like '/' or '+') safely
    let deleteUrl = `/${urlRef}/delete/${encodeURIComponent(id)}`;
    
    if (user) {
        deleteUrl = `/${urlRef}/delete/${encodeURIComponent(user)}/${encodeURIComponent(id)}`;
    }

    const btnResult = await showMessageModal({
        title: 'Confirm Delete',
        icon: 'warning',
        message: `Are you sure you want to delete this item?`,
        size: 'md',
        buttons: [
            { text: 'Cancel', class: 'btn-secondary btn-md' },
            { text: 'Delete', class: 'btn-warning btn-md' }
        ]
    });

    if (btnResult !== 'Delete') return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';

    try {
        const response = await fetch(deleteUrl, {
            method: 'GET', // Use standard REST method
            headers: { 'X-AJAX-Request': 'true', 'Accept': 'application/json' }
        });
        const result = await response.json();
        if (typeof window.handleGuardedApiPayload === 'function' && result?.idempotency?.state) {
            const guardResult = await window.handleGuardedApiPayload(result, {
                busyTitle: 'Delete In Progress',
                replayTitle: 'Delete Already Completed'
            });
            if (guardResult?.handled && guardResult.state === 'busy') {
                btn.disabled = false;
                btn.textContent = originalText;
                return;
            }
        }

        if (result.status === 'success' || result?.idempotency?.state === 'replayed') {
            const row = btn.closest('tr');
            if (row) {
                row.style.transition = 'all 0.3s ease';
                row.style.opacity = '0';
                row.style.backgroundColor = '#ffe6e6';
                setTimeout(() => row.remove(), 300);
            }
            if (typeof showMessageModal === 'function') {
                showMessageModal({ title: 'Deleted', icon: 'success', message: 'Item deleted successfully.', size: 'md', buttons: [{ text: 'OK', class: 'btn-success btn-sm' }] });
            }
        } else {
            throw new Error(result.message || 'Failed to delete item.');
        }
    } catch (error) {
        console.error('Delete Error:', error);
        showMessageModal({ title: 'Error', icon: 'error', message: error.message, buttons: [{ text: 'OK', class: 'btn-danger btn-sm' }] });
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function handleDeleteAction(eventOrButton, maybeButton = null) {
    const e = maybeButton ? eventOrButton : null;
    const btn = maybeButton || eventOrButton;
    if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
        e.stopPropagation();
    }
    if (!btn || btn.dataset.deleteBusy === '1' || window.__appDeleteActionInProgress === true) return;

    const urlRefEl = document.getElementById('urlRef');
    if (!urlRefEl) {
        console.warn('Delete button clicked, but #urlRef hidden input is missing.');
        return;
    }

    const urlRef = urlRefEl.dataset.id;
    const id = btn.dataset.id;
    const user = btn.dataset.user;

    let deleteUrl = btn.dataset.deleteUrl || `/${urlRef}/delete/${encodeURIComponent(id)}`;
    if (user) {
        deleteUrl = `/${urlRef}/delete/${encodeURIComponent(user)}/${encodeURIComponent(id)}`;
    }

    const btnResult = await showMessageModal({
        title: 'Confirm Delete',
        icon: 'warning',
        message: `Are you sure you want to delete this item?`,
        size: 'md',
        buttons: [
            { text: 'Cancel', class: 'btn-secondary btn-md' },
            { text: 'Delete', class: 'btn-warning btn-md' }
        ]
    });
    if (btnResult !== 'Delete') return;

    const originalHtml = btn.innerHTML;
    const originalDisabled = btn.disabled === true;
    const originalAriaBusy = btn.getAttribute('aria-busy');
    window.__appDeleteActionInProgress = true;
    btn.dataset.deleteBusy = '1';
    btn.disabled = true;
    btn.classList.add('disabled');
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Deleting...';
    let loadingToken = null;

    const closeLoading = () => {
        if (loadingToken && typeof window.hideLoading === 'function') {
            window.hideLoading(loadingToken);
            loadingToken = null;
        }
    };
    const restoreButton = () => {
        btn.innerHTML = originalHtml;
        btn.disabled = originalDisabled;
        btn.classList.remove('disabled');
        if (originalAriaBusy === null) btn.removeAttribute('aria-busy');
        else btn.setAttribute('aria-busy', originalAriaBusy);
        delete btn.dataset.deleteBusy;
    };

    if (typeof window.showLoading === 'function') {
        loadingToken = window.showLoading({
            title: 'Deleting Record',
            note: 'Please wait while the selected item is removed. This may take a moment when related records are checked.',
            operation: 'Delete'
        });
    }

    try {
        const response = await fetch(deleteUrl, {
            method: 'GET',
            headers: { 'X-AJAX-Request': 'true', 'Accept': 'application/json' }
        });
        const responseText = await response.text();
        let result = {};
        try {
            result = responseText ? JSON.parse(responseText) : {};
        } catch (_) {
            result = { status: response.ok ? 'success' : 'error', message: responseText };
        }

        if (!response.ok && result.status !== 'success') {
            throw buildDeleteActionError(result, response);
        }

        if (typeof window.handleGuardedApiPayload === 'function' && result?.idempotency?.state) {
            const guardResult = await window.handleGuardedApiPayload(result, {
                busyTitle: 'Delete In Progress',
                replayTitle: 'Delete Already Completed'
            });
            if (guardResult?.handled && guardResult.state === 'busy') {
                closeLoading();
                restoreButton();
                return;
            }
        }

        if (result.status === 'success' || result?.idempotency?.state === 'replayed') {
            closeLoading();
            const row = btn.closest('tr');
            if (row) {
                row.style.transition = 'all 0.3s ease';
                row.style.opacity = '0';
                row.style.backgroundColor = '#ffe6e6';
                setTimeout(() => row.remove(), 300);
            }

            if (typeof showMessageModal === 'function') {
                const successMessage = result?.note
                    ? `${result?.message || 'Item deleted successfully.'}<div class="mt-1 text-muted">${result.note}</div>`
                    : result?.message || 'Item deleted successfully.';
                showMessageModal({
                    title: 'Deleted',
                    icon: 'success',
                    message: successMessage,
                    size: 'md',
                    buttons: [{ text: 'OK', class: 'btn-success btn-sm' }]
                });
            }
        } else {
            throw buildDeleteActionError(result, response);
        }
    } catch (error) {
        console.error('Delete Error:', error);
        closeLoading();
        if (typeof showMessageModal === 'function') {
            const isDeleteBlocked = error?.code === 'DELETE_BLOCKED' && error?.preview;
            await showMessageModal({
                title: isDeleteBlocked ? 'Delete blocked' : 'Error',
                icon: isDeleteBlocked ? 'warning' : 'error',
                message: isDeleteBlocked ? renderDeleteBlockedPreview(error.preview) : error.message,
                size: isDeleteBlocked ? 'lg' : 'md',
                buttons: [{ text: 'OK', class: isDeleteBlocked ? 'btn-warning btn-sm' : 'btn-danger btn-sm' }]
            });
        } else {
            alert(error.message);
        }
        restoreButton();
    } finally {
        closeLoading();
        window.__appDeleteActionInProgress = false;
    }
}

async function handleArchiveAction(eventOrButton, maybeButton = null) {
    const e = maybeButton ? eventOrButton : null;
    const btn = maybeButton || eventOrButton;
    if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
        e.stopPropagation();
    }
    if (!btn || btn.dataset.archiveBusy === '1' || window.__appArchiveActionInProgress === true) return;

    const urlRefEl = document.getElementById('urlRef');
    if (!urlRefEl) {
        console.warn('Archive button clicked, but #urlRef hidden input is missing.');
        return;
    }

    const urlRef = urlRefEl.dataset.id;
    const id = btn.dataset.id;
    let archiveUrl = btn.dataset.archiveUrl || `/${urlRef}/archive/${encodeURIComponent(id)}`;

    const btnResult = await showMessageModal({
        title: 'Confirm Archive',
        icon: 'warning',
        message: `Are you sure you want to archive this item?`,
        size: 'md',
        buttons: [
            { text: 'Cancel', class: 'btn-secondary btn-md' },
            { text: 'Archive', class: 'btn-primary btn-md' }
        ]
    });
    if (btnResult !== 'Archive') return;

    const originalHtml = btn.innerHTML;
    const originalDisabled = btn.disabled === true;
    const originalAriaBusy = btn.getAttribute('aria-busy');
    window.__appArchiveActionInProgress = true;
    btn.dataset.archiveBusy = '1';
    btn.disabled = true;
    btn.classList.add('disabled');
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Archiving...';
    let loadingToken = null;

    const closeLoading = () => {
        if (loadingToken && typeof window.hideLoading === 'function') {
            window.hideLoading(loadingToken);
            loadingToken = null;
        }
    };
    const restoreButton = () => {
        btn.innerHTML = originalHtml;
        btn.disabled = originalDisabled;
        btn.classList.remove('disabled');
        if (originalAriaBusy === null) btn.removeAttribute('aria-busy');
        else btn.setAttribute('aria-busy', originalAriaBusy);
        delete btn.dataset.archiveBusy;
    };

    if (typeof window.showLoading === 'function') {
        loadingToken = window.showLoading({
            title: 'Archiving Record',
            note: 'Please wait while the selected item is moved to archived status.',
            operation: 'Archive'
        });
    }

    try {
        const response = await fetch(archiveUrl, {
            method: 'GET',
            headers: { 'X-AJAX-Request': 'true', 'Accept': 'application/json' }
        });
        const responseText = await response.text();
        let result = {};
        try {
            result = responseText ? JSON.parse(responseText) : {};
        } catch (_) {
            result = { status: response.ok ? 'success' : 'error', message: responseText };
        }

        if (!response.ok && result.status !== 'success') {
            throw new Error(result.message || `Archive failed with status ${response.status}.`);
        }

        if (typeof window.handleGuardedApiPayload === 'function' && result?.idempotency?.state) {
            const guardResult = await window.handleGuardedApiPayload(result, {
                busyTitle: 'Archive In Progress',
                replayTitle: 'Archive Already Completed'
            });
            if (guardResult?.handled && guardResult.state === 'busy') {
                closeLoading();
                restoreButton();
                return;
            }
        }

        if (result.status === 'success' || result?.idempotency?.state === 'replayed') {
            closeLoading();
            const row = btn.closest('tr');
            if (row) {
                row.style.transition = 'all 0.3s ease';
                row.style.opacity = '0';
                row.style.backgroundColor = '#e9ecef';
                setTimeout(() => row.remove(), 300);
            }

            if (typeof showMessageModal === 'function') {
                const successMessage = result?.note
                    ? `${result?.message || 'Item archived successfully.'}<div class=\"mt-1 text-muted\">${result.note}</div>`
                    : result?.message || 'Item archived successfully.';
                showMessageModal({
                    title: 'Archived',
                    icon: 'success',
                    message: successMessage,
                    size: 'md',
                    buttons: [{ text: 'OK', class: 'btn-success btn-sm' }]
                });
            }
        } else {
            throw new Error(result.message || 'Failed to archive item.');
        }
    } catch (error) {
        console.error('Archive Error:', error);
        closeLoading();
        if (typeof showMessageModal === 'function') {
            await showMessageModal({
                title: 'Error',
                icon: 'error',
                message: error.message,
                buttons: [{ text: 'OK', class: 'btn-danger btn-sm' }]
            });
        } else {
            alert(error.message);
        }
        restoreButton();
    } finally {
        closeLoading();
        window.__appArchiveActionInProgress = false;
    }
}

async function handleCancelAction(e, btn) {
    e.preventDefault();
    btn.textContent = 'Cancelling...';
    btn.disabled = true;

    const tokenInput = document.querySelector('input[name="actionStateId"]');
    const token = tokenInput ? tokenInput.value : null;

    if (token) {
        try {
            await fetch('/actionStates/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-AJAX-Request': 'true' },
                body: JSON.stringify({ id: token })
            });
        } catch (err) {
            console.error("Failed to report cancellation:", err);
        }
    }

    const targetUrl = btn.dataset.returnUrl || btn.getAttribute('href');
    if (targetUrl && targetUrl !== '#') window.location.href = targetUrl;
    else window.history.back();
}
//#endregion

//#region 4. Logic: Action State Beacon
// =============================================================================
window.addEventListener('pagehide', () => {
    const tokenInput = document.querySelector('input[name="actionStateId"]');
    if (tokenInput && tokenInput.value && !window.isFormSubmitting) {
        const blob = new Blob([JSON.stringify({ id: tokenInput.value })], { type: 'application/json' });
        navigator.sendBeacon('/actionStates/cancel', blob);
    }
});

document.addEventListener('submit', (e) => {
    if (e.target.tagName === 'FORM') window.isFormSubmitting = true;
});
//#endregion

//#region 5. UI: Floating Row Action Menus
// =============================================================================
function initFloatingRowActionMenus() {
    const contextSelector = '[data-floating-row-actions="true"]';
    const contexts = Array.from(document.querySelectorAll(contextSelector));
    if (!contexts.length) return;

    function inManagedContext(node) {
        return Boolean(node?.closest && node.closest(contextSelector));
    }

    function getMenuKey(element) {
        if (!element || !element.dataset) return '';
        return String(
            element.dataset.rowActionsId
            || element.dataset.periodId
            || element.dataset.qid
            || element.dataset.id
            || ''
        ).trim();
    }

    function findWrapByKey(key) {
        const targetKey = String(key || '').trim();
        if (!targetKey) return null;
        for (let i = 0; i < contexts.length; i += 1) {
            const context = contexts[i];
            const toggles = context.querySelectorAll('.btn-row-actions-toggle');
            for (let j = 0; j < toggles.length; j += 1) {
                const toggle = toggles[j];
                if (getMenuKey(toggle) === targetKey) return toggle.closest('.row-actions-wrap');
            }
        }
        return null;
    }

    function dockMenu(menu) {
        if (!menu || menu.parentElement !== document.body) return;
        const wrap = findWrapByKey(getMenuKey(menu));
        if (wrap) wrap.appendChild(menu);
    }

    function resetFloatingStyles(menu) {
        if (!menu) return;
        menu.classList.remove('row-actions-menu--floating');
        menu.style.left = '';
        menu.style.top = '';
        menu.style.right = '';
        menu.style.visibility = '';
        menu.style.position = '';
    }

    function placeFloatingMenu(menu, wrap) {
        if (!menu || !wrap) return;
        const rect = wrap.getBoundingClientRect();
        const zoom = Math.max(getCurrentAppZoom(), 0.01);
        const viewportWidth = window.innerWidth / zoom;
        const viewportHeight = window.innerHeight / zoom;
        const rectTop = rect.top / zoom;
        const rectRight = rect.right / zoom;
        const rectBottom = rect.bottom / zoom;
        menu.classList.add('row-actions-menu--floating');
        menu.style.visibility = 'hidden';
        menu.style.position = 'fixed';
        menu.style.left = '0';
        menu.style.top = '0';
        const menuWidth = Math.max(menu.offsetWidth || 0, 148);
        const menuHeight = menu.offsetHeight || 0;
        let left = rectRight - menuWidth;
        left = Math.max(8, Math.min(left, viewportWidth - menuWidth - 8));
        const gap = 4;
        let top = rectBottom + gap;
        if (menuHeight > 0 && top + menuHeight > viewportHeight - 8) {
            top = Math.max(8, rectTop - menuHeight - gap);
        }
        if (menuHeight > 0 && top + menuHeight > viewportHeight - 8) {
            top = Math.max(8, viewportHeight - menuHeight - 8);
        }
        if (menuWidth > 0 && left + menuWidth > viewportWidth - 8) {
            left = Math.max(8, viewportWidth - menuWidth - 8);
        }
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        menu.style.visibility = '';
    }

    function allMenus() {
        return Array.from(document.querySelectorAll(`${contextSelector} .row-actions-menu, body > .row-actions-menu.row-actions-menu--floating`));
    }

    function closeAllMenus() {
        allMenus().forEach((menu) => {
            menu.classList.add('d-none');
            resetFloatingStyles(menu);
            dockMenu(menu);
        });
    }

    function repositionOpenMenu() {
        const openMenu = document.querySelector('body > .row-actions-menu.row-actions-menu--floating:not(.d-none)');
        if (!openMenu) return;
        const wrap = findWrapByKey(getMenuKey(openMenu));
        if (wrap) placeFloatingMenu(openMenu, wrap);
    }

    let repositionOpenMenuRafId = 0;
    function scheduleRepositionOpenMenu() {
        const openMenu = document.querySelector('body > .row-actions-menu.row-actions-menu--floating:not(.d-none)');
        if (!openMenu) return;
        if (repositionOpenMenuRafId) return;
        repositionOpenMenuRafId = requestAnimationFrame(() => {
            repositionOpenMenuRafId = 0;
            repositionOpenMenu();
        });
    }

    window.addEventListener('scroll', scheduleRepositionOpenMenu, { capture: true, passive: true });
    window.addEventListener('resize', scheduleRepositionOpenMenu, { passive: true });
    contexts.forEach((context) => {
        context.addEventListener('scroll', scheduleRepositionOpenMenu, { passive: true });
    });

    document.addEventListener('click', (event) => {
        const toggleBtn = event.target.closest('.btn-row-actions-toggle');
        if (toggleBtn && inManagedContext(toggleBtn)) {
            const key = getMenuKey(toggleBtn);
            const targetMenu = allMenus().find((menu) => getMenuKey(menu) === key);
            const willOpen = targetMenu ? targetMenu.classList.contains('d-none') : false;
            closeAllMenus();
            if (targetMenu && willOpen) {
                const wrap = toggleBtn.closest('.row-actions-wrap');
                targetMenu.classList.remove('d-none');
                document.body.appendChild(targetMenu);
                placeFloatingMenu(targetMenu, wrap);
                requestAnimationFrame(() => requestAnimationFrame(scheduleRepositionOpenMenu));
            }
            return;
        }

        if (!inManagedContext(event.target) && !event.target.closest('body > .row-actions-menu')) {
            closeAllMenus();
            return;
        }

        const actionTarget = event.target.closest('.row-actions-menu .btn, .row-actions-menu a, .row-actions-menu button');
        if (actionTarget && !actionTarget.classList.contains('btn-row-actions-toggle')) {
            setTimeout(closeAllMenus, 0);
        }
    });

    document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!form) return;
        if (inManagedContext(form) || form.closest('body > .row-actions-menu')) {
            setTimeout(closeAllMenus, 0);
        }
    }, true);
}
//#endregion

//#region 5.1 UI: Small-Screen Action Dropdown Alignment
// =============================================================================
function initSmallScreenActionDropdownFix() {
    const mobileQuery = window.matchMedia('(max-width: 991.98px)');
    let resizeTimer = null;

    function isActionDropdownToggle(toggle) {
        if (!toggle) return false;
        const trigger = String(toggle.getAttribute('data-bs-toggle') || '').trim().toLowerCase();
        if (trigger !== 'dropdown') return false;
        if (toggle.closest('.navbar, .offcanvas, .modal-header')) return false;
        if (toggle.id === 'headerDashboardTrigger' || toggle.id === 'headerQuickMenuTrigger') return false;
        if (toggle.querySelector('.bi-three-dots-vertical')) return true;
        if (toggle.classList.contains('btn-row-actions-toggle')) return true;
        return false;
    }

    function applyMode() {
        const useStaticMode = mobileQuery.matches;
        document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach((toggle) => {
            if (!isActionDropdownToggle(toggle)) return;
            if (useStaticMode) {
                if (toggle.dataset.prevBsDisplay === undefined) {
                    toggle.dataset.prevBsDisplay = String(toggle.getAttribute('data-bs-display') || '');
                }
                toggle.setAttribute('data-bs-display', 'static');
                return;
            }
            if (toggle.dataset.prevBsDisplay !== undefined) {
                const prev = String(toggle.dataset.prevBsDisplay || '').trim();
                if (prev) toggle.setAttribute('data-bs-display', prev);
                else toggle.removeAttribute('data-bs-display');
                delete toggle.dataset.prevBsDisplay;
            }
        });
    }

    applyMode();
    window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resizeTimer = null;
            applyMode();
        }, 120);
    });
}
//#endregion

//#region 6. UI: Quick Menu (Dashboard)
// =============================================================================
function initQuickMenu() {
    console.log('[QuickMenu] Initializing logic...');

    const modalEl = document.getElementById('quickMenuModal');
    if (!modalEl) {
        console.warn('[QuickMenu] Modal container not found. Skipping.');
        return;
    }

    const loadingEl = document.getElementById('quickMenuLoading');
    const gridEl = document.getElementById('quickMenuGrid');
    const emptyEl = document.getElementById('quickMenuEmpty');
    const searchInput = document.getElementById('quickMenuSearch');

    let loadedOnce = false;
    let activeVisibleIndex = -1;

    const DISPLAY_ACRONYMS = new Set([
        'PTE',
        'IELTS',
        'CLB',
        'AI',
        'API',
        'UI',
        'UX',
        'URL',
        'IP',
        'ID',
        'SQL',
        'JSON',
        'CSV',
        'PDF',
        'XML'
    ]);

    function prettifyName(name) {
        const raw = String(name || '').trim();
        if (!raw) return 'Unknown';
        return raw
            .replace(/[_-]+/g, ' ')
            .split(/\s+/)
            .map((token) => {
                const part = String(token || '').trim();
                if (!part) return '';
                if (/[a-z]/.test(part) && /[A-Z]/.test(part) && !/^[A-Z0-9]+$/.test(part)) return part;
                const upper = part.toUpperCase();
                if (DISPLAY_ACRONYMS.has(upper)) return upper;
                if (/^[A-Z0-9]+$/.test(part) && /[0-9]/.test(part)) return upper;
                return upper.charAt(0) + upper.slice(1).toLowerCase();
            })
            .filter(Boolean)
            .join(' ');
    }

    function resolveSectionDisplayTitle(section) {
        const custom = String(section?.displayText || '').trim();
        if (custom) return custom;
        return prettifyName(section?.name);
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderQuickMenuIcon(section) {
        const icon = section && section.customIcon ? section.customIcon : null;
        const type = String(icon?.type || '').trim().toLowerCase();
        const value = String(icon?.value || '').trim();

        if (!icon || !value) return '<i class="bi bi-grid-fill fs-5"></i>';
        if (type === 'class') return `<i class="${escapeHtml(value)} fs-5"></i>`;
        if (type === 'image') {
            return `<img src="${escapeHtml(value)}" alt="icon" style="width:100%;height:100%;object-fit:contain;">`;
        }
        if (type === 'raw') {
            return `<div class="w-100 h-100 d-flex align-items-center justify-content-center">${value}</div>`;
        }
        return '<i class="bi bi-grid-fill fs-5"></i>';
    }

    function getVisibleItems() {
        return Array.from(gridEl.querySelectorAll('.qm-item')).filter((item) => item.style.display !== 'none');
    }

    function applyActiveItemStyles(activeItem) {
        gridEl.querySelectorAll('.qm-item').forEach((item) => {
            const isActive = item === activeItem;
            item.classList.toggle('bg-primary-subtle', isActive);
            item.classList.toggle('border-primary', isActive);
            item.classList.toggle('shadow-sm', isActive);
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
            item.style.outline = isActive ? '2px solid rgba(13,110,253,.35)' : '';
            item.style.outlineOffset = isActive ? '-2px' : '';
        });
    }

    function setActiveVisibleIndex(index, options = {}) {
        const { scroll = true } = options;
        const visibleItems = getVisibleItems();
        if (!visibleItems.length) {
            activeVisibleIndex = -1;
            applyActiveItemStyles(null);
            return null;
        }

        const normalized = ((index % visibleItems.length) + visibleItems.length) % visibleItems.length;
        activeVisibleIndex = normalized;
        const activeItem = visibleItems[normalized];
        applyActiveItemStyles(activeItem);
        if (scroll) activeItem.scrollIntoView({ block: 'nearest' });
        return activeItem;
    }

    function syncActiveItemAfterFilter() {
        const visibleItems = getVisibleItems();
        if (!visibleItems.length) {
            activeVisibleIndex = -1;
            applyActiveItemStyles(null);
            return;
        }
        if (activeVisibleIndex < 0 || activeVisibleIndex >= visibleItems.length) {
            setActiveVisibleIndex(0, { scroll: false });
            return;
        }
        setActiveVisibleIndex(activeVisibleIndex, { scroll: false });
    }

    function focusSearchInput() {
        if (!searchInput) return;
        window.setTimeout(() => {
            searchInput.focus();
            searchInput.select();
        }, 120);
    }

    function filterItems(term) {
        const items = gridEl.querySelectorAll('.qm-item');
        const lowerTerm = String(term || '').toLowerCase().trim();
        let visibleCount = 0;

        items.forEach((item) => {
            const text = item.dataset.search || '';
            const matches = text.includes(lowerTerm);
            item.style.setProperty('display', matches ? 'flex' : 'none', 'important');
            if (matches) visibleCount += 1;
        });

        if (emptyEl) {
            if (visibleCount === 0 && items.length > 0) {
                emptyEl.classList.remove('d-none');
                const msg = emptyEl.querySelector('#qmEmptyMsg');
                if (msg) msg.textContent = 'No matching modules found.';
            } else {
                emptyEl.classList.add('d-none');
            }
        }

        syncActiveItemAfterFilter();
    }

    function renderQuickMenu(sections) {
        gridEl.innerHTML = '';
        activeVisibleIndex = -1;

        if (!sections || sections.length === 0) {
            if (emptyEl) {
                emptyEl.classList.remove('d-none');
                const msg = emptyEl.querySelector('#qmEmptyMsg');
                if (msg) msg.textContent = 'No modules available.';
            }
            return;
        }

        if (emptyEl) emptyEl.classList.add('d-none');
        const fragment = document.createDocumentFragment();

        sections.forEach((section) => {
            const homeUrl = String(section.homeURL || '').trim();
            const hasSubsections = Array.isArray(section.subsections) && section.subsections.length > 0;
            const url = homeUrl || (hasSubsections ? `/dashboard/section-nav/${encodeURIComponent(section.name || section.id || '')}` : '/sections');
            const title = resolveSectionDisplayTitle(section);
            const desc = section.description || '';
            const searchStr = `${section.name || ''} ${section.displayText || ''} ${section.id || ''} ${title} ${desc}`.toLowerCase();

            const a = document.createElement('a');
            a.href = url;
            a.className = 'list-group-item list-group-item-action d-flex align-items-center py-3 px-4 border-bottom qm-item';
            a.dataset.search = searchStr;
            a.setAttribute('role', 'option');
            a.setAttribute('aria-selected', 'false');
            a.innerHTML = `
            <div class="rounded-3 bg-primary-subtle text-primary d-flex align-items-center justify-content-center me-3 shadow-sm"
                style="width: 40px; height: 40px; min-width: 40px;">
                ${renderQuickMenuIcon(section)}
            </div>
            <div class="flex-grow-1 overflow-hidden">
                <div class="fw-bold text-dark">${escapeHtml(title)}</div>
                <div class="text-muted small text-truncate" style="opacity: 0.8;">${escapeHtml(desc)}</div>
            </div>
            <i class="bi bi-chevron-right text-muted ms-3" style="font-size: 0.8rem;"></i>
            `;

            a.addEventListener('mouseenter', () => {
                const visibleItems = getVisibleItems();
                const idx = visibleItems.indexOf(a);
                if (idx >= 0) setActiveVisibleIndex(idx, { scroll: false });
            });

            fragment.appendChild(a);
        });

        gridEl.appendChild(fragment);
        syncActiveItemAfterFilter();
    }

    async function loadQuickMenu() {
        if (searchInput) searchInput.value = '';

        if (loadedOnce) {
            filterItems('');
            focusSearchInput();
            return;
        }

        loadedOnce = true;
        if (loadingEl) loadingEl.style.display = 'block';

        try {
            const res = await fetch('/sections/quick-menu', { credentials: 'include' });
            const data = await res.json();
            if (!res.ok || data.status !== 'success') {
                throw new Error(data.message || 'Failed to load');
            }
            renderQuickMenu(data.sections);
            filterItems('');
        } catch (err) {
            console.error('[QuickMenu] Error:', err);
            if (loadingEl) loadingEl.textContent = 'Could not load modules.';
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
        }
    }

    function handleSearchKeydown(event) {
        if (!searchInput) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveVisibleIndex(activeVisibleIndex + 1);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveVisibleIndex(activeVisibleIndex - 1);
            return;
        }
        if (event.key === 'Enter') {
            const target = setActiveVisibleIndex(activeVisibleIndex < 0 ? 0 : activeVisibleIndex, { scroll: false });
            if (target) {
                event.preventDefault();
                target.click();
            }
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            setActiveVisibleIndex(0);
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            const lastIndex = getVisibleItems().length - 1;
            if (lastIndex >= 0) setActiveVisibleIndex(lastIndex);
        }
    }

    modalEl.addEventListener('show.bs.modal', () => {
        loadQuickMenu();
    });

    modalEl.addEventListener('shown.bs.modal', () => {
        focusSearchInput();
    });

    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            filterItems(event.target.value);
        });
        searchInput.addEventListener('keydown', handleSearchKeydown);
    }
}
//#endregion

//#region 6. UI: Start Menu (Hierarchy)
// =============================================================================
function initStartMenu() {
    const modalEl = document.getElementById('startMenuModal');
    if (!modalEl) return;

    const dockLoadingEl = document.getElementById('startMenuDockLoading');
    const dockEmptyEl = document.getElementById('startMenuDockEmpty');
    const dockEl = document.getElementById('startMenuDock');
    const shellEl = modalEl.querySelector('.start-menu-shell');
    const dockWrapEl = modalEl.querySelector('.start-menu-dock-wrap');
    const branchPanelEl = document.getElementById('startMenuBranchPanel');
    const branchTitleEl = document.getElementById('startMenuBranchTitle');
    const branchPathEl = document.getElementById('startMenuBranchPath');
    const branchOpenRootBtn = document.getElementById('startMenuBranchOpenRoot');
    const branchSearchEl = document.getElementById('startMenuBranchSearch');
    const branchListEl = document.getElementById('startMenuBranchList');
    const branchEmptyEl = document.getElementById('startMenuBranchEmpty');
    const subBranchPanelEl = document.getElementById('startMenuSubBranchPanel');
    const subBranchBackBtn = document.getElementById('startMenuSubBranchBack');
    const subBranchTitleEl = document.getElementById('startMenuSubBranchTitle');
    const subBranchPathEl = document.getElementById('startMenuSubBranchPath');
    const subBranchListEl = document.getElementById('startMenuSubBranchList');
    const subBranchEmptyEl = document.getElementById('startMenuSubBranchEmpty');

    let loadedOnce = false;
    let rootNodes = [];
    let selectedRootKey = '';
    let searchTerm = '';
    let keyboardRows = [];
    let activeRowIndex = -1;
    let forcedExpandedKeys = new Set();
    let subKeyboardRows = [];
    let activeSubRowIndex = -1;
    let subBranchStack = [];
    let activeSubParentKey = '';
    let lastSubAnchorSnapshot = null;
    let startMenuBackdropEl = null;

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function renderIcon(icon) {
        const fallback = '<i class="bi bi-grid-fill"></i>';
        if (!icon || !icon.value) return fallback;
        const type = String(icon.type || '').toLowerCase();
        const value = String(icon.value || '').trim();
        if (!value) return fallback;
        if (type === 'class') return `<i class="${escapeHtml(value)}"></i>`;
        if (type === 'image') return `<img src="${escapeHtml(value)}" alt="" style="width:100%;height:100%;object-fit:contain;">`;
        if (type === 'raw') return `<span>${value}</span>`;
        return fallback;
    }

    function hasNewTabIntent(event) {
        if (!event) return false;
        return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || Number(event.button || 0) !== 0;
    }

    function nodeUrl(node) {
        return String(node?.url || '').trim();
    }

    function makeNavigableMenuElement(className, href) {
        const targetUrl = String(href || '').trim();
        if (targetUrl) {
            const anchor = document.createElement('a');
            anchor.href = targetUrl;
            anchor.className = className;
            anchor.dataset.noWait = 'true';
            return anchor;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.dataset.noWait = 'true';
        return button;
    }

    function syncStartMenuLinkState(linkEl, href) {
        if (!linkEl) return;
        const targetUrl = String(href || '').trim();
        if (targetUrl) {
            linkEl.href = targetUrl;
            linkEl.classList.remove('disabled');
            linkEl.removeAttribute('aria-disabled');
            linkEl.removeAttribute('tabindex');
            return;
        }
        linkEl.href = '#';
        linkEl.classList.add('disabled');
        linkEl.setAttribute('aria-disabled', 'true');
        linkEl.setAttribute('tabindex', '-1');
    }

    function escapeAndHighlight(text, needle) {
        const raw = String(text || '');
        const term = String(needle || '').trim();
        if (!term) return escapeHtml(raw);
        const lowerRaw = raw.toLowerCase();
        const lowerNeedle = term.toLowerCase();
        const idx = lowerRaw.indexOf(lowerNeedle);
        if (idx < 0) return escapeHtml(raw);
        const before = escapeHtml(raw.slice(0, idx));
        const match = escapeHtml(raw.slice(idx, idx + term.length));
        const after = escapeHtml(raw.slice(idx + term.length));
        return `${before}<mark class="start-menu-highlight">${match}</mark>${after}`;
    }

    function flattenNodes(nodes, collector = []) {
        (nodes || []).forEach((node) => {
            collector.push(node);
            flattenNodes(node.children || [], collector);
        });
        return collector;
    }

    function getSelectedRootNode() {
        if (!selectedRootKey) return null;
        return rootNodes.find((node) => String(node.key || '') === selectedRootKey) || null;
    }

    function getDockButtonByKey(keyToken) {
        if (!dockEl || !keyToken) return null;
        const token = String(keyToken || '');
        const buttons = Array.from(dockEl.querySelectorAll('.start-menu-dock-btn'));
        return buttons.find((btn) => String(btn.dataset.key || '') === token) || null;
    }

    function hideSubBranchPanel(options = {}) {
        const { clearStack = true, clearAnchor = true } = options;
        if (subBranchPanelEl) subBranchPanelEl.classList.add('d-none');
        if (subBranchListEl) subBranchListEl.innerHTML = '';
        if (subBranchEmptyEl) subBranchEmptyEl.classList.add('d-none');
        if (clearStack) subBranchStack = [];
        if (clearAnchor) lastSubAnchorSnapshot = null;
        subKeyboardRows = [];
        activeSubRowIndex = -1;
        activeSubParentKey = '';
    }

    function makeAnchorSnapshot(anchorSource) {
        if (!anchorSource) return null;
        if (anchorSource instanceof Element && typeof anchorSource.getBoundingClientRect === 'function') {
            const rect = anchorSource.getBoundingClientRect();
            return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height
            };
        }
        if (typeof anchorSource === 'object' && anchorSource !== null && Number.isFinite(anchorSource.left) && Number.isFinite(anchorSource.top)) {
            const width = Number.isFinite(anchorSource.width)
                ? Number(anchorSource.width)
                : Math.max(0, Number(anchorSource.right || 0) - Number(anchorSource.left || 0));
            const height = Number.isFinite(anchorSource.height)
                ? Number(anchorSource.height)
                : Math.max(0, Number(anchorSource.bottom || 0) - Number(anchorSource.top || 0));
            return {
                left: Number(anchorSource.left),
                right: Number.isFinite(anchorSource.right) ? Number(anchorSource.right) : (Number(anchorSource.left) + width),
                top: Number(anchorSource.top),
                bottom: Number.isFinite(anchorSource.bottom) ? Number(anchorSource.bottom) : (Number(anchorSource.top) + height),
                width,
                height
            };
        }
        return null;
    }

    function positionBranchPanel(anchorEl = null) {
        if (!branchPanelEl || !shellEl || !dockWrapEl) return;
        if (branchPanelEl.classList.contains('d-none')) return;

        const anchorNode = anchorEl || getDockButtonByKey(selectedRootKey);
        if (!anchorNode) return;

        const shellRect = shellEl.getBoundingClientRect();
        const panelRect = branchPanelEl.getBoundingClientRect();
        const anchorRect = anchorNode.getBoundingClientRect();

        const panelWidth = Math.max(220, panelRect.width || branchPanelEl.offsetWidth || 220);
        const anchorCenterInShell = (anchorRect.left - shellRect.left) + (anchorRect.width / 2);
        const minLeft = 8;
        const maxLeft = Math.max(minLeft, shellRect.width - panelWidth - 8);
        const unclampedLeft = anchorCenterInShell - (panelWidth / 2);
        const panelLeft = Math.min(maxLeft, Math.max(minLeft, unclampedLeft));

        const pointerLeft = Math.max(22, Math.min(panelWidth - 22, anchorCenterInShell - panelLeft));
        const panelBottom = Math.max((dockWrapEl.offsetHeight || 96) + 10, 98);

        branchPanelEl.style.left = `${Math.round(panelLeft)}px`;
        branchPanelEl.style.bottom = `${Math.round(panelBottom)}px`;
        branchPanelEl.style.transform = 'none';
        branchPanelEl.style.setProperty('--start-menu-branch-pointer-left', `${Math.round(pointerLeft)}px`);

        requestAnimationFrame(() => positionSubBranchPanel());
    }

    function positionSubBranchPanel(anchorSource = null) {
        if (!subBranchPanelEl || !branchPanelEl) return;
        if (subBranchPanelEl.classList.contains('d-none') || branchPanelEl.classList.contains('d-none')) return;

        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const mainRect = branchPanelEl.getBoundingClientRect();
        const panelMaxHeight = Math.max(160, viewportHeight - 16);
        subBranchPanelEl.style.maxHeight = `${Math.round(panelMaxHeight)}px`;

        const subRect = subBranchPanelEl.getBoundingClientRect();
        const panelWidth = Math.max(240, subRect.width || subBranchPanelEl.offsetWidth || 240);
        const panelHeight = Math.max(180, subRect.height || subBranchPanelEl.offsetHeight || 180);

        let anchorRect = makeAnchorSnapshot(anchorSource);
        if (!anchorRect) {
            const anchoredMainRow = activeSubParentKey && branchListEl
                ? branchListEl.querySelector(`.start-menu-branch-row[data-key="${activeSubParentKey}"]`)
                : null;
            anchorRect = makeAnchorSnapshot(anchoredMainRow);
        }
        if (!anchorRect && lastSubAnchorSnapshot) {
            anchorRect = makeAnchorSnapshot(lastSubAnchorSnapshot);
        }
        if (!anchorRect) {
            anchorRect = makeAnchorSnapshot(mainRect);
        }
        lastSubAnchorSnapshot = anchorRect;

        const gap = 12;
        const preferredRight = anchorRect.right + gap;
        const preferredLeft = anchorRect.left - panelWidth - gap;
        const maxLeft = Math.max(8, viewportWidth - panelWidth - 8);

        let panelLeft = preferredRight;
        if (preferredRight > maxLeft) panelLeft = preferredLeft;
        panelLeft = Math.max(8, Math.min(maxLeft, panelLeft));

        const anchorCenterInViewport = anchorRect.top + ((anchorRect.height || 0) / 2);
        const desiredTop = anchorCenterInViewport - Math.min(32, panelHeight * 0.28);
        const maxTop = Math.max(8, viewportHeight - panelHeight - 8);
        const panelTop = Math.max(8, Math.min(maxTop, desiredTop));

        subBranchPanelEl.style.setProperty('left', `${Math.round(panelLeft)}px`);
        subBranchPanelEl.style.setProperty('top', `${Math.round(panelTop)}px`);
        subBranchPanelEl.style.setProperty('right', 'auto');
        subBranchPanelEl.style.setProperty('bottom', 'auto');
        subBranchPanelEl.style.setProperty('transform', 'none');
    }

    function applyDockSelectionUi() {
        const dockBtns = dockEl ? Array.from(dockEl.querySelectorAll('.start-menu-dock-btn')) : [];
        dockBtns.forEach((btn) => {
            const isActive = String(btn.dataset.key || '') === selectedRootKey;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    function markVisibilityForSearch(rootNode) {
        const term = normalizeText(searchTerm);
        const hasTerm = Boolean(term);
        forcedExpandedKeys = new Set();

        function visit(node, ancestors = []) {
            const children = Array.isArray(node.children) ? node.children : [];
            let childMatch = false;
            children.forEach((child) => {
                if (visit(child, ancestors.concat([node.key]))) childMatch = true;
            });
            const haystack = normalizeText([node.title, node.name, node.id, node.description, node.pathLabel].join(' '));
            const selfMatch = hasTerm ? haystack.includes(term) : true;
            const visible = hasTerm ? (selfMatch || childMatch) : true;
            node.__visible = visible;
            if (visible && hasTerm) {
                ancestors.forEach((ancestorKey) => forcedExpandedKeys.add(String(ancestorKey || '')));
            }
            return visible;
        }

        const children = Array.isArray(rootNode?.children) ? rootNode.children : [];
        children.forEach((node) => visit(node, []));
    }

    function collectVisibleRows(nodes, level = 0, collector = []) {
        const hasTerm = Boolean(normalizeText(searchTerm));
        (nodes || []).forEach((node) => {
            if (!node || node.__visible !== true) return;
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            const isExpanded = hasTerm && hasChildren && forcedExpandedKeys.has(node.key);
            collector.push({ node, level, hasChildren, isExpanded });
            if (hasChildren && isExpanded) {
                collectVisibleRows(node.children || [], level + 1, collector);
            }
        });
        return collector;
    }

    function setActiveRow(index, options = {}) {
        const { scroll = true } = options;
        if (!keyboardRows.length || !branchListEl) {
            activeRowIndex = -1;
            return null;
        }

        const nextIndex = ((Number(index) % keyboardRows.length) + keyboardRows.length) % keyboardRows.length;
        activeRowIndex = nextIndex;
        const rowEls = Array.from(branchListEl.querySelectorAll('.start-menu-branch-row'));
        rowEls.forEach((rowEl, rowIndex) => {
            const isActive = rowIndex === nextIndex;
            rowEl.classList.toggle('is-active', isActive);
            rowEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
            if (isActive && scroll) rowEl.scrollIntoView({ block: 'nearest' });
        });

        return keyboardRows[nextIndex] || null;
    }

    function setActiveSubRow(index, options = {}) {
        const { scroll = true } = options;
        if (!subKeyboardRows.length || !subBranchListEl) {
            activeSubRowIndex = -1;
            return null;
        }

        const nextIndex = ((Number(index) % subKeyboardRows.length) + subKeyboardRows.length) % subKeyboardRows.length;
        activeSubRowIndex = nextIndex;
        const rowEls = Array.from(subBranchListEl.querySelectorAll('.start-menu-sub-branch-row'));
        rowEls.forEach((rowEl, rowIndex) => {
            const isActive = rowIndex === nextIndex;
            rowEl.classList.toggle('is-active', isActive);
            rowEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
            if (isActive && scroll) rowEl.scrollIntoView({ block: 'nearest' });
        });

        return subKeyboardRows[nextIndex] || null;
    }

    function renderSubBranchList(parentNode, options = {}) {
        if (!subBranchPanelEl || !subBranchListEl) return;
        const { pushStack = true, anchorEl = null, anchorRect = null } = options;
        const parent = parentNode || null;

        if (!parent) {
            hideSubBranchPanel();
            return;
        }

        const allChildren = Array.isArray(parent.children) ? parent.children : [];
        const visibleChildren = allChildren.filter((node) => node && node.__visible === true);
        if (!visibleChildren.length) {
            hideSubBranchPanel({ clearStack: false });
            return;
        }

        if (pushStack) {
            const parentKey = String(parent.key || '');
            const existingIndex = subBranchStack.findIndex((node) => String(node?.key || '') === parentKey);
            if (existingIndex >= 0) {
                subBranchStack = subBranchStack.slice(0, existingIndex + 1);
            } else {
                subBranchStack.push(parent);
            }
        }

        activeSubParentKey = String(parent.key || '');
        if (subBranchTitleEl) subBranchTitleEl.textContent = String(parent.title || parent.name || parent.id || 'Sub menu');
        if (subBranchPathEl) subBranchPathEl.textContent = String(parent.pathLabel || 'Browse deeper subsections');
        if (subBranchBackBtn) subBranchBackBtn.disabled = subBranchStack.length <= 1;
        if (subBranchEmptyEl) subBranchEmptyEl.classList.add('d-none');

        subBranchListEl.innerHTML = '';
        subKeyboardRows = [];
        activeSubRowIndex = -1;

        const fragment = document.createDocumentFragment();
        visibleChildren.forEach((node, index) => {
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            subKeyboardRows.push({ node, hasChildren });

            const targetUrl = nodeUrl(node);
            const btn = makeNavigableMenuElement('start-menu-sub-branch-row', targetUrl);
            btn.dataset.key = String(node.key || '');
            btn.dataset.index = String(index);
            btn.dataset.noWait = 'true';
            btn.setAttribute('role', 'treeitem');
            btn.setAttribute('aria-expanded', hasChildren ? 'false' : 'false');

            const arrow = hasChildren
                ? '<span class="start-menu-sub-branch-arrow"><i class="bi bi-chevron-right"></i></span>'
                : '<span class="start-menu-sub-branch-arrow"><i class="bi bi-dot"></i></span>';

            btn.innerHTML = `
                <span class="start-menu-sub-branch-icon">${renderIcon(node.icon)}</span>
                <span class="start-menu-sub-branch-main">
                    <span class="start-menu-sub-branch-name">${escapeAndHighlight(node.title || node.name || node.id || 'Section', searchTerm)}</span>
                    <span class="start-menu-sub-branch-sub">${escapeAndHighlight(node.pathLabel || '', searchTerm)}</span>
                </span>
                ${arrow}
            `;

            btn.addEventListener('mouseenter', () => {
                setActiveSubRow(index, { scroll: false });
            });
            btn.addEventListener('click', (event) => {
                setActiveSubRow(index, { scroll: false });
                if (hasChildren) {
                    if (hasNewTabIntent(event)) return;
                    event.preventDefault();
                    const anchorSnapshot = makeAnchorSnapshot(btn);
                    renderSubBranchList(node, { pushStack: true, anchorRect: anchorSnapshot });
                    return;
                }
                if (!targetUrl) event.preventDefault();
            });
            fragment.appendChild(btn);
        });

        subBranchListEl.appendChild(fragment);
        subBranchPanelEl.classList.remove('d-none');
        setActiveSubRow(0, { scroll: false });
        const targetAnchor = anchorRect || anchorEl || null;
        requestAnimationFrame(() => positionSubBranchPanel(targetAnchor));
    }

    function openSubBranchFromMain(node, options = {}) {
        const { anchorEl = null, anchorRect = null } = options;
        if (!node || !Array.isArray(node.children) || node.children.length === 0) {
            hideSubBranchPanel();
            return;
        }
        subBranchStack = [];
        renderSubBranchList(node, { pushStack: true, anchorEl, anchorRect });
    }

    function focusBranchSearch() {
        if (!branchSearchEl) return;
        window.setTimeout(() => {
            branchSearchEl.focus();
            branchSearchEl.select();
        }, 120);
    }

    function openQuickMenuFromDock() {
        const quickMenuModalEl = document.getElementById('quickMenuModal');
        if (!quickMenuModalEl || typeof bootstrap === 'undefined' || !bootstrap?.Modal) return;

        const showQuickMenuModal = () => {
            const quickMenuModal = bootstrap.Modal.getOrCreateInstance(quickMenuModalEl);
            quickMenuModal.show();
        };

        const isStartMenuOpen = modalEl.classList.contains('show');
        if (!isStartMenuOpen) {
            showQuickMenuModal();
            return;
        }

        const startMenuModal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modalEl.addEventListener('hidden.bs.modal', function onHidden() {
            window.setTimeout(showQuickMenuModal, 40);
        }, { once: true });
        startMenuModal.hide();
    }

    function setSelectedRoot(rootNode, options = {}) {
        const anchorEl = options.anchorEl || null;
        const root = rootNode || null;
        selectedRootKey = root ? String(root.key || '') : '';
        searchTerm = '';
        forcedExpandedKeys = new Set();
        keyboardRows = [];
        activeRowIndex = -1;
        if (branchSearchEl) branchSearchEl.value = '';
        hideSubBranchPanel();

        if (!root) {
            if (branchPanelEl) branchPanelEl.classList.add('d-none');
            applyDockSelectionUi();
            return;
        }

        if (branchPanelEl) branchPanelEl.classList.remove('d-none');
        if (branchTitleEl) branchTitleEl.textContent = String(root.title || root.name || root.id || 'Section');
        if (branchPathEl) branchPathEl.textContent = String(root.pathLabel || 'Browse subsections');
        if (branchOpenRootBtn) {
            syncStartMenuLinkState(branchOpenRootBtn, nodeUrl(root));
        }
        applyDockSelectionUi();
        renderBranchList();
        requestAnimationFrame(() => positionBranchPanel(anchorEl));
    }

    function renderDock() {
        if (!dockEl) return;
        dockEl.innerHTML = '';
        if (!rootNodes.length) {
            dockEl.classList.add('d-none');
            if (dockEmptyEl) dockEmptyEl.classList.remove('d-none');
            if (branchPanelEl) branchPanelEl.classList.add('d-none');
            return;
        }
        if (dockEmptyEl) dockEmptyEl.classList.add('d-none');
        dockEl.classList.remove('d-none');

        const fragment = document.createDocumentFragment();
        rootNodes.forEach((rootNode) => {
            const rootUrl = nodeUrl(rootNode);
            const btn = makeNavigableMenuElement('start-menu-dock-btn', rootUrl);
            btn.dataset.key = String(rootNode.key || '');
            btn.dataset.sectionName = String(rootNode.name || '').toUpperCase();
            btn.dataset.noWait = 'true';
            btn.setAttribute('role', 'listitem');
            btn.setAttribute('title', String(rootNode.title || rootNode.name || rootNode.id || 'Section'));
            btn.innerHTML = `
                <span class="start-menu-dock-icon">${renderIcon(rootNode.icon)}</span>
                <span class="start-menu-dock-label">${escapeHtml(rootNode.title || rootNode.name || rootNode.id || 'Section')}</span>
            `;
            btn.addEventListener('click', (event) => {
                if (hasNewTabIntent(event)) return;
                event.preventDefault();
                const alreadySelected = selectedRootKey === String(rootNode.key || '');
                setSelectedRoot(alreadySelected ? null : rootNode, { anchorEl: btn });
                if (!alreadySelected) focusBranchSearch();
            });
            fragment.appendChild(btn);
        });

        const divider = document.createElement('div');
        divider.className = 'start-menu-dock-divider';
        divider.setAttribute('aria-hidden', 'true');
        divider.dataset.noWait = 'true';
        fragment.appendChild(divider);

        const quickBtn = document.createElement('button');
        quickBtn.type = 'button';
        quickBtn.id = 'startMenuDockQuickMenuTrigger';
        quickBtn.className = 'start-menu-dock-btn start-menu-dock-btn--quick';
        quickBtn.dataset.key = 'QUICK_MENU';
        quickBtn.dataset.sectionName = 'QUICK_MENU';
        quickBtn.dataset.noWait = 'true';
        quickBtn.setAttribute('role', 'listitem');
        quickBtn.setAttribute('title', 'Quick Menu (Alt+Shift+Q)');
        quickBtn.setAttribute('aria-keyshortcuts', 'Alt+Shift+Q');
        quickBtn.innerHTML = `
            <span class="start-menu-dock-icon"><i class="bi bi-search"></i></span>
            <span class="start-menu-dock-label">Quick Menu</span>
        `;
        quickBtn.addEventListener('click', () => {
            openQuickMenuFromDock();
        });
        fragment.appendChild(quickBtn);

        dockEl.appendChild(fragment);
        setSelectedRoot(null);
    }

    function renderBranchList() {
        if (!branchListEl) return;
        branchListEl.innerHTML = '';
        keyboardRows = [];
        activeRowIndex = -1;

        const root = getSelectedRootNode();
        if (!root) {
            if (branchEmptyEl) {
                branchEmptyEl.classList.remove('d-none');
                branchEmptyEl.textContent = 'Select a module from the dock.';
            }
            return;
        }

        markVisibilityForSearch(root);
        const rows = collectVisibleRows(root.children || []);
        keyboardRows = rows;
        if (!rows.length) {
            if (branchEmptyEl) {
                branchEmptyEl.classList.remove('d-none');
                branchEmptyEl.textContent = searchTerm ? 'No items found for this search.' : 'No subsection is available.';
            }
            return;
        }
        if (branchEmptyEl) branchEmptyEl.classList.add('d-none');

        const fragment = document.createDocumentFragment();
        rows.forEach((row, index) => {
            const node = row.node;
            const hasChildren = row.hasChildren;
            const targetUrl = nodeUrl(node);
            const btn = makeNavigableMenuElement('start-menu-branch-row', targetUrl);
            btn.dataset.key = String(node.key || '');
            btn.dataset.index = String(index);
            btn.dataset.noWait = 'true';
            btn.style.paddingLeft = `${12 + (row.level * 16)}px`;
            btn.setAttribute('role', 'treeitem');
            btn.setAttribute('aria-expanded', hasChildren ? String(activeSubParentKey === String(node.key || '')) : 'false');
            if (activeSubParentKey && activeSubParentKey === String(node.key || '')) {
                btn.classList.add('is-active');
            }
            const arrow = hasChildren
                ? '<span class="start-menu-branch-arrow"><i class="bi bi-chevron-right"></i></span>'
                : '<span class="start-menu-branch-arrow"><i class="bi bi-dot"></i></span>';
            btn.innerHTML = `
                <span class="start-menu-branch-icon">${renderIcon(node.icon)}</span>
                <span class="start-menu-branch-main">
                    <span class="start-menu-branch-name">${escapeAndHighlight(node.title || node.name || node.id || 'Section', searchTerm)}</span>
                    <span class="start-menu-branch-sub">${escapeAndHighlight(node.pathLabel || '', searchTerm)}</span>
                </span>
                ${arrow}
            `;

            btn.addEventListener('mouseenter', () => {
                setActiveRow(index, { scroll: false });
            });
            btn.addEventListener('click', (event) => {
                setActiveRow(index, { scroll: false });
                if (hasChildren) {
                    if (hasNewTabIntent(event)) return;
                    event.preventDefault();
                    const anchorSnapshot = makeAnchorSnapshot(btn);
                    openSubBranchFromMain(node, { anchorRect: anchorSnapshot });
                    renderBranchList();
                    return;
                }
                hideSubBranchPanel();
                if (!targetUrl) event.preventDefault();
            });
            fragment.appendChild(btn);
        });
        branchListEl.appendChild(fragment);
        setActiveRow(0, { scroll: false });
    }

    async function loadStartMenu() {
        if (loadedOnce) {
            return;
        }
        loadedOnce = true;
        if (dockLoadingEl) dockLoadingEl.classList.remove('d-none');
        if (dockEl) dockEl.classList.add('d-none');
        if (dockEmptyEl) dockEmptyEl.classList.add('d-none');

        try {
            const res = await fetch('/sections/start-menu', { credentials: 'include' });
            const data = await res.json();
            if (!res.ok || data.status !== 'success') {
                throw new Error(data.message || 'Failed to load start menu.');
            }
            const allRoots = Array.isArray(data.sections) ? data.sections : [];
            rootNodes = allRoots.filter((node) => String(node?.name || '').toUpperCase() !== 'OTHER_SECTIONS');
            if (!rootNodes.length) rootNodes = allRoots;
            flattenNodes(rootNodes).forEach((node) => {
                node.__visible = true;
            });
            renderDock();
        } catch (error) {
            console.error('[StartMenu] Error:', error);
            rootNodes = [];
            if (dockEmptyEl) {
                dockEmptyEl.classList.remove('d-none');
                dockEmptyEl.textContent = 'Could not load modules.';
            }
            if (branchPanelEl) branchPanelEl.classList.add('d-none');
            hideSubBranchPanel();
        } finally {
            if (dockLoadingEl) dockLoadingEl.classList.add('d-none');
        }
    }

    function handleBranchSearchKeydown(event) {
        const current = keyboardRows[activeRowIndex];
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveRow(activeRowIndex + 1);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveRow(activeRowIndex - 1);
            return;
        }
        if (event.key === 'ArrowRight' && current?.hasChildren) {
            event.preventDefault();
            const activeMainRowEl = branchListEl
                ? branchListEl.querySelector(`.start-menu-branch-row[data-index="${activeRowIndex}"]`)
                : null;
            const anchorSnapshot = makeAnchorSnapshot(activeMainRowEl);
            openSubBranchFromMain(current.node, { anchorRect: anchorSnapshot });
            renderBranchList();
            return;
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            hideSubBranchPanel();
            renderBranchList();
            return;
        }
        if (event.key === 'Enter' && current) {
            event.preventDefault();
            if (current.hasChildren) {
                const activeMainRowEl = branchListEl
                    ? branchListEl.querySelector(`.start-menu-branch-row[data-index="${activeRowIndex}"]`)
                    : null;
                const anchorSnapshot = makeAnchorSnapshot(activeMainRowEl);
                openSubBranchFromMain(current.node, { anchorRect: anchorSnapshot });
                renderBranchList();
                return;
            }
            const targetUrl = String(current.node?.url || '').trim();
            if (targetUrl) window.location.assign(targetUrl);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.hide();
        }
    }

    function handleSubBranchKeydown(event) {
        const current = subKeyboardRows[activeSubRowIndex];
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveSubRow(activeSubRowIndex + 1);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveSubRow(activeSubRowIndex - 1);
            return;
        }
        if (event.key === 'ArrowRight' && current?.hasChildren) {
            event.preventDefault();
            const activeSubRowEl = subBranchListEl
                ? subBranchListEl.querySelector(`.start-menu-sub-branch-row[data-index="${activeSubRowIndex}"]`)
                : null;
            const anchorSnapshot = makeAnchorSnapshot(activeSubRowEl);
            renderSubBranchList(current.node, { pushStack: true, anchorRect: anchorSnapshot });
            return;
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            if (subBranchStack.length > 1) {
                subBranchStack = subBranchStack.slice(0, -1);
                const parentNode = subBranchStack[subBranchStack.length - 1] || null;
                renderSubBranchList(parentNode, { pushStack: false });
            } else {
                hideSubBranchPanel();
                renderBranchList();
                focusBranchSearch();
            }
            return;
        }
        if (event.key === 'Enter' && current) {
            event.preventDefault();
            if (current.hasChildren) {
                const activeSubRowEl = subBranchListEl
                    ? subBranchListEl.querySelector(`.start-menu-sub-branch-row[data-index="${activeSubRowIndex}"]`)
                    : null;
                const anchorSnapshot = makeAnchorSnapshot(activeSubRowEl);
                renderSubBranchList(current.node, { pushStack: true, anchorRect: anchorSnapshot });
                return;
            }
            const targetUrl = String(current.node?.url || '').trim();
            if (targetUrl) window.location.assign(targetUrl);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.hide();
        }
    }

    modalEl.addEventListener('show.bs.modal', async () => {
        await loadStartMenu();
    });

    modalEl.addEventListener('shown.bs.modal', () => {
        const backdrops = Array.from(document.querySelectorAll('.modal-backdrop'));
        if (backdrops.length > 0) {
            startMenuBackdropEl = backdrops[backdrops.length - 1];
            if (startMenuBackdropEl) startMenuBackdropEl.classList.add('start-menu-backdrop');
        }
        const selectedRoot = getSelectedRootNode();
        if (selectedRoot) {
            focusBranchSearch();
            requestAnimationFrame(() => positionBranchPanel());
        }
    });

    modalEl.addEventListener('hidden.bs.modal', () => {
        if (startMenuBackdropEl) {
            startMenuBackdropEl.classList.remove('start-menu-backdrop');
            startMenuBackdropEl = null;
        }
        setSelectedRoot(null);
    });

    if (branchSearchEl) {
        branchSearchEl.addEventListener('input', (event) => {
            searchTerm = String(event.target.value || '').trim();
            hideSubBranchPanel();
            renderBranchList();
        });
        branchSearchEl.addEventListener('keydown', handleBranchSearchKeydown);
    }

    if (branchOpenRootBtn) {
        branchOpenRootBtn.addEventListener('click', (event) => {
            if (branchOpenRootBtn.classList.contains('disabled') || branchOpenRootBtn.getAttribute('aria-disabled') === 'true') {
                event.preventDefault();
            }
        });
    }

    if (subBranchBackBtn) {
        subBranchBackBtn.addEventListener('click', () => {
            if (subBranchStack.length > 1) {
                subBranchStack = subBranchStack.slice(0, -1);
                const parentNode = subBranchStack[subBranchStack.length - 1] || null;
                renderSubBranchList(parentNode, { pushStack: false });
                return;
            }
            hideSubBranchPanel();
            renderBranchList();
            focusBranchSearch();
        });
    }

    if (subBranchPanelEl) {
        subBranchPanelEl.addEventListener('keydown', handleSubBranchKeydown);
    }

    window.addEventListener('resize', () => {
        requestAnimationFrame(() => positionBranchPanel());
    });

    if (dockEl) {
        dockEl.addEventListener('scroll', () => {
            requestAnimationFrame(() => positionBranchPanel());
        }, { passive: true });
    }

    if (branchListEl) {
        branchListEl.addEventListener('scroll', () => {
            requestAnimationFrame(() => positionSubBranchPanel());
        }, { passive: true });
    }
}
//#endregion

//#region 7. UI: Domain Button Waiting State
// =============================================================================
function initScopedButtonWaitingState(options = {}) {
    const pathName = String(window.location.pathname || '').trim().toLowerCase();
    const scopePaths = Array.isArray(options.pathPrefixes) ? options.pathPrefixes : [];
    const applyGlobally = scopePaths.length === 0;
    const matchesScope = applyGlobally || scopePaths.some((prefix) => {
        const normalizedPrefix = String(prefix || '').trim().toLowerCase();
        if (!normalizedPrefix) return false;
        if (normalizedPrefix === '/' || normalizedPrefix === '/*') return true;
        return pathName.startsWith(normalizedPrefix);
    });
    if (!matchesScope) return;
    const waitingRestoreHooks = new WeakMap();

    function initGlobalAjaxIdleTracker() {
        if (window.__appWaitingAjaxTrackerInitialized === true) return;
        window.__appWaitingAjaxTrackerInitialized = true;
        window.__appWaitingPendingFetchCount = 0;
        if (typeof window.fetch !== 'function') return;

        const nativeFetch = window.fetch.bind(window);
        window.fetch = function (...args) {
            window.__appWaitingPendingFetchCount = Number(window.__appWaitingPendingFetchCount || 0) + 1;
            const settle = () => {
                const remaining = Math.max(0, Number(window.__appWaitingPendingFetchCount || 0) - 1);
                window.__appWaitingPendingFetchCount = remaining;
                if (remaining === 0) {
                    window.dispatchEvent(new CustomEvent('app:ajax-idle'));
                }
            };
            try {
                const responsePromise = nativeFetch(...args);
                return Promise.resolve(responsePromise).finally(settle);
            } catch (error) {
                settle();
                throw error;
            }
        };
    }

    initGlobalAjaxIdleTracker();

    function buildInlineWaitingMarkup(waitText) {
        const text = String(waitText || 'Please wait...').trim() || 'Please wait...';
        return `<span class="app-inline-wait d-inline-flex align-items-center gap-2"><span class="spinner-border spinner-border-sm app-inline-wait-spinner" role="status" aria-hidden="true"></span><span class="app-inline-wait-label">${text}</span></span>`;
    }

    function hasSpinnerMarkup(el) {
        if (!el) return false;
        if (el.tagName === 'INPUT') {
            const value = String(el.value || '').toLowerCase();
            return value.includes('[~]');
        }
        const html = String(el.innerHTML || '').toLowerCase();
        return html.includes('spinner-border') || html.includes('app-inline-wait');
    }

    function resolveElement(target) {
        if (!target) return null;
        if (target instanceof Element) return target;
        if (typeof target === 'string') return document.querySelector(target);
        return null;
    }

    function setWaitingState(el, waitText) {
        if (!el || el.dataset.waitingStateApplied === '1') return;
        if (hasSpinnerMarkup(el)) return;
        const text = String(waitText || 'Please wait...').trim() || 'Please wait...';
        el.dataset.waitingStateApplied = '1';
        const width = el.getBoundingClientRect ? Math.ceil(el.getBoundingClientRect().width) : 0;
        if (width > 0 && !el.style.minWidth) el.style.minWidth = `${width}px`;
        el.classList.add('disabled');

        if (el.tagName === 'BUTTON') {
            el.dataset.waitingOriginalHtml = el.innerHTML;
            el.dataset.waitingOriginalDisabled = el.disabled ? '1' : '0';
            el.disabled = true;
            el.innerHTML = buildInlineWaitingMarkup(text);
            el.classList.add('app-inline-waiting-control');
            return;
        }
        if (el.tagName === 'INPUT') {
            el.dataset.waitingOriginalValue = el.value || '';
            el.dataset.waitingOriginalDisabled = el.disabled ? '1' : '0';
            el.disabled = true;
            el.value = `[~] ${text}`;
            el.classList.add('app-inline-waiting-control');
            return;
        }
        if (el.tagName === 'A') {
            el.dataset.waitingOriginalHtml = el.innerHTML;
            el.dataset.waitingOriginalPointerEvents = el.style.pointerEvents || '';
            el.setAttribute('aria-disabled', 'true');
            el.style.pointerEvents = 'none';
            el.innerHTML = buildInlineWaitingMarkup(text);
            el.classList.add('app-inline-waiting-control');
        }
    }

    function restoreWaitingState(el) {
        if (!el || el.dataset.waitingStateApplied !== '1') return;

        const timerId = Number.parseInt(String(el.dataset.waitingStateTimerId || ''), 10);
        if (Number.isFinite(timerId) && timerId > 0) {
            window.clearTimeout(timerId);
        }

        if (el.tagName === 'BUTTON') {
            if (Object.prototype.hasOwnProperty.call(el.dataset, 'waitingOriginalHtml')) {
                el.innerHTML = el.dataset.waitingOriginalHtml;
            }
            el.disabled = String(el.dataset.waitingOriginalDisabled || '0') === '1';
        } else if (el.tagName === 'INPUT') {
            if (Object.prototype.hasOwnProperty.call(el.dataset, 'waitingOriginalValue')) {
                el.value = el.dataset.waitingOriginalValue;
            }
            el.disabled = String(el.dataset.waitingOriginalDisabled || '0') === '1';
        } else if (el.tagName === 'A') {
            if (Object.prototype.hasOwnProperty.call(el.dataset, 'waitingOriginalHtml')) {
                el.innerHTML = el.dataset.waitingOriginalHtml;
            }
            const originalPointer = String(el.dataset.waitingOriginalPointerEvents || '');
            el.style.pointerEvents = originalPointer;
            el.removeAttribute('aria-disabled');
        }

        delete el.dataset.waitingStateApplied;
        delete el.dataset.waitingOriginalHtml;
        delete el.dataset.waitingOriginalValue;
        delete el.dataset.waitingOriginalDisabled;
        delete el.dataset.waitingOriginalPointerEvents;
        delete el.dataset.waitingStateTemporary;
        delete el.dataset.waitingStateTimerId;
        el.classList.remove('disabled');
        el.classList.remove('app-inline-waiting-control');

        const onRestore = waitingRestoreHooks.get(el);
        waitingRestoreHooks.delete(el);
        if (typeof onRestore === 'function') {
            try {
                onRestore(el);
            } catch (err) {
                console.warn('[appWaiting] Restore hook failed:', err);
            }
        }
    }

    function setTemporaryWaitingState(el, waitText, timeoutMs, onRestore = null) {
        if (!el || el.dataset.waitingStateApplied === '1') return;
        const restoreDelay = Number(timeoutMs);
        if (typeof onRestore === 'function') waitingRestoreHooks.set(el, onRestore);
        setWaitingState(el, waitText);
        if (el.dataset.waitingStateApplied !== '1') return;
        el.dataset.waitingStateTemporary = '1';
        if (Number.isFinite(restoreDelay) && restoreDelay > 0) {
            const timerId = window.setTimeout(() => {
                if (!el.isConnected) return;
                if (el.dataset.waitingStateTemporary !== '1') return;
                restoreWaitingState(el);
            }, restoreDelay);
            el.dataset.waitingStateTimerId = String(timerId);
        }
    }

    function shouldSkipAnchor(anchor, clickEvent) {
        if (!anchor) return true;
        if (anchor.dataset.noWait === 'true') return true;
        if (anchor.classList.contains('btn-copy-key')) return true;
        if (anchor.classList.contains('dropdown-toggle')) return true;
        if (anchor.classList.contains('nav-link')) return true;
        if (anchor.hasAttribute('download')) return true;
        if (anchor.hasAttribute('data-bs-toggle') || anchor.hasAttribute('data-bs-target')) return true;
        if (String(anchor.getAttribute('target') || '').toLowerCase() === '_blank') return true;
        if (clickEvent && (clickEvent.metaKey || clickEvent.ctrlKey || clickEvent.shiftKey || clickEvent.altKey)) return true;
        if (clickEvent && clickEvent.button !== 0) return true;
        const href = String(anchor.getAttribute('href') || '').trim();
        if (!href || href === '#' || href.startsWith('javascript:')) return true;
        if (href.startsWith('#')) return true;
        return false;
    }

    function shouldSkipButton(button, clickEvent) {
        if (!button) return true;
        if (button.dataset.noWait === 'true') return true;
        const busyMode = String(button.dataset.busyMode || '').trim().toLowerCase();
        if (busyMode === 'disable-only' || busyMode === 'no-spinner') return true;
        if (button.matches('[data-pte-showcase-prev], [data-pte-showcase-next], [data-pte-showcase-toggle]')) return true;
        if (button.classList.contains('pte-showcase-control-btn')) return true;
        if (button.classList.contains('carousel-control-prev') || button.classList.contains('carousel-control-next')) return true;
        if (button.hasAttribute('data-bs-slide') || button.hasAttribute('data-bs-slide-to')) return true;
        if (button.disabled) return true;
        if (button.classList.contains('btn-close')) return true;
        if (button.classList.contains('dropdown-toggle')) return true;
        if (button.classList.contains('btn-row-actions-toggle')) return true;
        if (button.classList.contains('view-btn')) return true;
        if (button.classList.contains('js-open-advanced-search')) return true;
        if (button.classList.contains('btn-copy-key')) return true;
        if (button.hasAttribute('data-bs-toggle') || button.hasAttribute('data-bs-target')) return true;
        if (button.hasAttribute('data-bs-dismiss')) return true;

        const type = String(button.getAttribute('type') || '').trim().toLowerCase();
        if (type === 'submit' || type === 'reset') return true;
        if (clickEvent && (clickEvent.metaKey || clickEvent.ctrlKey || clickEvent.shiftKey || clickEvent.altKey)) return true;
        if (clickEvent && clickEvent.button !== 0) return true;

        if (String(button.innerHTML || '').toLowerCase().includes('spinner-border')) return true;
        return false;
    }

    function getActionHintText(el) {
        return [
            String(el?.id || ''),
            String(el?.className || ''),
            String(el?.dataset?.waitText || ''),
            String(el?.textContent || ''),
            String(el?.value || '')
        ]
            .join(' ')
            .toLowerCase();
    }

    function shouldAutoWaitButton(button) {
        if (!button) return false;
        if (String(button.dataset.waitText || '').trim()) return true;
        const hint = getActionHintText(button);
        const actionPattern = /(save|submit|delete|remove|archive|restore|recover|create|clone|duplicate|import|export|process|run|generate|calculate|analy|reload|refresh|load|apply|confirm|finish|start|upload|sync|retry)/i;
        return actionPattern.test(hint);
    }

    function computeButtonWaitText(button) {
        const explicit = String(button?.dataset?.waitText || '').trim();
        if (explicit) return explicit;
        const hint = getActionHintText(button);
        if (/(delete|remove)/i.test(hint)) return 'Deleting...';
        if (/(archive)/i.test(hint)) return 'Archiving...';
        if (/(restore|recover|unarchive)/i.test(hint)) return 'Restoring...';
        if (/(save|submit)/i.test(hint)) return 'Saving...';
        if (/(cancel|close)/i.test(hint)) return 'Cancelling...';
        if (/(back|return|previous|prev)/i.test(hint)) return 'Returning...';
        if (/(create|clone|duplicate)/i.test(hint)) return 'Creating...';
        if (/(import)/i.test(hint)) return 'Importing...';
        if (/(export|download)/i.test(hint)) return 'Exporting...';
        if (/(upload)/i.test(hint)) return 'Uploading...';
        if (/(sync)/i.test(hint)) return 'Syncing...';
        if (/(retry)/i.test(hint)) return 'Retrying...';
        if (/(reload|refresh|load)/i.test(hint)) return 'Loading...';
        return String(options.defaultButtonWaitText || '').trim() || 'Working...';
    }

    function computeAnchorWaitText(anchor) {
        const explicit = String(anchor?.dataset?.waitText || '').trim();
        if (explicit) return explicit;
        const hint = getActionHintText(anchor);
        if (/(delete|remove)/i.test(hint)) return 'Deleting...';
        if (/(archive)/i.test(hint)) return 'Archiving...';
        if (/(restore|recover|unarchive)/i.test(hint)) return 'Restoring...';
        if (/(save|submit|apply|confirm)/i.test(hint)) return 'Saving...';
        if (/(cancel|close)/i.test(hint)) return 'Cancelling...';
        if (/(back|return|previous|prev)/i.test(hint)) return 'Returning...';
        if (/(next|continue|proceed)/i.test(hint)) return 'Loading...';
        if (/(import)/i.test(hint)) return 'Importing...';
        if (/(export|download)/i.test(hint)) return 'Exporting...';
        if (/(upload)/i.test(hint)) return 'Uploading...';
        if (/(sync)/i.test(hint)) return 'Syncing...';
        if (/(retry)/i.test(hint)) return 'Retrying...';
        if (/(reload|refresh|load|open|view)/i.test(hint)) return 'Loading...';
        return String(options.defaultAnchorWaitText || '').trim() || 'Opening...';
    }

    function computeSubmitWaitText(submitter) {
        const submitAction = String(submitter?.value || '').trim().toLowerCase();
        const formAction = String(submitter?.getAttribute?.('formaction') || '').toLowerCase();
        const submitHint = [
            submitAction,
            String(submitter?.textContent || ''),
            String(submitter?.id || ''),
            String(submitter?.className || '')
        ].join(' ').toLowerCase();

        if (/(cancel|close)/i.test(submitHint)) return 'Cancelling...';
        if (/(back|return|previous|prev)/i.test(submitHint)) return 'Returning...';
        if (/(next|continue|proceed)/i.test(submitHint)) return 'Loading...';
        if (submitAction === 'submit') return 'Submitting...';
        if (submitAction === 'save') return 'Saving...';
        if (formAction.includes('/lock/')) return 'Locking...';
        return String(submitter?.dataset?.waitText || '').trim()
            || String(options.defaultSubmitWaitText || '').trim()
            || 'Processing...';
    }

    function disableSiblingSubmitButtons(form, submitter) {
        if (!form) return;
        form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach((node) => {
            if (node === submitter) return;
            if (node.dataset.waitingSiblingDisabled !== '1') {
                node.dataset.waitingSiblingDisabled = '1';
                node.dataset.waitingSiblingOriginalDisabled = node.disabled ? '1' : '0';
            }
            node.disabled = true;
        });
    }

    function restoreSiblingSubmitButtons(form) {
        if (!form) return;
        form.querySelectorAll('[data-waiting-sibling-disabled="1"]').forEach((node) => {
            node.disabled = String(node.dataset.waitingSiblingOriginalDisabled || '0') === '1';
            delete node.dataset.waitingSiblingDisabled;
            delete node.dataset.waitingSiblingOriginalDisabled;
        });
    }

    function restoreTemporaryWaitingStates() {
        document.querySelectorAll('[data-waiting-state-temporary="1"]').forEach((node) => {
            restoreWaitingState(node);
        });
        document.querySelectorAll('form').forEach((currentForm) => {
            restoreSiblingSubmitButtons(currentForm);
        });
    }

    window.appWaiting = {
        set(target, waitText = 'Please wait...') {
            const el = resolveElement(target);
            if (!el) return false;
            setWaitingState(el, waitText);
            return el.dataset.waitingStateApplied === '1';
        },
        setTemporary(target, waitText = 'Please wait...', timeoutMs = 3500) {
            const el = resolveElement(target);
            if (!el) return false;
            setTemporaryWaitingState(el, waitText, timeoutMs);
            return el.dataset.waitingStateApplied === '1';
        },
        clear(target) {
            const el = resolveElement(target);
            if (!el) return false;
            restoreWaitingState(el);
            return true;
        },
        clearAll() {
            document.querySelectorAll('[data-waiting-state-applied="1"]').forEach((node) => {
                restoreWaitingState(node);
            });
            document.querySelectorAll('form').forEach((currentForm) => {
                restoreSiblingSubmitButtons(currentForm);
            });
        }
    };

    document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const submitter = event.submitter
            || form.querySelector('button[type="submit"], input[type="submit"]');
        if (!submitter) return;
        if (submitter.dataset.noWait === 'true') return;

        if (!form.isConnected) return;
        if (hasSpinnerMarkup(submitter)) return;

        const waitText = computeSubmitWaitText(submitter);
        const isCustomAjaxSubmit = event.defaultPrevented === true;
        if (isCustomAjaxSubmit) {
            const customSubmitAutoRestoreMs = Number(options.customSubmitAutoRestoreMs);
            const restoreMs = Number.isFinite(customSubmitAutoRestoreMs) && customSubmitAutoRestoreMs > 0
                ? customSubmitAutoRestoreMs
                : 12000;
            setTemporaryWaitingState(submitter, waitText, restoreMs, () => restoreSiblingSubmitButtons(form));
            disableSiblingSubmitButtons(form, submitter);
            return;
        }

        setWaitingState(submitter, waitText);
        disableSiblingSubmitButtons(form, submitter);
    });

    document.addEventListener('click', (event) => {
        // Let page-level click handlers run first. If they prevent default or stop
        // propagation, we avoid injecting global wait markup that can conflict with
        // page-specific async button/link states.
        if (event.defaultPrevented) return;
        const anchor = event.target.closest('a.btn, a.dropdown-item, a[data-wait-text], a[data-app-wait]');
        if (!anchor) return;
        if (shouldSkipAnchor(anchor, event)) return;
        if (hasSpinnerMarkup(anchor)) return;
        const waitText = computeAnchorWaitText(anchor);
        const anchorAutoRestoreMs = Number(options.anchorAutoRestoreMs);
        setTemporaryWaitingState(anchor, waitText, Number.isFinite(anchorAutoRestoreMs) ? anchorAutoRestoreMs : 5000);
    });

    if (options.enableActionButtons === true) {
        document.addEventListener('click', (event) => {
            if (event.defaultPrevented) return;
            const button = event.target.closest('button, input[type="button"]');
            if (!button) return;
            if (shouldSkipButton(button, event)) return;
            if (!shouldAutoWaitButton(button)) return;
            if (hasSpinnerMarkup(button)) return;
            const waitText = computeButtonWaitText(button);
            const autoRestoreMs = Number(options.buttonAutoRestoreMs);
            setTemporaryWaitingState(button, waitText, Number.isFinite(autoRestoreMs) ? autoRestoreMs : 3500);
        });
    }

    window.addEventListener('app:ajax-idle', () => {
        window.setTimeout(() => {
            if (Number(window.__appWaitingPendingFetchCount || 0) !== 0) return;
            restoreTemporaryWaitingStates();
        }, 90);
    });
}

function initHeaderShortcuts() {
    function isEditableTarget(target) {
        if (!target || !(target instanceof Element)) return false;
        if (target.closest('input, textarea, select')) return true;
        if (target.closest('[contenteditable="true"]')) return true;
        const role = String(target.getAttribute('role') || '').toLowerCase();
        if (role === 'textbox') return true;
        return false;
    }

    function triggerElement(el) {
        if (!el || !(el instanceof HTMLElement)) return;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }

    document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) return;
        if (event.repeat) return;
        if (event.ctrlKey || event.metaKey) return;
        if (!(event.altKey && event.shiftKey)) return;
        if (isEditableTarget(event.target)) return;

        const key = String(event.key || '').toLowerCase();
        if (!key) return;

        if (key === 'd') {
            const dashboardTrigger = document.getElementById('headerDashboardTrigger');
            if (!dashboardTrigger) return;
            event.preventDefault();
            triggerElement(dashboardTrigger);
            return;
        }

        if (key === 'q') {
            const quickMenuTrigger = document.getElementById('headerQuickMenuTrigger') || document.querySelector('.search-btn[data-bs-target="#quickMenuModal"]');
            event.preventDefault();
            if (quickMenuTrigger) {
                triggerElement(quickMenuTrigger);
                return;
            }
            const quickMenuModalEl = document.getElementById('quickMenuModal');
            if (quickMenuModalEl && typeof bootstrap !== 'undefined' && bootstrap?.Modal) {
                const quickMenuModal = bootstrap.Modal.getOrCreateInstance(quickMenuModalEl);
                quickMenuModal.show();
            }
            return;
        }

        if (key === 's') {
            const startMenuTrigger = document.getElementById('headerStartMenuTrigger') || document.querySelector('.search-btn[data-bs-target="#startMenuModal"]');
            if (!startMenuTrigger) return;
            event.preventDefault();
            triggerElement(startMenuTrigger);
            return;
        }

        if (key === 'c') {
            const chatTrigger = document.getElementById('chatGlobalTrigger');
            if (!chatTrigger) return;
            event.preventDefault();
            triggerElement(chatTrigger);
            return;
        }

        if (key === 'o') {
            const orgSwitchTrigger = document.getElementById('orgSwitchQuickButton');
            if (!orgSwitchTrigger) return;
            event.preventDefault();
            triggerElement(orgSwitchTrigger);
        }
    });
}

function initGlobalButtonWaitingState() {
    initScopedButtonWaitingState({
        pathPrefixes: ['/'],
        defaultSubmitWaitText: 'Processing...',
        defaultAnchorWaitText: 'Opening...',
        defaultButtonWaitText: 'Working...',
        enableActionButtons: true,
        anchorAutoRestoreMs: 5000,
        buttonAutoRestoreMs: 5000,
        customSubmitAutoRestoreMs: 5000
    });
}
//#endregion

//#region 7. Initialization (Main Entry Point)
// =============================================================================
document.addEventListener('DOMContentLoaded', function () {
    // Failsafe hiding of loader
    setTimeout(() => hideLoading({ force: true }), 2000);
    
    initAppZoomControls();
    initAppFontControls();
    initAppPageWidthControls();
    initHeaderInteractions();
    initHeaderApplicationMenu();
    initHeaderShortcuts();
    initGlobalActions();
    initFloatingRowActionMenus();
    initSmallScreenActionDropdownFix();
    initGlobalButtonWaitingState();
    
    // ✅ Initialize Quick Menu
    initQuickMenu();
    initStartMenu();

    // Table Fit Toggle
    const toggle = document.getElementById('tableFitToggle');
    const wrapper = document.querySelector('.table-scroll-wrapper');
    if (toggle && wrapper) {
        toggle.addEventListener('change', function () {
            wrapper.classList.toggle('fit-mode', this.checked);
        });
    }
});
//#endregion
