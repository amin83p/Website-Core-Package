(function initSessionBookCoveringQuickReport(global) {
  'use strict';

  let config = null;
  let pickerModal = null;
  let wizardModal = null;
  let currentBook = null;
  let selectedUnitIds = [];
  let selectedPageNumbers = [];
  let editingEntry = null;
  let wired = false;

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function apiBase() {
    const classId = encodeURIComponent(String(config?.classId || ''));
    const sessionId = encodeURIComponent(String(config?.sessionId || ''));
    return `/school/classes/${classId}/sessions/${sessionId}/book-covering-reports`;
  }

  function showMessage(title, message, icon) {
    let msgTitle = title;
    let msgBody = message;
    let msgIcon = icon;
    if (title && typeof title === 'object' && message === undefined) {
      msgTitle = title.title;
      msgBody = title.message;
      msgIcon = title.icon;
    }
    if (typeof config?.messageBox === 'function') {
      if (config.messageBox.length >= 2) {
        return config.messageBox(msgTitle, msgBody, msgIcon);
      }
      return config.messageBox({ title: msgTitle, message: msgBody, icon: msgIcon });
    }
    if (typeof global.showMessageModal === 'function') {
      return global.showMessageModal({
        title: msgTitle || 'Book coverage',
        message: msgBody || '',
        icon: msgIcon || 'info',
        buttons: [{ text: 'OK', class: msgIcon === 'error' ? 'btn-danger' : 'btn-primary' }]
      });
    }
    global.alert(msgBody || msgTitle);
    return Promise.resolve();
  }

  function showStep(step) {
    const order = ['Detail', 'Units', 'Pages'];
    const stepIndex = order.indexOf(step);
    order.forEach((name) => {
      const el = document.getElementById('sessionBookCoveringWizardStep' + name);
      if (el) el.classList.toggle('d-none', name !== step);
    });
    document.querySelectorAll('.session-bc-step-pill').forEach((pill) => {
      const pillStep = String(pill.dataset.bcStep || '');
      const pillIndex = order.indexOf(pillStep);
      pill.classList.remove('is-active', 'is-done');
      if (pillStep === step) pill.classList.add('is-active');
      else if (pillIndex >= 0 && pillIndex < stepIndex) pill.classList.add('is-done');
    });
    const btnPickUnits = document.getElementById('btnSessionBookCoveringPickUnits');
    const btnBackDetail = document.getElementById('btnSessionBookCoveringBackToDetail');
    const btnToPages = document.getElementById('btnSessionBookCoveringToPages');
    const btnBackUnits = document.getElementById('btnSessionBookCoveringBackToUnits');
    const btnSave = document.getElementById('btnSessionBookCoveringSaveEntry');
    if (btnPickUnits) btnPickUnits.classList.toggle('d-none', step !== 'Detail');
    if (btnBackDetail) btnBackDetail.classList.toggle('d-none', step !== 'Units');
    if (btnToPages) btnToPages.classList.toggle('d-none', step !== 'Units');
    if (btnBackUnits) btnBackUnits.classList.toggle('d-none', step !== 'Pages');
    if (btnSave) btnSave.classList.toggle('d-none', step !== 'Pages');
  }

  function renderBookPickerGrid(books) {
    const grid = document.getElementById('sessionBookCoveringBookPickerGrid');
    const empty = document.getElementById('sessionBookCoveringBookPickerEmpty');
    if (!grid) return;
    const rows = Array.isArray(books) ? books : [];
    if (!rows.length) {
      grid.innerHTML = '';
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    grid.innerHTML = rows.map((book) => {
      const bookId = escapeHtml(book.bookId);
      const title = escapeHtml(book.bookTitle || book.bookId);
      const cover = String(book.coverPhotoUrl || '').trim();
      const coverHtml = cover
        ? `<img src="${escapeHtml(cover)}" alt="" class="session-bc-book-pick-cover">`
        : '<div class="session-bc-book-pick-placeholder"><i class="bi bi-book"></i></div>';
      return (
        '<div class="col-6 col-md-4 col-lg-3">' +
        `<div class="session-bc-book-pick" data-book-id="${bookId}" role="button" tabindex="0">` +
        coverHtml +
        `<div class="fw-semibold small session-bc-book-pick-title">${title}</div>` +
        '</div></div>'
      );
    }).join('');
    grid.querySelectorAll('.session-bc-book-pick').forEach((card) => {
      const pick = () => {
        const bookId = String(card.dataset.bookId || '').trim();
        if (!bookId) return;
        pickerModal?.hide();
        openWizardForBook(bookId, null);
      };
      card.addEventListener('click', pick);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          pick();
        }
      });
    });
  }

  async function loadAssignedBooks() {
    const loading = document.getElementById('sessionBookCoveringBookPickerLoading');
    loading?.classList.remove('d-none');
    try {
      const res = await fetch(`${apiBase()}/assigned-books`, {
        headers: { 'x-ajax-request': 'true', Accept: 'application/json' },
        credentials: 'same-origin'
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Could not load assigned books.');
      renderBookPickerGrid(result.books || []);
    } finally {
      loading?.classList.add('d-none');
    }
  }

  function renderUnitPicker() {
    const host = document.getElementById('sessionBookCoveringUnitPicker');
    if (!host || !currentBook) return;
    const toc = Array.isArray(currentBook.tableOfContents) ? currentBook.tableOfContents : [];
    if (!toc.length) {
      host.innerHTML = '<div class="text-muted small">This book has no table of contents.</div>';
      return;
    }
    const selected = new Set(selectedUnitIds.map((id) => String(id)));
    const cards = toc.map((row) => {
      const id = String(row.id || '').trim();
      const level = Number(row.level || 1);
      const label = escapeHtml(row.label || id);
      const start = row.startPage;
      const end = row.endPage;
      const pages = start ? (end && end !== start ? `pp. ${start}–${end}` : `p. ${start}`) : '';
      const checked = selected.has(id) ? ' checked' : '';
      const levelHint = level > 1 ? `<span class="session-bc-unit-level">Level ${level}</span>` : '';
      return (
        '<label class="session-bc-unit-card">' +
        `<input type="checkbox" class="form-check-input js-bc-unit-pick" value="${escapeHtml(id)}"${checked}>` +
        '<div class="session-bc-unit-card-body">' +
        levelHint +
        `<div class="session-bc-unit-title">${label}</div>` +
        (pages ? `<div class="session-bc-unit-pages">${escapeHtml(pages)}</div>` : '') +
        '</div></label>'
      );
    }).join('');
    host.innerHTML = `<div class="session-bc-unit-grid">${cards}</div>`;
    host.querySelectorAll('.js-bc-unit-pick').forEach((input) => {
      input.addEventListener('change', () => {
        const val = String(input.value || '').trim();
        if (!val) return;
        if (input.checked) {
          if (!selectedUnitIds.includes(val)) selectedUnitIds.push(val);
        } else {
          selectedUnitIds = selectedUnitIds.filter((id) => id !== val);
        }
      });
    });
  }

  function renderPagePicker() {
    const host = document.getElementById('sessionBookCoveringPagePicker');
    const utils = global.BookCoveringTocUtils;
    if (!host || !utils || !currentBook) return;
    host.innerHTML = utils.buildPageToggleGroupsHtml(
      currentBook.tableOfContents,
      selectedUnitIds,
      selectedPageNumbers,
      { escapeHtml, readOnly: false }
    );
    utils.bindPageToggleGroups(host, (pages) => {
      selectedPageNumbers = pages;
    });
  }

  function renderBookDetail() {
    const coverHost = document.getElementById('sessionBookCoveringWizardCover');
    const metaHost = document.getElementById('sessionBookCoveringWizardMeta');
    const subtitle = document.getElementById('sessionBookCoveringWizardSubtitle');
    if (!currentBook) return;
    if (subtitle) subtitle.textContent = currentBook.title || '';
    const coverUrl = String(currentBook.coverPhotoUrl || '').trim();
    if (coverHost) {
      coverHost.innerHTML = coverUrl
        ? `<img src="${escapeHtml(coverUrl)}" alt="">`
        : '<div class="session-bc-book-pick-placeholder"><i class="bi bi-book"></i></div>';
    }
    const authors = Array.isArray(currentBook.authors) ? currentBook.authors.join(', ') : '';
    const pdfUrl = String(currentBook.digitalPdf?.url || '').trim();
    let meta = '';
    if (authors) meta += `<div><strong>Authors:</strong> ${escapeHtml(authors)}</div>`;
    if (currentBook.isbn) meta += `<div><strong>ISBN:</strong> ${escapeHtml(currentBook.isbn)}</div>`;
    if (currentBook.publisher) meta += `<div><strong>Publisher:</strong> ${escapeHtml(currentBook.publisher)}</div>`;
    if (currentBook.totalPages) meta += `<div><strong>Pages:</strong> ${escapeHtml(currentBook.totalPages)}</div>`;
    if (pdfUrl) {
      meta += `<div class="mt-2"><a href="${escapeHtml(pdfUrl)}" class="btn btn-outline-primary btn-sm" target="_blank" rel="noopener noreferrer"><i class="bi bi-file-earmark-pdf me-1"></i>Open PDF</a></div>`;
    }
    if (metaHost) metaHost.innerHTML = meta || '<span class="text-muted">No extra details.</span>';
  }

  async function openWizardForBook(bookId, entryRow) {
    editingEntry = entryRow || null;
    selectedUnitIds = [];
    selectedPageNumbers = [];
    if (entryRow?.unitCoverage?.tocEntryIds) {
      selectedUnitIds = entryRow.unitCoverage.tocEntryIds.slice();
    }
    if (entryRow?.pageCoverage?.pageNumbers) {
      selectedPageNumbers = entryRow.pageCoverage.pageNumbers.slice();
    }
    showStep('Detail');
    const res = await fetch(`${apiBase()}/assigned-books/${encodeURIComponent(String(bookId))}`, {
      headers: { 'x-ajax-request': 'true', Accept: 'application/json' },
      credentials: 'same-origin'
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.status !== 'success') {
      await showMessage('Book unavailable', result.message || 'Could not load book details.', 'error');
      return;
    }
    currentBook = result.book;
    renderBookDetail();
    wizardModal?.show();
  }

  async function saveEntry() {
    if (!currentBook) return;
    if (!selectedUnitIds.length) {
      await showMessage('Select units', 'Choose at least one unit from the table of contents.', 'warning');
      showStep('Units');
      return;
    }
    const utils = global.BookCoveringTocUtils;
    const pages = utils ? utils.collectSelectedPageNumbers(document.getElementById('sessionBookCoveringPagePicker')) : selectedPageNumbers;
    if (!pages.length) {
      await showMessage('Select pages', 'Choose at least one page covered.', 'warning');
      return;
    }
    const payload = {
      actionStateId: config?.actionStateId || '',
      entry: {
        bookId: currentBook.bookId,
        bookAssignmentId: currentBook.bookAssignmentId || '',
        unitCoverage: { mode: 'toc_pick', tocEntryIds: selectedUnitIds },
        pageCoverage: { mode: 'page_numbers', pageNumbers: pages }
      }
    };
    const res = await fetch(`${apiBase()}/entries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ajax-request': 'true',
        Accept: 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.status !== 'success') {
      await showMessage('Save failed', result.message || 'Could not save book coverage.', 'error');
      return;
    }
    wizardModal?.hide();
    if (typeof config?.onSaved === 'function') {
      await config.onSaved(result.summary || null);
    }
    await showMessage('Saved', result.message || 'Book coverage saved.', 'success');
  }

  function wireControls() {
    if (wired) return;
    wired = true;
    const pickerEl = document.getElementById('sessionBookCoveringBookPickerModal');
    const wizardEl = document.getElementById('sessionBookCoveringWizardModal');
    if (pickerEl && global.bootstrap?.Modal) pickerModal = new global.bootstrap.Modal(pickerEl);
    if (wizardEl && global.bootstrap?.Modal) wizardModal = new global.bootstrap.Modal(wizardEl);

    document.getElementById('btnSessionBookCoveringPickUnits')?.addEventListener('click', () => {
      renderUnitPicker();
      showStep('Units');
    });
    document.getElementById('btnSessionBookCoveringBackToDetail')?.addEventListener('click', () => showStep('Detail'));
    document.getElementById('btnSessionBookCoveringToPages')?.addEventListener('click', () => {
      if (!selectedUnitIds.length) {
        showMessage('Select units', 'Choose at least one unit before continuing.', 'warning');
        return;
      }
      renderPagePicker();
      showStep('Pages');
    });
    document.getElementById('btnSessionBookCoveringBackToUnits')?.addEventListener('click', () => showStep('Units'));
    document.getElementById('btnSessionBookCoveringSaveEntry')?.addEventListener('click', () => {
      saveEntry().catch((err) => showMessage('Save failed', err.message, 'error'));
    });

    pickerEl?.addEventListener('show.bs.modal', () => {
      loadAssignedBooks().catch((err) => showMessage('Load failed', err.message, 'error'));
    });
  }

  function open(options = {}) {
    if (!config && options) config = { ...options };
    else if (options) Object.assign(config, options);
    wireControls();
    if (options?.bookId) {
      openWizardForBook(options.bookId, options.entry || null);
      return;
    }
    pickerModal?.show();
  }

  global.SessionBookCoveringQuickReport = { init(options) { config = { ...(config || {}), ...(options || {}) }; wireControls(); }, open };
})(window);
