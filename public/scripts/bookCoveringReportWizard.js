(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncate(text, max) {
    const s = String(text || '').trim();
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  function showWizardMessage(message, title, icon) {
    const payload = {
      title: title || 'Check your report',
      icon: icon || 'warning',
      message: String(message || ''),
      buttons: [{ text: 'OK', class: 'btn-warning btn-sm' }]
    };
    if (typeof window.showMessageModal === 'function') {
      return window.showMessageModal(payload);
    }
    console.warn('showMessageModal unavailable for book covering wizard.', payload);
    return Promise.resolve(false);
  }

  function init(config) {
    if (!config || !config.form) return;

    const assignedBooks = Array.isArray(config.assignedBooks) ? config.assignedBooks.slice() : [];
    let reportEntries = Array.isArray(config.reportEntries) ? config.reportEntries.slice() : [];
    const periodTypeHelp = config.periodTypeHelp || {};
    const sessionSummary = config.sessionSummary || null;
    const isReadOnly = Boolean(config.isReadOnly);
    const isEdit = Boolean(config.isEdit);
    const isCreate = !isEdit;
    const classTitle = String(config.classTitle || '');

    const form = config.form;
    const hiddenClassId = document.getElementById('hid_classId');
    const hiddenEntries = document.getElementById('hid_entries');
    const hiddenNotes = document.getElementById('hid_reportNotes');
    const hidPeriodStart = document.getElementById('hid_periodStartDate');
    const hidPeriodEnd = document.getElementById('hid_periodEndDate');
    const anchorDateInput = document.getElementById('anchorDate');
    let resolvedPeriodText = '';
    const bookStepsHost = document.getElementById('wizardBookStepsHost');
    const stepRail = document.getElementById('coveringWizardStepRail');
    const progressBar = document.getElementById('coveringWizardProgressBar');
    const stepLabel = document.getElementById('coveringWizardStepLabel');
    const btnBack = document.getElementById('coveringWizardBack');
    const btnNext = document.getElementById('coveringWizardNext');
    const btnSaveDraft = document.getElementById('coveringWizardSaveDraft');
    const btnSubmit = document.getElementById('coveringWizardSubmit');
    const finishSummary = document.getElementById('finishSummaryPanel');
    const overallNotesInput = document.getElementById('overallReportNotes');

    const selectedBookIds = new Set(
      reportEntries.map((e) => String(e.bookId || '')).filter(Boolean)
    );

    let currentStepIndex = 0;
    let stepDefs = [];

    function formatPeriodLabel(start, end) {
      const startDate = String(start || '').trim();
      const endDate = String(end || '').trim();
      if (!startDate) return '—';
      if (!endDate || startDate === endDate) return startDate;
      return startDate + ' – ' + endDate;
    }

    function syncPeriodTypeOptionStyles() {
      const selectedType = getPeriodType();
      document.querySelectorAll('.period-type-option').forEach((option) => {
        const optionType = String(option.dataset.periodType || '').trim();
        const isSelected = optionType === selectedType;
        option.classList.toggle('selected', isSelected);
        const resolvedWrap = option.querySelector('.js-period-resolved-wrap');
        if (resolvedWrap) resolvedWrap.classList.toggle('d-none', !isSelected);
      });
    }

    function updateResolvedPeriodDisplay(label) {
      resolvedPeriodText = String(label || '').trim();
      const selectedType = getPeriodType();
      document.querySelectorAll('.period-type-option').forEach((option) => {
        const optionType = String(option.dataset.periodType || '').trim();
        const labelEl = option.querySelector('.js-period-resolved-label');
        if (!labelEl) return;
        if (optionType === selectedType) {
          labelEl.textContent = resolvedPeriodText || '—';
        }
      });
      syncPeriodTypeOptionStyles();
    }

  function isNonNegativeIntField(value) {
    if (value === null || value === undefined || value === '') return false;
    const n = Number(value);
    return Number.isFinite(n) && Number.isInteger(n) && n >= 0;
  }

  function readNonNegativeIntField(rawValue) {
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;
    const n = Number(rawValue);
    return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : null;
  }

    function getPeriodType() {
      const checked = document.querySelector('input[name="periodType"]:checked');
      return String(checked?.value || 'daily').trim();
    }

    function isDaily() {
      return getPeriodType() === 'daily';
    }

    function getBookById(bookId) {
      return assignedBooks.find((b) => String(b.bookId || b.id) === String(bookId));
    }

    function findEntry(bookId) {
      let entry = reportEntries.find((e) => String(e.bookId) === String(bookId));
      if (!entry) {
        const book = getBookById(bookId) || {};
        entry = {
          bookAssignmentId: book.bookAssignmentId || book.id || '',
          bookId: String(bookId),
          note: '',
          unitCoverage: { mode: 'count', unitCount: null, tocEntryIds: [] },
          pageCoverage: { mode: 'pages_text', pagesText: '', tocEntryIds: [] }
        };
        reportEntries.push(entry);
      }
      return entry;
    }

    function getTocEntriesForBook(book) {
      return Array.isArray(book?.bookTableOfContents) ? book.bookTableOfContents : [];
    }

    function resolveTocEntryLabel(tocEntries, id) {
      const row = tocEntries.find((entry) => String(entry?.id || '') === String(id));
      if (!row) return String(id || '');
      const label = String(row.label || id).trim();
      const start = row.startPage;
      const end = row.endPage;
      if (start) {
        const pages = end && end !== start ? 'pp. ' + start + '–' + end : 'p. ' + start;
        return label + ' (' + pages + ')';
      }
      return label;
    }

    function renderTocSelectedListHtml(tocEntries, selectedIds, kind) {
      const ids = Array.isArray(selectedIds) ? selectedIds : [];
      const emptyLabel = kind === 'pages' ? 'No page ranges selected yet.' : 'No units selected yet.';
      if (!ids.length) {
        return '<div class="small text-muted covering-toc-selected-empty">' + emptyLabel + '</div>';
      }
      return (
        '<ul class="list-unstyled covering-toc-selected-list mb-0">' +
        ids.map((id) => (
          '<li class="covering-toc-selected-item">' +
          '<span class="covering-toc-selected-text">' + escapeHtml(resolveTocEntryLabel(tocEntries, id)) + '</span>' +
          (isReadOnly ? '' : (
            '<button type="button" class="btn btn-link btn-sm p-0 text-danger js-toc-remove" data-toc-id="' + escapeHtml(id) + '" aria-label="Remove selection">' +
            '<i class="bi bi-x-lg"></i></button>'
          )) +
          '</li>'
        )).join('') +
        '</ul>'
      );
    }

    function bindTocRemoveButtons(listEl, panel, kind) {
      if (!listEl || isReadOnly) return;
      listEl.querySelectorAll('.js-toc-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = String(btn.dataset.tocId || '').trim();
          if (!id) return;
          const bookId = String(panel.dataset.bookId || '');
          const entry = findEntry(bookId);
          if (kind === 'units') {
            entry.unitCoverage.tocEntryIds = (entry.unitCoverage?.tocEntryIds || []).filter((rowId) => String(rowId) !== id);
            refreshTocUnitsList(panel, getBookById(bookId), entry);
          } else {
            entry.pageCoverage.tocEntryIds = (entry.pageCoverage?.tocEntryIds || []).filter((rowId) => String(rowId) !== id);
            refreshTocPagesList(panel, getBookById(bookId), entry);
          }
        });
      });
    }

    function refreshTocUnitsList(panel, book, entry) {
      const listEl = panel.querySelector('.js-toc-units-list');
      if (!listEl) return;
      listEl.innerHTML = renderTocSelectedListHtml(getTocEntriesForBook(book), entry.unitCoverage?.tocEntryIds, 'units');
      bindTocRemoveButtons(listEl, panel, 'units');
    }

    function refreshTocPagesList(panel, book, entry) {
      const listEl = panel.querySelector('.js-toc-pages-list');
      if (!listEl) return;
      listEl.innerHTML = renderTocSelectedListHtml(getTocEntriesForBook(book), entry.pageCoverage?.tocEntryIds, 'pages');
      bindTocRemoveButtons(listEl, panel, 'pages');
    }

    function orderedSelectedBooks() {
      return assignedBooks
        .filter((b) => selectedBookIds.has(String(b.bookId || b.id)))
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    }

    function buildStepDefs() {
      const defs = [
        { key: 'context', label: 'Period', panelId: 'wizardStepContext' },
        { key: 'books', label: 'Books', panelId: 'wizardStepBooks' }
      ];
      orderedSelectedBooks().forEach((book) => {
        const id = String(book.bookId || book.id);
        defs.push({
          key: 'book-' + id,
          label: truncate(book.bookTitle || id, 28),
          panelId: 'wizardStepBook_' + id.replace(/[^a-zA-Z0-9_-]/g, '_')
        });
      });
      defs.push({ key: 'finish', label: 'Finish', panelId: 'wizardStepFinish' });
      return defs;
    }

    function syncStepDefs() {
      stepDefs = buildStepDefs();
      renderStepRail();
      renderBookStepPanels();
      if (currentStepIndex >= stepDefs.length) {
        currentStepIndex = Math.max(0, stepDefs.length - 1);
      }
      showStep(currentStepIndex);
    }

    function renderStepRail() {
      if (!stepRail) return;
      stepRail.innerHTML = stepDefs.map((step, index) => {
        const state = index < currentStepIndex ? 'completed' : (index === currentStepIndex ? 'active' : '');
        return '<button type="button" class="wizard-step-pill ' + state + '" data-step-index="' + index + '" tabindex="-1">' +
          escapeHtml(String(index + 1) + '. ' + step.label) + '</button>';
      }).join('');
      stepRail.querySelectorAll('.wizard-step-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
          if (isReadOnly) {
            showStep(Number(pill.dataset.stepIndex || 0));
            return;
          }
          const target = Number(pill.dataset.stepIndex || 0);
          if (target <= currentStepIndex) showStep(target);
        });
      });
      if (window.WizardStepRail) window.WizardStepRail.sync(stepRail);
    }

    function renderBookCover(book) {
      const url = String(book?.coverPhotoUrl || book?.bookCoverPhoto?.url || '').trim();
      if (url) {
        return '<img src="' + escapeHtml(url) + '" alt="" class="covering-book-cover rounded border bg-white">';
      }
      return '<div class="covering-book-cover covering-book-cover-placeholder rounded border bg-light text-muted d-flex align-items-center justify-content-center"><i class="bi bi-book"></i></div>';
    }

    function renderBookGrid() {
      const grid = document.getElementById('wizardBookGrid');
      const emptyMsg = document.getElementById('wizardNoBooksMessage');
      if (!grid) return;
      if (!assignedBooks.length) {
        grid.innerHTML = '';
        emptyMsg?.classList.remove('d-none');
        return;
      }
      emptyMsg?.classList.add('d-none');
      grid.innerHTML = assignedBooks.map((book) => {
        const id = String(book.bookId || book.id);
        const checked = selectedBookIds.has(id);
        return (
          '<label class="covering-book-pick-card border rounded p-3 ' + (checked ? 'selected' : '') + '">' +
          '<input type="checkbox" class="form-check-input js-wizard-book-pick" value="' + escapeHtml(id) + '" ' +
          (checked ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '>' +
          renderBookCover(book) +
          '<div class="covering-book-pick-meta">' +
          '<div class="fw-semibold">' + escapeHtml(book.bookTitle || id) + '</div>' +
          (book.bookIsbn ? '<div class="x-small text-muted font-monospace">' + escapeHtml(book.bookIsbn) + '</div>' : '') +
          '</div></label>'
        );
      }).join('');

      grid.querySelectorAll('.js-wizard-book-pick').forEach((input) => {
        input.addEventListener('change', () => {
          const id = String(input.value || '').trim();
          if (input.checked) {
            selectedBookIds.add(id);
            findEntry(id);
          } else {
            selectedBookIds.delete(id);
            reportEntries = reportEntries.filter((e) => String(e.bookId) !== id);
          }
          const card = input.closest('.covering-book-pick-card');
          if (card) card.classList.toggle('selected', input.checked);
          const onBooksStep = stepDefs[currentStepIndex]?.key === 'books';
          if (onBooksStep) syncStepDefs();
        });
      });
    }

    function renderBookStepPanels() {
      if (!bookStepsHost) return;
      const books = orderedSelectedBooks();
      bookStepsHost.innerHTML = books.map((book, index) => {
        const bookId = String(book.bookId || book.id);
        const panelId = 'wizardStepBook_' + bookId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const entry = findEntry(bookId);
        const unitMode = entry.unitCoverage?.mode || 'count';
        const pageMode = entry.pageCoverage?.mode || 'pages_text';
        const daily = isDaily();
        return (
          '<div class="wizard-step-panel d-none" id="' + panelId + '" data-book-id="' + escapeHtml(bookId) + '">' +
          '<div class="d-flex align-items-center gap-3 mb-4">' +
          renderBookCover(book) +
          '<div><h6 class="fw-bold m-0">' + escapeHtml(book.bookTitle || bookId) + '</h6>' +
          (book.bookIsbn ? '<div class="small text-muted font-monospace">' + escapeHtml(book.bookIsbn) + '</div>' : '') +
          '</div></div>' +
          '<div class="mb-3"><label class="form-label fw-semibold">Units covered</label>' +
          '<div class="d-flex flex-wrap gap-3 mb-2">' +
          '<label><input type="radio" class="form-check-input me-1 js-unit-mode" name="unitMode_' + index + '" value="count" ' + (unitMode === 'count' ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '> Number of units</label>' +
          '<label><input type="radio" class="form-check-input me-1 js-unit-mode" name="unitMode_' + index + '" value="toc_pick" ' + (unitMode === 'toc_pick' ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '> Pick from TOC</label>' +
          '</div>' +
          '<input type="number" min="0" step="1" class="form-control js-unit-count mb-2" value="' + escapeHtml(entry.unitCoverage?.unitCount === null || entry.unitCoverage?.unitCount === undefined ? '' : String(entry.unitCoverage.unitCount)) + '" placeholder="Number of units (0 if less than one unit)" ' + (unitMode !== 'count' ? 'style="display:none"' : '') + (isReadOnly ? ' disabled' : '') + '>' +
          '<div class="js-toc-units-picker-wrap' + (unitMode === 'toc_pick' ? '' : ' d-none') + '">' +
          '<button type="button" class="btn btn-outline-secondary btn-sm js-pick-toc-units" ' + (isReadOnly ? 'disabled' : '') + '><i class="bi bi-list-nested me-1"></i>Pick units from TOC</button>' +
          '<div class="js-toc-units-list covering-toc-selected-host mt-2">' + renderTocSelectedListHtml(book.bookTableOfContents || [], entry.unitCoverage?.tocEntryIds, 'units') + '</div>' +
          '</div></div>' +
          '<div class="mb-3"><label class="form-label fw-semibold">Pages covered</label>' +
          '<div class="d-flex flex-wrap gap-3 mb-2">' +
          '<label><input type="radio" class="form-check-input me-1 js-page-mode" name="pageMode_' + index + '" value="pages_text" ' + (pageMode === 'pages_text' ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '> Pages covered</label>' +
          '<label><input type="radio" class="form-check-input me-1 js-page-mode" name="pageMode_' + index + '" value="page_count" ' + (pageMode === 'page_count' ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '> Number of pages</label>' +
          '<label><input type="radio" class="form-check-input me-1 js-page-mode" name="pageMode_' + index + '" value="toc_pick" ' + (pageMode === 'toc_pick' ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '> Pick from TOC</label>' +
          '</div>' +
          '<input type="text" class="form-control js-pages-text mb-2" value="' + escapeHtml(entry.pageCoverage?.pagesText || '') + '" placeholder="e.g. 12-15, 18" ' + (pageMode !== 'pages_text' ? 'style="display:none"' : '') + (isReadOnly ? ' disabled' : '') + '>' +
          '<input type="number" min="0" step="1" class="form-control js-page-count mb-2" value="' + escapeHtml(entry.pageCoverage?.pageCount === null || entry.pageCoverage?.pageCount === undefined ? '' : String(entry.pageCoverage.pageCount)) + '" placeholder="Number of pages (0 if less than one page)" ' + (pageMode !== 'page_count' ? 'style="display:none"' : '') + (isReadOnly ? ' disabled' : '') + '>' +
          '<div class="js-toc-pages-picker-wrap' + (pageMode === 'toc_pick' ? '' : ' d-none') + '">' +
          '<button type="button" class="btn btn-outline-secondary btn-sm js-pick-toc-pages" ' + (isReadOnly ? 'disabled' : '') + '><i class="bi bi-list-nested me-1"></i>Pick pages from TOC</button>' +
          '<div class="js-toc-pages-list covering-toc-selected-host mt-2">' + renderTocSelectedListHtml(book.bookTableOfContents || [], entry.pageCoverage?.tocEntryIds, 'pages') + '</div>' +
          '</div></div>' +
          (daily ? '' : (
            '<div class="mb-3"><label class="form-label fw-semibold">How many times did you use this book for this period?</label>' +
            '<div class="d-flex flex-wrap gap-3">' +
            '<label><input type="radio" class="form-check-input me-1 js-usage-frequency" name="usageFreq_' + index + '" value="once" ' + (entry.usageFrequency === 'once' ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '> One time</label>' +
            '<label><input type="radio" class="form-check-input me-1 js-usage-frequency" name="usageFreq_' + index + '" value="twice" ' + (entry.usageFrequency === 'twice' ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '> Two times</label>' +
            '<label><input type="radio" class="form-check-input me-1 js-usage-frequency" name="usageFreq_' + index + '" value="more_than_twice" ' + (entry.usageFrequency === 'more_than_twice' ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '> More than twice</label>' +
            '</div></div>' +
            '<div class="mb-3"><label class="form-label fw-semibold">Will you use this book in the next 4 weeks?</label>' +
            '<div class="d-flex flex-wrap gap-3">' +
            '<label><input type="radio" class="form-check-input me-1 js-next-four-weeks" name="nextFourWeeks_' + index + '" value="1" ' + (entry.useInNextFourWeeks === true ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '> Yes</label>' +
            '<label><input type="radio" class="form-check-input me-1 js-next-four-weeks" name="nextFourWeeks_' + index + '" value="0" ' + (entry.useInNextFourWeeks === false ? 'checked' : '') + (isReadOnly ? ' disabled' : '') + '> No</label>' +
            '</div></div>'
          )) +
          '<div class="mb-0"><label class="form-label fw-semibold">Note for this book</label>' +
          '<textarea class="form-control js-entry-note" rows="2" maxlength="2000" ' + (isReadOnly ? 'disabled' : '') + '>' + escapeHtml(entry.note || '') + '</textarea></div>' +
          '</div>'
        );
      }).join('');

      bindBookStepPanels();
    }

    function bindBookStepPanels() {
      bookStepsHost?.querySelectorAll('[data-book-id]').forEach((panel) => {
        const bookId = String(panel.dataset.bookId || '');
        const book = getBookById(bookId) || {};
        const entry = findEntry(bookId);
        if (!entry.unitCoverage) entry.unitCoverage = { tocEntryIds: [] };
        if (!entry.pageCoverage) entry.pageCoverage = { tocEntryIds: [] };

        panel.querySelectorAll('.js-unit-mode').forEach((radio) => {
          radio.addEventListener('change', () => {
            const mode = radio.value;
            panel.querySelector('.js-unit-count').style.display = mode === 'count' ? '' : 'none';
            const unitsWrap = panel.querySelector('.js-toc-units-picker-wrap');
            if (unitsWrap) unitsWrap.classList.toggle('d-none', mode !== 'toc_pick');
            if (mode === 'toc_pick') refreshTocUnitsList(panel, book, entry);
          });
        });
        panel.querySelectorAll('.js-page-mode').forEach((radio) => {
          radio.addEventListener('change', () => {
            const mode = radio.value;
            panel.querySelector('.js-pages-text').style.display = mode === 'pages_text' ? '' : 'none';
            panel.querySelector('.js-page-count').style.display = mode === 'page_count' ? '' : 'none';
            const pagesWrap = panel.querySelector('.js-toc-pages-picker-wrap');
            if (pagesWrap) pagesWrap.classList.toggle('d-none', mode !== 'toc_pick');
            if (mode === 'toc_pick') refreshTocPagesList(panel, book, entry);
          });
        });

        panel.querySelector('.js-pick-toc-units')?.addEventListener('click', () => {
          if (!window.BookTocPicker) return;
          BookTocPicker.open({
            bookTitle: book.bookTitle,
            tableOfContents: book.bookTableOfContents || [],
            mode: 'units',
            selectedIds: entry.unitCoverage.tocEntryIds || [],
            onConfirm: (ids) => {
              entry.unitCoverage.tocEntryIds = ids;
              refreshTocUnitsList(panel, book, entry);
            }
          });
        });

        panel.querySelector('.js-pick-toc-pages')?.addEventListener('click', () => {
          if (!window.BookTocPicker) return;
          BookTocPicker.open({
            bookTitle: book.bookTitle,
            tableOfContents: book.bookTableOfContents || [],
            mode: 'pages',
            selectedIds: entry.pageCoverage.tocEntryIds || [],
            onConfirm: (ids) => {
              entry.pageCoverage.tocEntryIds = ids;
              refreshTocPagesList(panel, book, entry);
            }
          });
        });

        refreshTocUnitsList(panel, book, entry);
        refreshTocPagesList(panel, book, entry);

        panel._entryRef = entry;
        panel._bookId = bookId;
      });
    }

    function syncEntryFromPanel(panel) {
      if (!panel) return;
      const bookId = panel._bookId;
      const book = getBookById(bookId) || {};
      const entry = panel._entryRef || findEntry(bookId);
      const unitMode = panel.querySelector('.js-unit-mode:checked')?.value || 'count';
      const pageMode = panel.querySelector('.js-page-mode:checked')?.value || 'pages_text';
      entry.bookAssignmentId = book.bookAssignmentId || book.id || entry.bookAssignmentId || '';
      entry.bookId = bookId;
      entry.note = String(panel.querySelector('.js-entry-note')?.value || '').trim();
      entry.unitCoverage = {
        mode: unitMode,
        tocEntryIds: entry.unitCoverage?.tocEntryIds || []
      };
      entry.pageCoverage = {
        mode: pageMode,
        tocEntryIds: entry.pageCoverage?.tocEntryIds || []
      };
      if (unitMode === 'count') {
        entry.unitCoverage.unitCount = readNonNegativeIntField(panel.querySelector('.js-unit-count')?.value);
      }
      if (pageMode === 'pages_text') {
        entry.pageCoverage.pagesText = String(panel.querySelector('.js-pages-text')?.value || '').trim();
      }
      if (pageMode === 'page_count') {
        entry.pageCoverage.pageCount = readNonNegativeIntField(panel.querySelector('.js-page-count')?.value);
      }
      if (!isDaily()) {
        entry.usageFrequency = String(panel.querySelector('.js-usage-frequency:checked')?.value || '').trim();
        const nextVal = panel.querySelector('.js-next-four-weeks:checked')?.value;
        entry.useInNextFourWeeks = nextVal === '1' ? true : (nextVal === '0' ? false : null);
      }
    }

    function syncAllBookPanels() {
      bookStepsHost?.querySelectorAll('[data-book-id]').forEach(syncEntryFromPanel);
    }

    function collectEntries() {
      syncAllBookPanels();
      return orderedSelectedBooks().map((book) => {
        const bookId = String(book.bookId || book.id);
        return findEntry(bookId);
      });
    }

    async function validateContextStep() {
      if (isCreate && !String(hiddenClassId?.value || '').trim()) {
        await showWizardMessage('Please select a class.', 'Class required');
        return false;
      }
      if (!String(hidPeriodStart?.value || '').trim() || !String(hidPeriodEnd?.value || '').trim()) {
        await showWizardMessage(
          'Please set an anchor date so the reporting period can be resolved.',
          'Period required'
        );
        return false;
      }
      return true;
    }

    async function validateBooksStep() {
      if (!selectedBookIds.size) {
        await showWizardMessage('Please select at least one book you used.', 'Books required');
        return false;
      }
      return true;
    }

    async function validateBookPanel(panel) {
      syncEntryFromPanel(panel);
      const entry = panel._entryRef;
      const unitMode = entry.unitCoverage?.mode || 'count';
      const pageMode = entry.pageCoverage?.mode || 'pages_text';
      if (unitMode === 'count' && !isNonNegativeIntField(entry.unitCoverage?.unitCount)) {
        await showWizardMessage('Please enter the number of units covered (use 0 if less than one full unit).', 'Units covered');
        return false;
      }
      if (unitMode === 'toc_pick' && !(entry.unitCoverage?.tocEntryIds || []).length) {
        await showWizardMessage('Please pick units from the table of contents.', 'Units covered');
        return false;
      }
      if (pageMode === 'pages_text' && !String(entry.pageCoverage?.pagesText || '').trim()) {
        await showWizardMessage('Please enter the pages covered.', 'Pages covered');
        return false;
      }
      if (pageMode === 'page_count' && !isNonNegativeIntField(entry.pageCoverage?.pageCount)) {
        await showWizardMessage('Please enter the number of pages covered (use 0 if less than one full page).', 'Pages covered');
        return false;
      }
      if (pageMode === 'toc_pick' && !(entry.pageCoverage?.tocEntryIds || []).length) {
        await showWizardMessage('Please pick page ranges from the table of contents.', 'Pages covered');
        return false;
      }
      if (!isDaily()) {
        if (!entry.usageFrequency) {
          await showWizardMessage('Please select how many times you used this book for the period.', 'Usage frequency');
          return false;
        }
        if (entry.useInNextFourWeeks === null || entry.useInNextFourWeeks === undefined) {
          await showWizardMessage('Please indicate whether you will use this book in the next 4 weeks.', 'Next 4 weeks');
          return false;
        }
      }
      return true;
    }

    async function validateCurrentStep() {
      const step = stepDefs[currentStepIndex];
      if (!step) return true;
      if (step.key === 'context') return validateContextStep();
      if (step.key === 'books') return validateBooksStep();
      if (step.key.startsWith('book-')) {
        const panel = document.getElementById(step.panelId);
        return panel ? validateBookPanel(panel) : true;
      }
      return true;
    }

    function renderFinishSummary() {
      if (!finishSummary) return;
      const classTitle = document.getElementById('contextClassDisplay')?.textContent || '';
      const teacher = document.getElementById('contextTeacherDisplay')?.textContent || '';
      const period = resolvedPeriodText || '—';
      const books = orderedSelectedBooks();
      finishSummary.innerHTML = [
        '<div class="row g-2 small">',
        '<div class="col-md-6"><span class="text-muted">Class:</span> ' + escapeHtml(classTitle) + '</div>',
        '<div class="col-md-6"><span class="text-muted">Teacher:</span> ' + escapeHtml(teacher) + '</div>',
        '<div class="col-md-6"><span class="text-muted">Period:</span> ' + escapeHtml(period) + '</div>',
        '<div class="col-md-6"><span class="text-muted">Books:</span> ' + escapeHtml(String(books.length)) + '</div>',
        '</div>',
        '<ul class="list-unstyled mt-3 mb-0">' +
        books.map((b) => '<li class="mb-1"><i class="bi bi-journal-text me-1"></i>' + escapeHtml(b.bookTitle || b.bookId) + '</li>').join('') +
        '</ul>'
      ].join('');
    }

    function showStep(index) {
      if (stepDefs[currentStepIndex]?.key?.startsWith('book-')) {
        const prevPanel = document.getElementById(stepDefs[currentStepIndex].panelId);
        syncEntryFromPanel(prevPanel);
      }
      currentStepIndex = Math.max(0, Math.min(index, stepDefs.length - 1));
      document.querySelectorAll('.wizard-step-panel').forEach((el) => el.classList.add('d-none'));
      const panelId = stepDefs[currentStepIndex]?.panelId;
      const panel = document.getElementById(panelId);
      if (panel) panel.classList.remove('d-none');

      const pct = stepDefs.length > 1 ? Math.round((currentStepIndex / (stepDefs.length - 1)) * 100) : 100;
      if (progressBar) progressBar.style.width = pct + '%';
      if (stepLabel) stepLabel.textContent = 'Step ' + (currentStepIndex + 1) + ' of ' + stepDefs.length + ': ' + (stepDefs[currentStepIndex]?.label || '');

      if (stepDefs[currentStepIndex]?.key === 'finish') renderFinishSummary();

      if (btnBack) btnBack.classList.toggle('d-none', currentStepIndex === 0 || isReadOnly);
      if (btnNext) btnNext.classList.toggle('d-none', currentStepIndex >= stepDefs.length - 1 || isReadOnly);
      if (btnSaveDraft) btnSaveDraft.classList.toggle('d-none', isReadOnly || currentStepIndex === 0);
      if (btnSubmit) btnSubmit.classList.toggle('d-none', currentStepIndex !== stepDefs.length - 1 || isReadOnly);

      renderStepRail();
    }

    async function resolvePeriod() {
      const classId = String(hiddenClassId?.value || '').trim();
      const periodType = getPeriodType();
      const anchorDate = String(anchorDateInput?.value || '').trim();
      if (!classId || !anchorDate) return;
      try {
        const params = new URLSearchParams({ classId, periodType, anchorDate });
        const res = await fetch('/school/library/book-covering/api/resolve-period?' + params.toString(), {
          headers: { Accept: 'application/json' }
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Could not resolve period.');
        hidPeriodStart.value = data.periodStartDate || '';
        hidPeriodEnd.value = data.periodEndDate || '';
        const label = formatPeriodLabel(data.periodStartDate, data.periodEndDate);
        updateResolvedPeriodDisplay(label);
      } catch (error) {
        console.warn(error);
      }
    }

    async function loadAssignedBooksForClass(classId) {
      const res = await fetch('/school/library/book-covering/api/assigned-books/' + encodeURIComponent(classId), {
        headers: { Accept: 'application/json' }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Could not load assigned books.');
      assignedBooks.length = 0;
      (data.results || []).forEach((row) => assignedBooks.push(row));
      renderBookGrid();
    }

    function syncHiddenFields() {
      if (hiddenEntries) hiddenEntries.value = JSON.stringify(collectEntries());
      if (hiddenNotes && overallNotesInput) hiddenNotes.value = String(overallNotesInput.value || '').trim();
    }

    async function submitWithAction(action) {
      syncHiddenFields();
      if (action === 'submit') {
        const entries = collectEntries();
        if (!entries.length) {
          await showWizardMessage('Please select at least one book.', 'Books required');
          return;
        }
        for (const panel of bookStepsHost?.querySelectorAll('[data-book-id]') || []) {
          if (!(await validateBookPanel(panel))) return;
        }
      }
      let actionInput = form.querySelector('input[name="submitAction"]');
      if (!actionInput) {
        actionInput = document.createElement('input');
        actionInput.type = 'hidden';
        actionInput.name = 'submitAction';
        form.appendChild(actionInput);
      }
      actionInput.value = action;
      form.submit();
    }

    document.querySelectorAll('input[name="periodType"]').forEach((input) => {
      input.addEventListener('change', () => {
        syncPeriodTypeOptionStyles();
        resolvePeriod();
        if (stepDefs[currentStepIndex]?.key?.startsWith('book-')) syncStepDefs();
      });
    });
    anchorDateInput?.addEventListener('change', resolvePeriod);

    if (isCreate) {
      document.getElementById('btnPickClass')?.addEventListener('click', () => {
        if (!window.GenericPicker || !window.GenericPickerPresets) return;
        const context = typeof GenericPickerContexts?.activeOrganizationScope === 'function'
          ? GenericPickerContexts.activeOrganizationScope({ label: 'Active Organization' })
          : null;
        GenericPicker.open(GenericPickerPresets.class({
          title: 'Select Class',
          icon: 'bi-mortarboard',
          context,
          onSelect: async (item) => {
            const id = String(item?.id || '').trim();
            if (!id) return;
            hiddenClassId.value = id;
            const label = item.label || item.title || item.name || id;
            const pickedLabel = document.getElementById('pickedClassLabel');
            const classDisplay = document.getElementById('contextClassDisplay');
            if (pickedLabel) pickedLabel.innerHTML = 'Selected: <span class="fw-semibold text-dark">' + escapeHtml(label) + '</span>';
            if (classDisplay) {
              classDisplay.textContent = label;
              classDisplay.classList.remove('covering-context-value--empty');
            }
            selectedBookIds.clear();
            reportEntries = [];
            await loadAssignedBooksForClass(id);
            resolvePeriod();
          }
        }));
      });
    }

    btnBack?.addEventListener('click', () => showStep(currentStepIndex - 1));
    btnNext?.addEventListener('click', async () => {
      if (!(await validateCurrentStep())) return;
      if (stepDefs[currentStepIndex]?.key === 'books') syncStepDefs();
      showStep(currentStepIndex + 1);
    });
    btnSaveDraft?.addEventListener('click', () => {
      submitWithAction('draft');
    });
    btnSubmit?.addEventListener('click', (event) => {
      event.preventDefault();
      submitWithAction('submit');
    });

    form?.addEventListener('submit', (event) => {
      if (isReadOnly) {
        event.preventDefault();
      }
    });

    renderBookGrid();
    syncStepDefs();
    resolvedPeriodText = formatPeriodLabel(hidPeriodStart?.value, hidPeriodEnd?.value);
    updateResolvedPeriodDisplay(resolvedPeriodText);
    resolvePeriod();

    const classDisplayEl = document.getElementById('contextClassDisplay');
    if (classDisplayEl && classTitle && !String(classDisplayEl.textContent || '').trim()) {
      classDisplayEl.textContent = classTitle;
    }

    if (isCreate && String(hiddenClassId?.value || '').trim() && !assignedBooks.length) {
      loadAssignedBooksForClass(hiddenClassId.value).catch(() => {});
    }
  }

  window.BookCoveringReportWizard = { init };
})();
