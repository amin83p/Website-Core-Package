(function initWordOfDayRejectionReasonModal(global) {
  'use strict';

  const NOTE_VIEW_STATUSES = new Set(['rejected', 'reopened', 'on_hold', 'archived']);

  const VIEW_LABELS = {
    rejected: { title: 'Rejection reason', noteLabel: 'Reason', byLabel: 'Rejected by', emptyNote: 'No reason was recorded.' },
    reopened: { title: 'Reopen note', noteLabel: 'Note', byLabel: 'Reopened', emptyNote: 'No note was recorded.' },
    on_hold: { title: 'On hold note', noteLabel: 'Note', byLabel: 'Placed on hold', emptyNote: 'No note was recorded.' },
    archived: { title: 'Archive note', noteLabel: 'Note', byLabel: 'Archived', emptyNote: 'No note was recorded.' },
    _default: { title: 'Workflow note', noteLabel: 'Note', byLabel: 'Recorded', emptyNote: 'No note was recorded.' }
  };

  const PROMPT_ACTIONS = {
    reject: {
      title: 'Reject word',
      noteLabel: 'Reason for rejection',
      hint: 'Authors receive this note in a system message.',
      placeholder: 'Explain why this word was rejected…',
      confirmText: 'Reject word',
      confirmClass: 'btn-danger',
      noteRequired: true
    },
    reopen: {
      title: 'Reopen word',
      noteLabel: 'Optional note',
      hint: 'Explain why this word is being reopened (optional).',
      placeholder: 'Add a note for authors or reviewers…',
      confirmText: 'Reopen',
      confirmClass: 'btn-primary',
      noteRequired: false
    },
    hold: {
      title: 'Place on hold',
      noteLabel: 'Optional note',
      hint: 'Explain why this word is on hold (optional).',
      placeholder: 'Add a note for authors or reviewers…',
      confirmText: 'Place on hold',
      confirmClass: 'btn-info text-dark',
      noteRequired: false
    },
    archive: {
      title: 'Archive word',
      noteLabel: 'Optional note',
      hint: 'Explain why this word is archived (optional).',
      placeholder: 'Add a note for authors or reviewers…',
      confirmText: 'Archive',
      confirmClass: 'btn-dark',
      noteRequired: false
    }
  };

  const PROMPT_ACTION_SET = new Set(Object.keys(PROMPT_ACTIONS));

  let bsModal = null;
  let promptResolver = null;
  let promptConfirmed = false;
  let currentPromptAction = 'reject';

  function qs(id) {
    return document.getElementById(id);
  }

  function formatWhen(iso) {
    const raw = String(iso || '').trim();
    if (!raw) return '—';
    try {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return raw.slice(0, 10) || raw;
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_) {
      return raw.slice(0, 10) || raw;
    }
  }

  function statusHasWorkflowNote(status) {
    return NOTE_VIEW_STATUSES.has(String(status || '').toLowerCase());
  }

  function workflowViewFromEntry(entry) {
    const status = String(entry?.status || '').toLowerCase();
    const wf = entry?.workflow && typeof entry.workflow === 'object' ? entry.workflow : {};
    const note = String(wf.reviewerNote || '').trim();
    let actorName = '';
    let actorAt = '';
    if (status === 'rejected') {
      actorName = String(wf.rejectedByName || '').trim();
      actorAt = String(wf.rejectedAt || '').trim();
    } else {
      actorAt = String(entry?.audit?.lastUpdateDateTime || '').trim();
    }
    return { status, note, actorName, actorAt };
  }

  function getModal() {
    const el = qs('wordOfDayRejectionReasonModal');
    if (!el || !global.bootstrap?.Modal) return null;
    global.SchoolModalStack?.mountModalToBody?.(el);
    if (!bsModal) {
      bsModal = global.bootstrap.Modal.getOrCreateInstance(el);
      el.addEventListener('shown.bs.modal', () => {
        global.SchoolModalStack?.raiseAboveOpenModals?.(el);
      });
      el.addEventListener('hidden.bs.modal', () => {
        global.SchoolModalStack?.clearRaise?.(el);
        if (promptResolver) {
          const resolve = promptResolver;
          promptResolver = null;
          resolve(promptConfirmed ? String(qs('wodRejectionReasonInput')?.value || '').trim() : null);
        }
        promptConfirmed = false;
      });
      qs('wodRejectionReasonConfirmBtn')?.addEventListener('click', () => {
        const config = PROMPT_ACTIONS[currentPromptAction] || PROMPT_ACTIONS.reject;
        const text = String(qs('wodRejectionReasonInput')?.value || '').trim();
        if (config.noteRequired && !text) {
          qs('wodRejectionReasonInput')?.focus();
          qs('wodRejectionReasonInput')?.classList.add('is-invalid');
          return;
        }
        qs('wodRejectionReasonInput')?.classList.remove('is-invalid');
        promptConfirmed = true;
        bsModal?.hide();
      });
      qs('wodRejectionReasonInput')?.addEventListener('input', () => {
        qs('wodRejectionReasonInput')?.classList.remove('is-invalid');
      });
    }
    return bsModal;
  }

  function setWordLine(word) {
    const line = qs('wodRejectionReasonWordLine');
    const w = String(word || '').trim();
    if (!line) return;
    if (w) {
      line.textContent = `Word: ${w}`;
      line.classList.remove('d-none');
    } else {
      line.textContent = '';
      line.classList.add('d-none');
    }
  }

  function setMode(mode) {
    const view = qs('wodRejectionReasonViewBlock');
    const prompt = qs('wodRejectionReasonPromptBlock');
    const confirmBtn = qs('wodRejectionReasonConfirmBtn');
    const closeBtn = qs('wodRejectionReasonCloseBtn');
    const cancelBtn = qs('wodRejectionReasonCancelBtn');
    const isPrompt = mode === 'prompt';
    view?.classList.toggle('d-none', isPrompt);
    prompt?.classList.toggle('d-none', !isPrompt);
    confirmBtn?.classList.toggle('d-none', !isPrompt);
    closeBtn?.classList.toggle('d-none', isPrompt);
    cancelBtn?.classList.toggle('d-none', !isPrompt);
  }

  function applyPromptChrome(action) {
    const config = PROMPT_ACTIONS[action] || PROMPT_ACTIONS.reject;
    currentPromptAction = action;
    const title = qs('wordOfDayRejectionReasonModalLabel');
    if (title) title.textContent = config.title;
    const label = qs('wodRejectionReasonPromptLabel');
    if (label) label.textContent = config.noteLabel;
    const hint = qs('wodRejectionReasonPromptHint');
    if (hint) {
      hint.textContent = config.hint;
      hint.classList.remove('d-none');
    }
    const input = qs('wodRejectionReasonInput');
    if (input) input.placeholder = config.placeholder;
    const confirmBtn = qs('wodRejectionReasonConfirmBtn');
    if (confirmBtn) {
      confirmBtn.textContent = config.confirmText;
      confirmBtn.className = `btn ${config.confirmClass}`;
    }
  }

  function applyViewChrome(status) {
    const labels = VIEW_LABELS[status] || VIEW_LABELS._default;
    const title = qs('wordOfDayRejectionReasonModalLabel');
    if (title) title.textContent = labels.title;
    const noteLabel = qs('wodRejectionReasonViewNoteLabel');
    if (noteLabel) noteLabel.textContent = labels.noteLabel;
    const byLabel = qs('wodRejectionReasonViewByLabel');
    if (byLabel) byLabel.textContent = labels.byLabel;
    return labels;
  }

  function showWorkflowNoteView(options = {}) {
    const modal = getModal();
    if (!modal) return;
    setMode('view');
    const status = String(options.status || options.entry?.status || 'rejected').toLowerCase();
    const labels = applyViewChrome(status);
    setWordLine(options.word || options.entry?.word);
    const fields = options.note !== undefined
      ? {
        note: String(options.note || '').trim(),
        actorName: String(options.actorName || '').trim(),
        actorAt: String(options.actorAt || '').trim()
      }
      : workflowViewFromEntry(options.entry || {});
    const noteEl = qs('wodRejectionReasonViewText');
    if (noteEl) {
      noteEl.textContent = fields.note || labels.emptyNote;
      noteEl.classList.toggle('text-muted', !fields.note);
      noteEl.classList.toggle('fst-italic', !fields.note);
    }
    const byEl = qs('wodRejectionReasonViewBy');
    if (byEl) {
      const when = formatWhen(fields.actorAt);
      if (fields.actorName && fields.actorAt) byEl.textContent = `${fields.actorName} · ${when}`;
      else if (fields.actorName) byEl.textContent = fields.actorName;
      else if (fields.actorAt) byEl.textContent = when;
      else byEl.textContent = '—';
    }
    const input = qs('wodRejectionReasonInput');
    if (input) input.value = '';
    modal.show();
  }

  function entryHasWorkflowNote(entry) {
    return Boolean(String(entry?.workflow?.reviewerNote || '').trim());
  }

  function showFromEntry(entry) {
    if (!entry) return;
    if (!entryHasWorkflowNote(entry) && !statusHasWorkflowNote(entry.status)) return;
    showWorkflowNoteView({ entry });
  }

  function promptWorkflowNote(options = {}) {
    const action = String(options.action || 'reject').toLowerCase();
    const config = PROMPT_ACTIONS[action];
    if (!config) return Promise.resolve(null);
    const modal = getModal();
    if (!modal) return Promise.resolve(null);
    setMode('prompt');
    applyPromptChrome(action);
    setWordLine(options.word);
    const input = qs('wodRejectionReasonInput');
    if (input) {
      input.value = '';
      input.classList.remove('is-invalid');
    }
    return new Promise((resolve) => {
      promptResolver = resolve;
      promptConfirmed = false;
      modal.show();
      queueMicrotask(() => input?.focus());
    });
  }

  function promptRejectReason(options = {}) {
    return promptWorkflowNote({ ...options, action: 'reject' });
  }

  function isPromptableWorkflowAction(action) {
    return PROMPT_ACTION_SET.has(String(action || '').toLowerCase());
  }

  global.WordOfDayRejectionReasonModal = {
    promptRejectReason,
    promptWorkflowNote,
    showWorkflowNoteView,
    showFromEntry,
    showRejectionReason: showWorkflowNoteView,
    workflowViewFromEntry,
    statusHasWorkflowNote,
    entryHasWorkflowNote,
    isPromptableWorkflowAction,
    NOTE_VIEW_STATUSES
  };
}(typeof window !== 'undefined' ? window : globalThis));