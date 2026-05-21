(function initMediaManagerModal(windowObj) {
  if (!windowObj || windowObj.MediaManagerModal) return;

  const modalEl = document.getElementById('mediaManagerModal');
  if (!modalEl) {
    windowObj.MediaManagerModal = {
      open: async () => false,
      close: () => false,
      setRows: () => {},
      appendRows: () => {},
      setDefaultPageSize: () => {},
      setView: () => {},
      setModalCompat: () => {}
    };
    return;
  }

  const libraryContent = document.getElementById('mediaManagerLibraryContent');
  const libraryEmpty = document.getElementById('mediaManagerLibraryEmpty');
  const titleEl = document.getElementById('mediaManagerTitle');
  const contextBadge = document.getElementById('mediaManagerContextBadge');
  const mediaKindBadge = document.getElementById('mediaManagerMediaKindBadge');
  const scopeHintEl = document.getElementById('mediaManagerScopeHint');
  const alertEl = document.getElementById('mediaManagerAlert');
  const applyBtn = document.getElementById('mediaManagerApplyBtn');
  const refreshBtn = document.getElementById('mediaManagerRefreshBtn');
  const statusEl = document.getElementById('mediaManagerSelectionStatus');
  const searchInputEl = document.getElementById('mediaManagerSearchInput');
  const searchClearBtn = document.getElementById('mediaManagerSearchClearBtn');
  const paginationSummaryEl = document.getElementById('mediaManagerPaginationSummary');
  const pageSizeSelectEl = document.getElementById('mediaManagerPageSizeSelect');
  const viewAllToggleEl = document.getElementById('mediaManagerViewAllToggle');
  const prevPageBtn = document.getElementById('mediaManagerPrevPageBtn');
  const nextPageBtn = document.getElementById('mediaManagerNextPageBtn');
  const pageIndicatorEl = document.getElementById('mediaManagerPageIndicator');
  const folderUpBtn = document.getElementById('mediaManagerFolderUpBtn');
  const baseFolderBadgeEl = document.getElementById('mediaManagerBaseFolderBadge');
  const folderSelectEl = document.getElementById('mediaManagerFolderSelect');
  const currentFolderLabelEl = document.getElementById('mediaManagerCurrentFolderLabel');
  const uploadInput = document.getElementById('mediaManagerUploadInput');
  const uploadSelectBtn = document.getElementById('mediaManagerUploadSelectBtn');
  const uploadSpinner = document.getElementById('mediaManagerUploadSpinner');
  const uploadZone = document.getElementById('mediaManagerUploadZone');
  const libraryTabBtn = document.getElementById('mediaManagerLibraryTabBtn');
  const viewButtons = Array.from(modalEl.querySelectorAll('[data-media-view]'));

  const state = {
    rows: [],
    view: 'tile',
    searchQuery: '',
    page: 1,
    pageSizeDefault: 30,
    pageSize: 30,
    viewAll: false,
    pageSizePinnedByUser: false,
    context: {
      mode: 'attach',
      mediaKind: 'any',
      maxSelection: 10,
      title: 'Media Manager',
      defaultView: 'tile',
      defaultPageSize: 30,
      scopeFolder: '',
      onApply: null,
      onUpload: null,
      onRefresh: null
    },
    selectedKeys: new Set(),
    compat: null,
    bootstrapModal: null,
    currentFolder: '',
    scopeFolder: '',
    defaultFolder: '',
    parentFolder: '',
    folderOptions: []
  };

  const FALLBACK_BACKDROP_SELECTOR = '.modal-backdrop.media-manager-fallback-backdrop';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cleanText(value) {
    return String(value || '').replace(/\0/g, '').trim();
  }

  function normalizeFolderPath(value) {
    const raw = cleanText(value).replace(/\\/g, '/');
    if (!raw || raw === '/' || raw === '.') return '';
    const compact = raw
      .split('/')
      .map((part) => cleanText(part))
      .filter(Boolean)
      .join('/');
    if (!compact || compact === '.') return '';
    return compact.replace(/^\/+/, '').replace(/\/+$/, '');
  }

  function toPositiveInt(value, fallback = 0) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  function clampPageSize(value, fallback = 30) {
    const parsed = toPositiveInt(value, fallback);
    if (parsed <= 0) return Math.max(5, fallback);
    return Math.max(5, Math.min(1000, parsed));
  }

  function resolveRowSortRank(row = {}) {
    const uploadDate = cleanText(row.uploadDate);
    const parsedDate = uploadDate ? new Date(uploadDate) : null;
    const timestamp = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getTime() : 0;
    if (timestamp > 0) return timestamp;
    const idToken = cleanText(row.id || row.key);
    const numeric = Number.parseInt((idToken.match(/\d+/g) || []).join(''), 10);
    if (Number.isFinite(numeric) && !Number.isNaN(numeric)) return numeric;
    return 0;
  }

  function normalizeUrlToken(value) {
    const token = cleanText(value);
    if (!token) return '';
    if (/^https?:\/\//i.test(token)) return token;
    if (/^\/uploads\//i.test(token)) return token;
    if (/^uploads\//i.test(token)) return `/${token}`;
    return token;
  }

  function deriveUrlFromPath(filePath) {
    const normalizedPath = cleanText(filePath).replace(/\\/g, '/');
    if (!normalizedPath) return '';
    const uploadsMatch = normalizedPath.match(/\/uploads\/(.+)$/i);
    if (uploadsMatch && uploadsMatch[1]) {
      return `/uploads/${uploadsMatch[1].replace(/^\/+/, '')}`;
    }
    if (/^\/uploads\//i.test(normalizedPath)) return normalizedPath;
    if (/^uploads\//i.test(normalizedPath)) return `/${normalizedPath}`;
    return '';
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx += 1;
    }
    return `${size.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
  }

  function formatDateTime(iso) {
    const token = cleanText(iso);
    if (!token) return '-';
    const parsed = new Date(token);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString();
  }

  function getFileExt(name) {
    const token = cleanText(name).toLowerCase();
    const dot = token.lastIndexOf('.');
    if (dot < 0) return '';
    return token.slice(dot + 1);
  }

  function detectRowKind(row = {}) {
    const mime = cleanText(row.mimeType).toLowerCase();
    const ext = getFileExt(row.filename || row.originalName || row.name || row.path || row.url);
    const imageExt = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico']);
    const audioExt = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'webm', 'flac']);
    if (mime.startsWith('image/') || imageExt.has(ext)) return 'image';
    if (mime.startsWith('audio/') || audioExt.has(ext)) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'file';
  }

  function rowKey(row = {}, index = 0) {
    return cleanText(row.id)
      || cleanText(row.path)
      || cleanText(row.url)
      || cleanText(row.filename)
      || `ROW_${index + 1}`;
  }

  function normalizeRow(raw, index) {
    const row = raw && typeof raw === 'object' ? raw : {};
    const key = rowKey(row, index);
    const normalizedPath = cleanText(row.path).replace(/\\/g, '/');
    const directUrl = normalizeUrlToken(
      row.url || row.downloadUrl || row.publicUrl || row.fileUrl || row.previewUrl
    );
    const derivedUrl = deriveUrlFromPath(normalizedPath);
    const normalized = {
      id: cleanText(row.id) || key,
      key,
      name: cleanText(row.name) || cleanText(row.originalName) || cleanText(row.filename) || `File ${index + 1}`,
      originalName: cleanText(row.originalName) || cleanText(row.name) || cleanText(row.filename),
      filename: cleanText(row.filename) || cleanText(row.name) || cleanText(row.originalName),
      path: normalizedPath,
      url: directUrl || derivedUrl,
      mimeType: cleanText(row.mimeType),
      size: Number(row.size || 0) || 0,
      uploadDate: cleanText(row.uploadDate),
      source: cleanText(row.source) || 'library'
    };
    normalized.kind = detectRowKind(normalized);
    return normalized;
  }

  function isRowCompatible(row, mediaKind) {
    const kind = cleanText(mediaKind || 'any').toLowerCase();
    if (kind === 'any') return true;
    if (kind === 'audio') return row.kind === 'audio';
    if (kind === 'image') return row.kind === 'image';
    return true;
  }

  function getCompatibleRows() {
    return state.rows.filter((row) => isRowCompatible(row, state.context.mediaKind));
  }

  function getSearchFilteredRows() {
    const rows = getCompatibleRows();
    const q = cleanText(state.searchQuery).toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.name,
        row.originalName,
        row.filename,
        row.path,
        row.url,
        row.mimeType,
        row.kind
      ]
        .map((item) => cleanText(item).toLowerCase())
        .join(' ');
      return haystack.includes(q);
    });
  }

  function ensurePageBounds(totalRows = 0) {
    const total = Math.max(0, Number(totalRows || 0) || 0);
    if (state.viewAll) {
      state.page = 1;
      return { totalPages: 1, start: total ? 1 : 0, end: total };
    }
    const pageSize = clampPageSize(state.pageSize, state.pageSizeDefault);
    state.pageSize = pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    state.page = Math.max(1, Math.min(totalPages, toPositiveInt(state.page, 1)));
    const start = total ? ((state.page - 1) * pageSize) + 1 : 0;
    const end = total ? Math.min(total, start + pageSize - 1) : 0;
    return { totalPages, start, end };
  }

  function getVisibleRows() {
    const filtered = getSearchFilteredRows();
    if (state.viewAll) {
      const range = ensurePageBounds(filtered.length);
      return { rows: filtered, filtered, totalRows: filtered.length, totalPages: range.totalPages, start: range.start, end: range.end };
    }
    const range = ensurePageBounds(filtered.length);
    const startIndex = Math.max(0, (state.page - 1) * state.pageSize);
    const endIndex = startIndex + state.pageSize;
    return {
      rows: filtered.slice(startIndex, endIndex),
      filtered,
      totalRows: filtered.length,
      totalPages: range.totalPages,
      start: range.start,
      end: range.end
    };
  }

  function renderPaginationState(totalRows = 0, totalPages = 1, start = 0, end = 0) {
    if (paginationSummaryEl) {
      paginationSummaryEl.textContent = totalRows
        ? `Showing ${start}-${end} of ${totalRows}`
        : 'Showing 0 of 0';
    }
    if (pageIndicatorEl) {
      pageIndicatorEl.textContent = state.viewAll
        ? 'View all'
        : `Page ${state.page} of ${Math.max(1, totalPages)}`;
    }
    if (prevPageBtn) {
      prevPageBtn.disabled = state.viewAll || state.page <= 1 || totalRows <= 0;
    }
    if (nextPageBtn) {
      nextPageBtn.disabled = state.viewAll || state.page >= Math.max(1, totalPages) || totalRows <= 0;
    }
    if (pageSizeSelectEl && String(pageSizeSelectEl.value) !== String(state.pageSize)) {
      pageSizeSelectEl.value = String(state.pageSize);
    }
    if (viewAllToggleEl) {
      viewAllToggleEl.checked = Boolean(state.viewAll);
    }
  }

  function getSelectedRows() {
    const selected = state.selectedKeys;
    return getCompatibleRows().filter((row) => selected.has(row.key));
  }

  function showAlert(message, tone = 'info') {
    if (!alertEl) return;
    const safeMessage = cleanText(message);
    if (!safeMessage) {
      alertEl.classList.add('d-none');
      alertEl.textContent = '';
      alertEl.className = 'alert alert-light border py-2 small d-none mt-2 mb-2';
      return;
    }
    const cls = tone === 'error'
      ? 'alert-danger'
      : (tone === 'warning' ? 'alert-warning' : (tone === 'success' ? 'alert-success' : 'alert-light'));
    alertEl.className = `alert border py-2 small mt-2 mb-2 ${cls}`;
    alertEl.textContent = safeMessage;
    alertEl.classList.remove('d-none');
  }

  function refreshStatus() {
    const selectedCount = getSelectedRows().length;
    const cap = Math.max(1, Number(state.context.maxSelection || 1));
    if (statusEl) {
      if (!selectedCount) {
        statusEl.textContent = `Select file(s) to continue. Limit ${cap}.`;
      } else {
        statusEl.textContent = `${selectedCount} selected (limit ${cap}). Double-click to preview.`;
      }
    }
    if (applyBtn) applyBtn.disabled = selectedCount <= 0;
  }

  function syncSelectionUi() {
    if (!libraryContent) return;
    const selected = state.selectedKeys;
    libraryContent.querySelectorAll('[data-media-action="select"]').forEach((node) => {
      const key = cleanText(node.getAttribute('data-media-key'));
      const isSelected = selected.has(key);
      if (node.classList.contains('media-manager-card')) {
        node.classList.toggle('selected', isSelected);
      }
      if (node.tagName === 'TR') {
        node.classList.toggle('table-active', isSelected);
      }
    });
    libraryContent.querySelectorAll('[data-media-action="toggle"]').forEach((node) => {
      const key = cleanText(node.getAttribute('data-media-key'));
      if (Object.prototype.hasOwnProperty.call(node, 'checked')) {
        node.checked = selected.has(key);
      }
    });
  }

  function getTypeIcon(kind) {
    if (kind === 'image') return 'bi-file-earmark-image';
    if (kind === 'audio') return 'bi-file-earmark-music';
    if (kind === 'video') return 'bi-file-earmark-play';
    return 'bi-file-earmark';
  }

  function resolveRowUrl(row = {}) {
    return normalizeUrlToken(row.url)
      || deriveUrlFromPath(row.path)
      || normalizeUrlToken(row.downloadUrl)
      || normalizeUrlToken(row.publicUrl)
      || '';
  }

  function renderThumb(row, variant = 'tile') {
    const icon = getTypeIcon(row.kind);
    const mediaUrl = resolveRowUrl(row);
    if (row.kind === 'image' && mediaUrl) {
      return `<div class="media-manager-thumb-box ${variant}"><img src="${esc(mediaUrl)}" alt="${esc(row.name)}"></div>`;
    }
    return `<div class="media-manager-thumb-box ${variant}"><div class="text-secondary"><i class="bi ${icon} fs-2"></i></div></div>`;
  }

  function normalizeFolderOption(folder, index = 0) {
    const rawPath = normalizeFolderPath(
      typeof folder === 'string'
        ? folder
        : (folder && typeof folder === 'object' ? (folder.path || folder.value || folder.id || '') : '')
    );
    if (!rawPath) return null;
    const fallbackName = rawPath.split('/').filter(Boolean).pop() || rawPath;
    const name = cleanText(
      folder && typeof folder === 'object'
        ? (folder.label || folder.name || fallbackName)
        : fallbackName
    ) || fallbackName;
    return {
      key: `FOLDER_${index}_${rawPath}`,
      name,
      path: rawPath
    };
  }

  function getVisibleFolders() {
    const folders = Array.isArray(state.folderOptions) ? state.folderOptions : [];
    const q = cleanText(state.searchQuery).toLowerCase();
    return folders
      .map((folder, index) => normalizeFolderOption(folder, index))
      .filter(Boolean)
      .filter((folder) => {
        if (!q) return true;
        return [folder.name, folder.path].some((value) => cleanText(value).toLowerCase().includes(q));
      })
      .sort((left, right) => cleanText(left.name).localeCompare(cleanText(right.name)));
  }

  function renderFolderGridView(folders = [], variant = 'tile') {
    const thumbVariant = variant === 'thumbs' ? 'thumbs' : 'tile';
    return `
      <div class="row g-2">
        ${folders.map((folder) => `
          <div class="col-6 col-md-4 col-lg-3">
            <button type="button"
                    class="card h-100 w-100 border media-manager-card media-manager-folder-card text-start"
                    data-media-action="folder"
                    data-folder-path="${esc(folder.path)}"
                    title="Open folder">
              <div class="card-body p-2">
                <div class="media-manager-thumb-box ${thumbVariant}">
                  <div class="text-warning"><i class="bi bi-folder-fill fs-2"></i></div>
                </div>
                <div class="mt-2 small fw-bold text-truncate">${esc(folder.name)}</div>
                <div class="x-small text-muted text-truncate">/${esc(folder.path)}</div>
              </div>
            </button>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderFolderListView(folders = []) {
    return `
      <div class="table-responsive">
        <table class="table table-sm align-middle mb-0">
          <thead>
            <tr>
              <th style="width: 40%;">Folder</th>
              <th style="width: 45%;">Path</th>
              <th style="width: 15%;">Type</th>
            </tr>
          </thead>
          <tbody>
            ${folders.map((folder) => `
              <tr class="media-manager-folder-row"
                  data-media-action="folder"
                  data-folder-path="${esc(folder.path)}"
                  title="Open folder">
                <td>
                  <div class="d-flex align-items-center gap-2">
                    <i class="bi bi-folder-fill text-warning"></i>
                    <span class="fw-bold text-truncate">${esc(folder.name)}</span>
                  </div>
                </td>
                <td class="small text-muted text-truncate">/${esc(folder.path)}</td>
                <td><span class="badge bg-light text-dark border text-uppercase">folder</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderFolderDetailView(folders = []) {
    return `
      <div class="d-flex flex-column gap-2">
        ${folders.map((folder) => `
          <button type="button"
                  class="card border media-manager-card media-manager-folder-card text-start"
                  data-media-action="folder"
                  data-folder-path="${esc(folder.path)}"
                  title="Open folder">
            <div class="card-body p-2">
              <div class="d-flex align-items-start gap-3">
                <div class="media-manager-thumb-box detail">
                  <div class="text-warning"><i class="bi bi-folder-fill fs-2"></i></div>
                </div>
                <div class="flex-grow-1 min-w-0">
                  <div class="fw-bold text-truncate">${esc(folder.name)}</div>
                  <div class="x-small text-muted text-truncate">/${esc(folder.path)}</div>
                  <div class="mt-2 small text-muted">Open folder</div>
                </div>
              </div>
            </div>
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderFolderSection(folders = []) {
    if (!Array.isArray(folders) || !folders.length) return '';
    let body = '';
    if (state.view === 'list') {
      body = renderFolderListView(folders);
    } else if (state.view === 'detail') {
      body = renderFolderDetailView(folders);
    } else if (state.view === 'thumbs') {
      body = renderFolderGridView(folders, 'thumbs');
    } else {
      body = renderFolderGridView(folders, 'tile');
    }
    return `
      <div class="media-manager-folder-section mb-3">
        <div class="small text-muted fw-semibold mb-2">Folders</div>
        ${body}
      </div>
    `;
  }

  function renderTileView(rows) {
    return `
      <div class="row g-2">
        ${rows.map((row) => {
          const selected = state.selectedKeys.has(row.key) ? 'selected' : '';
          return `
            <div class="col-6 col-md-4 col-lg-3">
              <div class="card h-100 border media-manager-card ${selected}" data-media-key="${esc(row.key)}" data-media-action="select">
                <div class="card-body p-2">
                  ${renderThumb(row, 'tile')}
                  <div class="mt-2 small fw-bold text-truncate">${esc(row.name)}</div>
                  <div class="x-small text-muted text-truncate">${esc(row.path || row.url || '-')}</div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderThumbsView(rows) {
    return `
      <div class="row g-2">
        ${rows.map((row) => {
          const selected = state.selectedKeys.has(row.key) ? 'selected' : '';
          return `
            <div class="col-6 col-md-4 col-lg-3">
              <div class="card border media-manager-card ${selected}" data-media-key="${esc(row.key)}" data-media-action="select">
                <div class="card-body p-2">
                  ${renderThumb(row, 'thumbs')}
                  <div class="small fw-bold mt-2 text-truncate">${esc(row.name)}</div>
                  <div class="x-small text-muted">${esc(formatBytes(row.size))}</div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderListView(rows) {
    return `
      <div class="table-responsive">
        <table class="table table-sm align-middle mb-0">
          <thead>
            <tr>
              <th style="width: 6%;" class="text-center">Use</th>
              <th style="width: 40%;">File</th>
              <th style="width: 12%;">Type</th>
              <th style="width: 14%;">Size</th>
              <th style="width: 28%;">Modified</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const checked = state.selectedKeys.has(row.key) ? 'checked' : '';
              return `
                <tr class="media-manager-row" data-media-key="${esc(row.key)}" data-media-action="select">
                  <td class="text-center">
                    <input type="checkbox" class="form-check-input" ${checked} data-media-key="${esc(row.key)}" data-media-action="toggle">
                  </td>
                  <td>
                    <div class="fw-bold text-truncate">${esc(row.name)}</div>
                    <div class="x-small text-muted text-truncate">${esc(row.path || row.url || '-')}</div>
                  </td>
                  <td><span class="badge bg-light text-dark border text-uppercase">${esc(row.kind)}</span></td>
                  <td class="small text-muted">${esc(formatBytes(row.size))}</td>
                  <td class="small text-muted">${esc(formatDateTime(row.uploadDate))}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderDetailView(rows) {
    return `
      <div class="d-flex flex-column gap-2">
        ${rows.map((row) => {
          const selected = state.selectedKeys.has(row.key) ? 'selected' : '';
          const checked = state.selectedKeys.has(row.key) ? 'checked' : '';
          return `
            <div class="card border media-manager-card ${selected}" data-media-key="${esc(row.key)}" data-media-action="select">
              <div class="card-body p-2">
                <div class="d-flex align-items-start gap-3">
                  ${renderThumb(row, 'detail')}
                  <div class="flex-grow-1 min-w-0">
                    <div class="d-flex justify-content-between align-items-start gap-2">
                      <div>
                        <div class="fw-bold text-truncate">${esc(row.name)}</div>
                        <div class="x-small text-muted text-truncate">${esc(row.path || row.url || '-')}</div>
                      </div>
                      <input type="checkbox" class="form-check-input mt-1" ${checked} data-media-key="${esc(row.key)}" data-media-action="toggle">
                    </div>
                    <div class="mt-2 d-flex flex-wrap gap-2 small">
                      <span class="badge bg-light text-dark border text-uppercase">${esc(row.kind)}</span>
                      <span class="text-muted">${esc(formatBytes(row.size))}</span>
                      <span class="text-muted">${esc(formatDateTime(row.uploadDate))}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderLibrary() {
    if (!libraryContent || !libraryEmpty) return;
    const visible = getVisibleRows();
    const rows = Array.isArray(visible.rows) ? visible.rows : [];
    const folders = getVisibleFolders();
    const folderSection = renderFolderSection(folders);
    if (!rows.length && !folders.length) {
      libraryContent.innerHTML = '';
      libraryEmpty.classList.remove('d-none');
      libraryEmpty.classList.add('d-flex');
      renderPaginationState(
        Number(visible.totalRows || 0) || 0,
        Number(visible.totalPages || 1) || 1,
        Number(visible.start || 0) || 0,
        Number(visible.end || 0) || 0
      );
      refreshStatus();
      return;
    }
    libraryEmpty.classList.add('d-none');
    libraryEmpty.classList.remove('d-flex');
    let fileSection = '';
    if (state.view === 'list') {
      fileSection = rows.length ? renderListView(rows) : '';
    } else if (state.view === 'detail') {
      fileSection = rows.length ? renderDetailView(rows) : '';
    } else if (state.view === 'thumbs') {
      fileSection = rows.length ? renderThumbsView(rows) : '';
    } else {
      fileSection = rows.length ? renderTileView(rows) : '';
    }
    libraryContent.innerHTML = `${folderSection}${fileSection}`;
    renderPaginationState(
      Number(visible.totalRows || 0) || 0,
      Number(visible.totalPages || 1) || 1,
      Number(visible.start || 0) || 0,
      Number(visible.end || 0) || 0
    );
    refreshStatus();
  }

  function setView(view) {
    const next = cleanText(view).toLowerCase();
    if (!['tile', 'thumbs', 'list', 'detail'].includes(next)) return;
    state.view = next;
    viewButtons.forEach((button) => {
      const active = cleanText(button.getAttribute('data-media-view')).toLowerCase() === next;
      button.classList.toggle('active', active);
    });
    renderLibrary();
  }

  function setDefaultPageSize(pageSize, { force = false } = {}) {
    const next = clampPageSize(pageSize, state.pageSizeDefault);
    state.pageSizeDefault = next;
    if (!state.pageSizePinnedByUser || force) {
      state.pageSize = next;
    }
    if (pageSizeSelectEl) {
      const hasOption = Array.from(pageSizeSelectEl.options || []).some((option) => cleanText(option.value) === String(next));
      if (!hasOption) {
        const option = document.createElement('option');
        option.value = String(next);
        option.textContent = String(next);
        pageSizeSelectEl.appendChild(option);
      }
      pageSizeSelectEl.value = String(state.pageSize);
    }
  }

  function sortRowsNewestFirst(rows = []) {
    const input = Array.isArray(rows) ? rows.slice() : [];
    input.sort((left, right) => {
      const rankDiff = resolveRowSortRank(right) - resolveRowSortRank(left);
      if (rankDiff !== 0) return rankDiff;
      return cleanText(right.name).localeCompare(cleanText(left.name));
    });
    return input;
  }

  function setRows(rows) {
    const input = Array.isArray(rows) ? rows : [];
    const normalizedRows = input.map((row, index) => normalizeRow(row, index));
    state.rows = sortRowsNewestFirst(normalizedRows);
    const validKeys = new Set(getCompatibleRows().map((row) => row.key));
    state.selectedKeys.forEach((key) => {
      if (!validKeys.has(key)) state.selectedKeys.delete(key);
    });
    state.page = 1;
    renderLibrary();
  }

  function appendRows(rows) {
    const input = Array.isArray(rows) ? rows : [];
    if (!input.length) return;
    const merged = [];
    const seen = new Set();
    const pushRow = (row, idx) => {
      const normalized = normalizeRow(row, idx);
      const dedupe = cleanText(normalized.path).toLowerCase()
        || cleanText(normalized.url).toLowerCase()
        || cleanText(normalized.id).toLowerCase()
        || cleanText(normalized.filename).toLowerCase();
      if (!dedupe || seen.has(dedupe)) return;
      seen.add(dedupe);
      merged.push(normalized);
    };
    input.forEach((row, idx) => pushRow(row, idx));
    state.rows.forEach((row, idx) => pushRow(row, idx + input.length));
    state.rows = sortRowsNewestFirst(merged);
    state.page = 1;
    renderLibrary();
  }

  function setUploading(isUploading) {
    const uploading = isUploading === true;
    if (uploadSpinner) uploadSpinner.classList.toggle('d-none', !uploading);
    if (uploadZone) uploadZone.classList.toggle('d-none', uploading);
    if (uploadInput) uploadInput.disabled = uploading;
    if (uploadSelectBtn) uploadSelectBtn.disabled = uploading;
  }

  function renderFolderControls() {
    const currentFolder = normalizeFolderPath(state.currentFolder);
    const currentFolderLabel = currentFolder ? `\\${currentFolder.split('/').join('\\')}` : '\\';
    const scopeFolder = cleanText(state.scopeFolder, 120).toUpperCase();
    if (baseFolderBadgeEl) {
      if (scopeFolder) {
        baseFolderBadgeEl.textContent = scopeFolder;
        baseFolderBadgeEl.classList.remove('d-none');
      } else {
        baseFolderBadgeEl.textContent = '';
        baseFolderBadgeEl.classList.add('d-none');
      }
    }
    if (currentFolderLabelEl) {
      currentFolderLabelEl.textContent = currentFolderLabel;
    }
    if (folderUpBtn) {
      folderUpBtn.disabled = !currentFolder;
    }
    if (!folderSelectEl) return;

    const currentValue = currentFolder;
    folderSelectEl.innerHTML = '';

    const rootOpt = document.createElement('option');
    rootOpt.value = '';
    rootOpt.textContent = '\\';
    folderSelectEl.appendChild(rootOpt);

    const segments = currentValue.split('/').filter(Boolean);
    const paths = [];
    let accumulator = '';
    segments.forEach((segment) => {
      accumulator = accumulator ? `${accumulator}/${segment}` : segment;
      paths.push(accumulator);
    });

    paths.forEach((rawPath) => {
      const option = document.createElement('option');
      option.value = rawPath;
      option.textContent = `\\${rawPath.split('/').join('\\')}`;
      folderSelectEl.appendChild(option);
    });

    folderSelectEl.value = currentValue;
  }

  async function handleRefresh(options = {}) {
    if (typeof state.context.onRefresh !== 'function') {
      showAlert('Refresh handler is not configured.', 'warning');
      return;
    }
    const requestedFolder = normalizeFolderPath(
      Object.prototype.hasOwnProperty.call(options || {}, 'folder')
        ? options.folder
        : state.currentFolder
    );
    try {
      const result = await state.context.onRefresh({
        q: state.searchQuery,
        page: state.page,
        limit: state.pageSize,
        viewAll: state.viewAll,
        folder: requestedFolder
      });
      const rows = Array.isArray(result)
        ? result
        : (Array.isArray(result && result.rows) ? result.rows : []);
      const defaultFolder = normalizeFolderPath(result && result.defaultFolder);
      const currentFolder = normalizeFolderPath(result && result.currentFolder);
      const scopeFolder = cleanText(result && result.scopeFolder, 120).toUpperCase();
      state.defaultFolder = defaultFolder || state.defaultFolder;
      state.currentFolder = currentFolder || requestedFolder || '';
      state.scopeFolder = scopeFolder || state.scopeFolder || '';
      state.parentFolder = normalizeFolderPath(result && result.parentFolder);
      state.folderOptions = Array.isArray(result && result.folders) ? result.folders : [];
      renderFolderControls();
      const defaultPageSize = toPositiveInt(result && result.defaults ? result.defaults.pageSize : 0, 0)
        || toPositiveInt(result && result.pageSize, 0);
      if (defaultPageSize > 0) {
        setDefaultPageSize(defaultPageSize);
      }
      setRows(rows);
      const loadedCount = getCompatibleRows().length;
      const message = cleanText(result && result.message);
      showAlert(message || `Loaded ${loadedCount} file(s).`, 'success');
    } catch (error) {
      showAlert(error && error.message ? error.message : 'Failed to refresh media library.', 'error');
    }
  }

  function ensureFallbackModalBackdrop() {
    const existing = document.querySelector(FALLBACK_BACKDROP_SELECTOR);
    if (existing) return existing;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade show media-manager-fallback-backdrop';
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function removeFallbackModalBackdropIfUnused() {
    const stillOpen = modalEl.classList.contains('media-manager-fallback-open')
      && modalEl.classList.contains('show')
      && String(modalEl.style.display || '').toLowerCase() !== 'none';
    if (!stillOpen) {
      document.querySelectorAll(FALLBACK_BACKDROP_SELECTOR).forEach((node) => node.remove());
      document.body.classList.remove('modal-open');
    }
  }

  function openFallbackModal() {
    modalEl.classList.add('show', 'media-manager-fallback-open');
    modalEl.style.display = 'block';
    modalEl.removeAttribute('aria-hidden');
    ensureFallbackModalBackdrop();
    document.body.classList.add('modal-open');
    return true;
  }

  function closeFallbackModal() {
    modalEl.classList.remove('show');
    modalEl.style.display = 'none';
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.classList.remove('media-manager-fallback-open');
    removeFallbackModalBackdropIfUnused();
    return true;
  }

  function openModal() {
    if (state.compat && typeof state.compat.open === 'function') {
      return state.compat.open(state.compat.modalInstance || null, state.compat.modalEl || modalEl);
    }
    if (windowObj.bootstrap && windowObj.bootstrap.Modal) {
      if (!state.bootstrapModal) {
        state.bootstrapModal = windowObj.bootstrap.Modal.getOrCreateInstance(modalEl);
      }
      state.bootstrapModal.show();
      return true;
    }
    return openFallbackModal();
  }

  function closeModal() {
    if (state.compat && typeof state.compat.close === 'function') {
      return state.compat.close(state.compat.modalInstance || null, state.compat.modalEl || modalEl);
    }
    if (state.bootstrapModal) {
      state.bootstrapModal.hide();
      return true;
    }
    return closeFallbackModal();
  }

  function openPreview(row) {
    const url = resolveRowUrl(row);
    if (!url) {
      showAlert('Selected file URL is missing.', 'warning');
      return;
    }
    if (row.kind === 'image' && windowObj.ImageViewer && typeof windowObj.ImageViewer.open === 'function') {
      windowObj.ImageViewer.open(url, row.originalName || row.name, row.mimeType);
      return;
    }
    if (row.kind === 'audio' && windowObj.AudioPreviewModal && typeof windowObj.AudioPreviewModal.open === 'function') {
      windowObj.AudioPreviewModal.open(url, row.originalName || row.name, row.mimeType);
      return;
    }
    windowObj.open(url, '_blank', 'noopener');
  }

  function toggleSelect(rowKeyToken) {
    const key = cleanText(rowKeyToken);
    if (!key) return;
    const maxSelection = Math.max(1, Number(state.context.maxSelection || 1));
    if (maxSelection <= 1) {
      state.selectedKeys.clear();
      state.selectedKeys.add(key);
      syncSelectionUi();
      refreshStatus();
      return;
    }

    if (state.selectedKeys.has(key)) {
      state.selectedKeys.delete(key);
      syncSelectionUi();
      refreshStatus();
      return;
    }
    if (state.selectedKeys.size >= maxSelection) {
      showAlert(`Selection limit is ${maxSelection}.`, 'warning');
      return;
    }
    state.selectedKeys.add(key);
    syncSelectionUi();
    refreshStatus();
  }

  async function open(context = {}) {
    const mode = cleanText(context.mode).toLowerCase() === 'assign' ? 'assign' : 'attach';
    const requestedView = cleanText(context.defaultView).toLowerCase();
    const defaultView = ['tile', 'thumbs', 'list', 'detail'].includes(requestedView)
      ? requestedView
      : (mode === 'attach' ? 'list' : 'tile');
    const defaultPageSize = clampPageSize(context.defaultPageSize, state.pageSizeDefault);
    const defaultFolder = normalizeFolderPath(context.defaultFolder);
    const scopeFolder = cleanText(context.scopeFolder, 120).toUpperCase();
    state.context = {
      ...state.context,
      mode,
      mediaKind: ['audio', 'image', 'any'].includes(cleanText(context.mediaKind).toLowerCase())
        ? cleanText(context.mediaKind).toLowerCase()
        : 'any',
      maxSelection: Math.max(1, Number(context.maxSelection || state.context.maxSelection || 1)),
      title: cleanText(context.title) || state.context.title,
      defaultView,
      defaultPageSize,
      defaultFolder,
      scopeFolder,
      onApply: typeof context.onApply === 'function' ? context.onApply : null,
      onUpload: typeof context.onUpload === 'function' ? context.onUpload : null,
      onRefresh: typeof context.onRefresh === 'function' ? context.onRefresh : null
    };

    state.selectedKeys.clear();
    state.searchQuery = '';
    state.page = 1;
    state.viewAll = false;
    state.pageSizePinnedByUser = false;
    state.defaultFolder = state.context.defaultFolder || '';
    state.currentFolder = state.defaultFolder || '';
    state.scopeFolder = cleanText(state.context.scopeFolder, 120).toUpperCase();
    state.parentFolder = '';
    state.folderOptions = [];
    setDefaultPageSize(state.context.defaultPageSize, { force: true });
    if (searchInputEl) searchInputEl.value = '';
    if (viewAllToggleEl) viewAllToggleEl.checked = false;
    if (titleEl) titleEl.textContent = state.context.title || 'Media Manager';
    if (contextBadge) contextBadge.textContent = state.context.mode === 'assign' ? 'Assign' : 'Attach';
    if (mediaKindBadge) mediaKindBadge.textContent = state.context.mediaKind || 'any';
    if (scopeHintEl) {
      scopeHintEl.textContent = state.context.mode === 'assign'
        ? 'Select one compatible file to assign to the field.'
        : 'Select one or more files to attach to this question.';
    }
    if (applyBtn) {
      applyBtn.innerHTML = state.context.mode === 'assign'
        ? '<i class="bi bi-check2-square me-1"></i>Use + Assign'
        : '<i class="bi bi-plus-lg me-1"></i>Use Selected';
      applyBtn.disabled = true;
    }

    setView(state.context.defaultView || (state.context.mode === 'attach' ? 'list' : 'tile'));
    showAlert('', 'info');
    renderFolderControls();
    refreshStatus();

    if ((context.forceRefresh || !state.rows.length) && typeof state.context.onRefresh === 'function') {
      await handleRefresh();
    } else {
      renderLibrary();
    }
    return openModal();
  }

  async function applySelection() {
    if (typeof state.context.onApply !== 'function') {
      showAlert('Apply handler is not configured.', 'warning');
      return;
    }
    const rows = getSelectedRows();
    if (!rows.length) {
      showAlert('Select at least one file.', 'warning');
      return;
    }
    try {
      await state.context.onApply(rows.map((row) => ({ ...row })));
    } catch (error) {
      showAlert(error && error.message ? error.message : 'Unable to apply selected media.', 'error');
      return;
    }
    closeModal();
  }

  async function handleUploadInputChanged() {
    if (!uploadInput || !uploadInput.files || !uploadInput.files.length) return;
    if (typeof state.context.onUpload !== 'function') {
      showAlert('Upload handler is not configured.', 'warning');
      uploadInput.value = '';
      return;
    }
    const files = Array.from(uploadInput.files || []);
    setUploading(true);
    try {
      const result = await state.context.onUpload(files, {
        ...state.context,
        currentFolder: state.currentFolder,
        defaultFolder: state.defaultFolder
      });
      const rows = Array.isArray(result)
        ? result
        : (Array.isArray(result && result.rows) ? result.rows : []);
      appendRows(rows);
      if (libraryTabBtn) libraryTabBtn.click();
      showAlert(
        (result && cleanText(result.message)) || `Uploaded ${rows.length} file(s).`,
        'success'
      );
    } catch (error) {
      showAlert(error && error.message ? error.message : 'Upload failed.', 'error');
    } finally {
      setUploading(false);
      uploadInput.value = '';
    }
  }

  function setModalCompat(compat = null) {
    if (!compat || typeof compat !== 'object') {
      state.compat = null;
      return;
    }
    state.compat = {
      open: typeof compat.open === 'function' ? compat.open : null,
      close: typeof compat.close === 'function' ? compat.close : null,
      modalEl: compat.modalEl || modalEl,
      modalInstance: compat.modalInstance || null
    };
  }

  function openFolder(folderPath = '') {
    const nextFolder = normalizeFolderPath(folderPath);
    state.currentFolder = nextFolder;
    state.page = 1;
    handleRefresh({ folder: nextFolder });
  }

  modalEl.addEventListener('click', (event) => {
    const folderNode = event.target.closest('[data-media-action="folder"]');
    if (folderNode) {
      event.preventDefault();
      openFolder(folderNode.getAttribute('data-folder-path'));
      return;
    }

    const toggleNode = event.target.closest('[data-media-action="toggle"]');
    if (toggleNode) {
      event.stopPropagation();
      toggleSelect(toggleNode.getAttribute('data-media-key'));
      return;
    }
    const selectNode = event.target.closest('[data-media-action="select"]');
    if (selectNode) {
      toggleSelect(selectNode.getAttribute('data-media-key'));
      return;
    }
  });

  modalEl.addEventListener('dblclick', (event) => {
    const selectNode = event.target.closest('[data-media-action="select"]');
    if (!selectNode) return;
    const key = cleanText(selectNode.getAttribute('data-media-key'));
    const row = getCompatibleRows().find((item) => item.key === key);
    if (!row) return;
    const maxSelection = Math.max(1, Number(state.context.maxSelection || 1));
    if (maxSelection <= 1) {
      state.selectedKeys.clear();
      state.selectedKeys.add(key);
      syncSelectionUi();
      refreshStatus();
    } else if (!state.selectedKeys.has(key)) {
      if (state.selectedKeys.size < maxSelection) {
        state.selectedKeys.add(key);
        syncSelectionUi();
        refreshStatus();
      }
    }
    openPreview(row);
  });

  viewButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const view = button.getAttribute('data-media-view');
      setView(view);
    });
  });

  refreshBtn?.addEventListener('click', () => {
    handleRefresh();
  });

  searchInputEl?.addEventListener('input', () => {
    state.searchQuery = cleanText(searchInputEl.value, 300);
    state.page = 1;
    renderLibrary();
  });

  searchClearBtn?.addEventListener('click', () => {
    state.searchQuery = '';
    if (searchInputEl) searchInputEl.value = '';
    state.page = 1;
    renderLibrary();
  });

  pageSizeSelectEl?.addEventListener('change', () => {
    state.pageSize = clampPageSize(pageSizeSelectEl.value, state.pageSizeDefault);
    state.pageSizePinnedByUser = true;
    state.viewAll = false;
    state.page = 1;
    if (viewAllToggleEl) viewAllToggleEl.checked = false;
    renderLibrary();
  });

  viewAllToggleEl?.addEventListener('change', () => {
    state.viewAll = Boolean(viewAllToggleEl.checked);
    state.page = 1;
    renderLibrary();
  });

  prevPageBtn?.addEventListener('click', () => {
    if (state.viewAll) return;
    state.page = Math.max(1, toPositiveInt(state.page, 1) - 1);
    renderLibrary();
  });

  folderSelectEl?.addEventListener('change', () => {
    const selectedFolder = normalizeFolderPath(folderSelectEl.value);
    openFolder(selectedFolder);
  });

  folderUpBtn?.addEventListener('click', () => {
    const current = normalizeFolderPath(state.currentFolder);
    if (!current) return;
    const segments = current.split('/').filter(Boolean);
    segments.pop();
    const parent = normalizeFolderPath(segments.join('/'));
    openFolder(parent);
  });

  nextPageBtn?.addEventListener('click', () => {
    if (state.viewAll) return;
    state.page = Math.max(1, toPositiveInt(state.page, 1) + 1);
    renderLibrary();
  });

  uploadSelectBtn?.addEventListener('click', () => {
    uploadInput?.click();
  });

  uploadInput?.addEventListener('change', () => {
    handleUploadInputChanged();
  });

  applyBtn?.addEventListener('click', () => {
    applySelection();
  });

  modalEl.addEventListener('click', (event) => {
    const dismissTrigger = event.target.closest('[data-bs-dismiss="modal"]');
    if (!dismissTrigger) return;
    if (state.compat && state.compat.modalInstance) return;
    event.preventDefault();
    closeModal();
  });

  modalEl.addEventListener('hidden.bs.modal', () => {
    state.selectedKeys.clear();
    refreshStatus();
  });

  windowObj.MediaManagerModal = {
    open,
    close: closeModal,
    setRows,
    appendRows,
    setDefaultPageSize,
    setView,
    setModalCompat
  };
})(window);
