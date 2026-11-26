(function initWordOfDayEntryDetailUi(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusBadgeClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'approved') return 'bg-success';
    if (s === 'submitted') return 'bg-warning text-dark';
    if (s === 'rejected') return 'bg-danger';
    if (s === 'on_hold') return 'bg-info text-dark';
    if (s === 'archived') return 'bg-dark';
    if (s === 'reopened') return 'bg-primary';
    return 'bg-secondary';
  }

  function formatTypeLabels(entry, labels) {
    const types = Array.isArray(entry.wordTypes) && entry.wordTypes.length
      ? entry.wordTypes
      : (entry.wordType ? [entry.wordType] : []);
    return types.map((k) => labels?.[k] || k).join(', ') || '—';
  }

  function renderActionButtons(caps, actionClass, options = {}) {
    const cls = String(actionClass || 'wod-entry-action').trim() || 'wod-entry-action';
    const btnSize = options.size === 'md' ? 'btn-md' : (options.size === 'sm' ? 'btn-sm' : 'btn-sm');
    const btns = [];
    const add = (action, label, btnClass, icon) => {
      const ico = icon ? `<i class="bi ${icon} me-1"></i>` : '';
      btns.push(
        `<button type="button" class="btn ${btnSize} ${btnClass} wod-status-action-btn ${cls}" data-wod-action="${action}">${ico}${label}</button>`
      );
    };
    if (caps?.canSubmit) add('submit', 'Submit', 'btn-warning text-dark', 'bi-send');
    if (caps?.canApprove) add('approve', 'Approve', 'btn-success', 'bi-check-circle-fill');
    if (caps?.canReject) add('reject', 'Reject', 'btn-danger', 'bi-x-circle-fill');
    if (caps?.canReopen) add('reopen', 'Reopen', 'btn-primary', 'bi-arrow-counterclockwise');
    if (caps?.canHold) add('hold', 'On hold', 'btn-info text-dark', 'bi-pause-circle-fill');
    if (caps?.canArchive) add('archive', 'Archive', 'btn-dark', 'bi-archive-fill');
    if (caps?.canDelete) add('delete', 'Delete', 'btn-outline-danger', 'bi-trash');
    return btns.join(' ');
  }

  function renderEditLink(entry, caps) {
    if (!caps?.canEdit || !entry?.id) return '';
    const id = encodeURIComponent(String(entry.id));
    return `<a href="/school/word-of-day/edit/${id}" class="btn btn-md btn-outline-primary me-auto" target="_blank" rel="noopener noreferrer" aria-label="Edit word (opens in new tab)"><i class="bi bi-pencil-square me-1"></i>Edit</a>`;
  }

  function workflowLoadingMessage(action) {
    const key = String(action || '').toLowerCase();
    const labels = {
      submit: 'Submitting for review…',
      approve: 'Approving…',
      reject: 'Rejecting…',
      reopen: 'Reopening…',
      hold: 'Placing on hold…',
      archive: 'Archiving…',
      delete: 'Deleting…'
    };
    return labels[key] || 'Updating status…';
  }

  function resolveMediaUrl(media) {
    if (!media || typeof media !== 'object') return '';
    return String(media.url || media.storagePath || media.path || '').trim();
  }

  function formatAudioTime(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(total / 60);
    const secs = Math.floor(total % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function renderModalPhotoFrame(entry, photoUrl) {
    const wordAlt = escapeHtml(entry?.word || 'Word illustration');
    const fileName = escapeHtml(entry?.photo?.fileName || `${entry?.word || 'word'}-illustration`);
    const mime = escapeHtml(entry?.photo?.mimeType || 'image/jpeg');
    if (photoUrl) {
      const safeUrl = escapeHtml(photoUrl);
      return `<button type="button" class="wod-entry-photo-open" data-wod-photo-open data-url="${safeUrl}" data-filename="${fileName}" data-mime="${mime}" aria-label="Open illustration full size">
        <img src="${safeUrl}" alt="${wordAlt}" class="wod-entry-media-img">
        <span class="wod-entry-photo-zoom-hint"><i class="bi bi-arrows-fullscreen" aria-hidden="true"></i> View</span>
      </button>`;
    }
    return `<div class="wod-entry-photo-empty" aria-hidden="true"><i class="bi bi-image d-block mb-2 fs-4 opacity-50"></i><span class="small text-muted">No illustration</span></div>`;
  }

  function renderStylishAudioPlayer(entry, audioUrl) {
    const audioMime = escapeHtml(entry?.audio?.mimeType || 'audio/mpeg');
    const audioName = escapeHtml(entry?.audio?.fileName || 'Pronunciation');
    const safeUrl = escapeHtml(audioUrl);
    return `<div class="wod-stylish-audio-player" data-wod-audio-player>
      <audio class="wod-audio-element" preload="metadata" playsinline>
        <source src="${safeUrl}" type="${audioMime}">
      </audio>
      <div class="wod-audio-player-inner">
        <button type="button" class="wod-audio-play-toggle" data-wod-audio-play aria-label="Play pronunciation">
          <i class="bi bi-play-fill wod-audio-icon-play" aria-hidden="true"></i>
          <i class="bi bi-pause-fill wod-audio-icon-pause d-none" aria-hidden="true"></i>
        </button>
        <div class="wod-audio-player-main">
          <div class="wod-audio-player-label"><i class="bi bi-soundwave me-1" aria-hidden="true"></i>Pronunciation</div>
          <div class="wod-audio-player-title text-truncate">${audioName}</div>
          <input type="range" class="form-range wod-audio-seek" data-wod-audio-seek min="0" max="100" value="0" step="0.1" aria-label="Seek">
          <div class="wod-audio-times">
            <span data-wod-audio-current>0:00</span>
            <span data-wod-audio-duration>0:00</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderMediaBlock(entry, options = {}) {
    const layout = options.layout === 'compact' ? 'compact' : 'modal';
    const photoUrl = resolveMediaUrl(entry?.photo);
    const audioUrl = resolveMediaUrl(entry?.audio);
    const wordAlt = escapeHtml(entry?.word || 'Word illustration');
    if (!photoUrl && !audioUrl && !entry?.videoUrl) return '';

    if (layout === 'compact') {
      const photoHtml = photoUrl
        ? `<figure class="wod-entry-media-photo mt-2 mb-0"><img src="${escapeHtml(photoUrl)}" alt="${wordAlt}" class="rounded border" style="max-height:160px;object-fit:contain;"></figure>`
        : '';
      const audioMime = escapeHtml(entry?.audio?.mimeType || 'audio/mpeg');
      const audioHtml = audioUrl
        ? `<figure class="wod-entry-media-audio mt-2 mb-0"><audio controls class="d-block w-100"><source src="${escapeHtml(audioUrl)}" type="${audioMime}"></audio></figure>`
        : '';
      const videoHtml = entry?.videoUrl
        ? `<a href="${escapeHtml(entry.videoUrl)}" class="btn btn-sm btn-outline-primary mt-2" target="_blank" rel="noopener noreferrer">Video</a>`
        : '';
      return `<section class="wod-entry-media" aria-label="Media">${photoHtml}${audioHtml}${videoHtml}</section>`;
    }

    const showPhotoFrame = Boolean(photoUrl || audioUrl || entry?.videoUrl);
    const photoFrame = showPhotoFrame ? `<div class="wod-entry-photo-frame">${renderModalPhotoFrame(entry, photoUrl)}</div>` : '';
    const audioHtml = audioUrl ? renderStylishAudioPlayer(entry, audioUrl) : '';
    const videoHtml = entry?.videoUrl
      ? `<a href="${escapeHtml(entry.videoUrl)}" class="btn btn-md btn-outline-primary w-100" target="_blank" rel="noopener noreferrer"><i class="bi bi-play-btn me-2"></i>Watch video</a>`
      : '';

    return `<section class="wod-entry-media wod-entry-media-modal mt-3" aria-label="Media">
      <div class="wod-entry-media-grid">
        ${photoFrame}
        ${audioHtml ? `<div class="wod-entry-audio-slot">${audioHtml}</div>` : '<div class="wod-entry-audio-slot wod-entry-audio-slot-empty" aria-hidden="true"></div>'}
      </div>
      ${videoHtml}
    </section>`;
  }

  function initAudioPlayer(root) {
    const wrap = root;
    if (!wrap) return;
    const audio = wrap.querySelector('.wod-audio-element');
    const playBtn = wrap.querySelector('[data-wod-audio-play]');
    const seek = wrap.querySelector('[data-wod-audio-seek]');
    const iconPlay = wrap.querySelector('.wod-audio-icon-play');
    const iconPause = wrap.querySelector('.wod-audio-icon-pause');
    const currentEl = wrap.querySelector('[data-wod-audio-current]');
    const durationEl = wrap.querySelector('[data-wod-audio-duration]');
    if (!audio || !playBtn || !seek) return;

    const syncPlayState = (playing) => {
      if (iconPlay) iconPlay.classList.toggle('d-none', playing);
      if (iconPause) iconPause.classList.toggle('d-none', !playing);
      wrap.classList.toggle('is-playing', playing);
    };

    const syncSeek = () => {
      const duration = Number(audio.duration);
      if (!Number.isFinite(duration) || duration <= 0) return;
      if (currentEl) currentEl.textContent = formatAudioTime(audio.currentTime);
      if (durationEl) durationEl.textContent = formatAudioTime(duration);
      seek.value = String((audio.currentTime / duration) * 100);
    };

    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        void audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    });

    audio.addEventListener('play', () => syncPlayState(true));
    audio.addEventListener('pause', () => syncPlayState(false));
    audio.addEventListener('ended', () => syncPlayState(false));
    audio.addEventListener('loadedmetadata', syncSeek);
    audio.addEventListener('timeupdate', syncSeek);

    seek.addEventListener('input', () => {
      const duration = Number(audio.duration);
      if (!Number.isFinite(duration) || duration <= 0) return;
      const pct = Number(seek.value);
      audio.currentTime = (pct / 100) * duration;
      syncSeek();
    });
  }

  function bindEntryMediaInteractions(container) {
    const root = container && typeof container.querySelector === 'function' ? container : document;
    root.querySelectorAll('[data-wod-photo-open]').forEach((btn) => {
      if (btn.dataset.wodPhotoBound === '1') return;
      btn.dataset.wodPhotoBound = '1';
      btn.addEventListener('click', () => {
        const url = String(btn.getAttribute('data-url') || '').trim();
        const name = String(btn.getAttribute('data-filename') || 'Image').trim();
        const mime = String(btn.getAttribute('data-mime') || '').trim();
        if (!url) return;
        if (global.ImageViewer && typeof global.ImageViewer.open === 'function') {
          const viewerEl = document.getElementById('imageViewerModal');
          if (viewerEl) {
            global.SchoolModalStack?.mountModalToBody?.(viewerEl);
            viewerEl.addEventListener('shown.bs.modal', function wodImgViewerStackRaise() {
              viewerEl.removeEventListener('shown.bs.modal', wodImgViewerStackRaise);
              global.SchoolModalStack?.raiseAboveOpenModals?.(viewerEl);
            });
          }
          global.ImageViewer.open(url, name, mime);
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      });
    });
    root.querySelectorAll('[data-wod-audio-player]').forEach((player) => {
      if (player.dataset.wodAudioBound === '1') return;
      player.dataset.wodAudioBound = '1';
      initAudioPlayer(player);
    });
  }

  function formatDisplayDate(iso) {
    const raw = String(iso || '').trim();
    if (!raw) return '—';
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }
    return raw.length >= 10 ? raw.slice(0, 10) : raw;
  }

  function renderDisplayChip(displayCount) {
    const count = Math.max(0, Number(displayCount || 0));
    const timesLabel = count === 1 ? 'time' : 'times';
    return `<span class="wod-entry-display-chip badge rounded-pill text-bg-light border text-dark" title="Times shown on dashboard">
      <i class="bi bi-display me-1" aria-hidden="true"></i><span class="fw-semibold">${count}</span>
      <span class="text-muted fw-normal ms-1">${timesLabel}</span>
    </span>`;
  }

  function formatShortDate(iso) {
    const raw = String(iso || '').trim();
    if (!raw) return '—';
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }
    return raw.length >= 10 ? raw.slice(0, 10) : raw;
  }

  function tableRowsFromVoters(voters, emptyText) {
    const list = Array.isArray(voters) ? voters : [];
    if (!list.length) {
      return `<tr><td colspan="2" class="text-muted small">${escapeHtml(emptyText)}</td></tr>`;
    }
    return list.map((row) => {
      const name = escapeHtml(row.voterName || '—');
      const when = escapeHtml(formatShortDate(row.votedAt));
      return `<tr><td>${name}</td><td class="text-nowrap text-muted small">${when}</td></tr>`;
    }).join('');
  }

  function renderPublicFeedbackModalBody(payload, wordLabel) {
    const stats = payload?.publicFeedback?.stats || {};
    const likes = Number(stats.likes || 0);
    const dislikes = Number(stats.dislikes || 0);
    const comments = Array.isArray(payload?.publicFeedback?.dislikeComments)
      ? payload.publicFeedback.dislikeComments
      : [];
    const voters = payload?.reactionVoters || { likes: [], dislikes: [] };
    const visits = Array.isArray(payload?.pageVisits) ? payload.pageVisits : [];
    const title = escapeHtml(wordLabel || payload?.word || 'Word');

    const commentRows = comments.length
      ? comments.map((row) => {
        const name = escapeHtml(row.voterName || '—');
        const text = escapeHtml(row.text || '');
        const when = escapeHtml(formatShortDate(row.updatedAt || row.createdAt));
        return `<tr><td>${name}</td><td>${text}</td><td class="text-nowrap small text-muted">${when}</td></tr>`;
      }).join('')
      : '<tr><td colspan="3" class="text-muted small">No dislike comments yet.</td></tr>';

    const visitRows = visits.length
      ? visits.map((row) => {
        const name = escapeHtml(row.visitorName || '—');
        const secs = Math.max(0, Math.round(Number(row.durationMs || 0) / 1000));
        const when = escapeHtml(formatShortDate(row.viewedAt));
        const dateKey = escapeHtml(row.dateKey || '—');
        return `<tr><td>${name}</td><td class="text-nowrap">${secs}s</td><td class="text-nowrap small">${dateKey}</td><td class="text-nowrap small text-muted">${when}</td></tr>`;
      }).join('')
      : '<tr><td colspan="4" class="text-muted small">No qualified visits yet (visitors must stay at least 3 seconds).</td></tr>';

    return `
      <p class="text-muted small mb-3">Feedback for <span class="fw-semibold">${title}</span>. Comments and visitor names are staff-only.</p>
      <div class="d-flex flex-wrap gap-2 mb-3">
        <span class="badge text-bg-success-subtle border text-success-emphasis"><i class="bi bi-hand-thumbs-up me-1"></i>${likes} like${likes === 1 ? '' : 's'}</span>
        <span class="badge text-bg-danger-subtle border text-danger-emphasis"><i class="bi bi-hand-thumbs-down me-1"></i>${dislikes} dislike${dislikes === 1 ? '' : 's'}</span>
        <span class="badge text-bg-light border"><i class="bi bi-eye me-1"></i>${visits.length} visit${visits.length === 1 ? '' : 's'} (3s+)</span>
      </div>
      <h3 class="h6">Likes</h3>
      <div class="table-responsive mb-3">
        <table class="table table-sm table-striped align-middle mb-0">
          <thead class="table-light"><tr><th scope="col">Visitor</th><th scope="col">When</th></tr></thead>
          <tbody>${tableRowsFromVoters(voters.likes, 'No likes yet.')}</tbody>
        </table>
      </div>
      <h3 class="h6">Dislikes</h3>
      <div class="table-responsive mb-3">
        <table class="table table-sm table-striped align-middle mb-0">
          <thead class="table-light"><tr><th scope="col">Visitor</th><th scope="col">When</th></tr></thead>
          <tbody>${tableRowsFromVoters(voters.dislikes, 'No dislikes yet.')}</tbody>
        </table>
      </div>
      <h3 class="h6">Dislike comments</h3>
      <div class="table-responsive mb-3">
        <table class="table table-sm table-striped align-middle mb-0">
          <thead class="table-light"><tr><th scope="col">Name</th><th scope="col">Comment</th><th scope="col">When</th></tr></thead>
          <tbody>${commentRows}</tbody>
        </table>
      </div>
      <h3 class="h6">Page visits (3 seconds or longer)</h3>
      <div class="table-responsive">
        <table class="table table-sm table-striped align-middle mb-0">
          <thead class="table-light"><tr><th scope="col">Visitor</th><th scope="col">Time on page</th><th scope="col">Word date</th><th scope="col">Visited at</th></tr></thead>
          <tbody>${visitRows}</tbody>
        </table>
      </div>
    `;
  }

  function renderEntryMetaPanel(entry) {
    const author = entry.authorName || entry.authorUserId || '—';
    return `<div id="wodEntryMetaPanel" class="wod-entry-meta-panel collapse">
      <dl class="wod-entry-meta-grid mb-0">
        <div class="wod-entry-meta-item">
          <dt>Author</dt>
          <dd>${escapeHtml(author)}</dd>
        </div>
        <div class="wod-entry-meta-item">
          <dt>Created</dt>
          <dd>${escapeHtml(formatDisplayDate(entry.audit?.createDateTime))}</dd>
        </div>
        <div class="wod-entry-meta-item">
          <dt>Last modified</dt>
          <dd>${escapeHtml(formatDisplayDate(entry.audit?.lastUpdateDateTime))}</dd>
        </div>
      </dl>
    </div>`;
  }

  function renderEntryDetailHtml(entry, payload, options = {}) {
    if (!entry) return '';
    const layout = options.layout === 'compact' ? 'compact' : 'modal';
    const caps = payload?.capabilities || entry.capabilities || {};
    const status = String(entry.status || '').toLowerCase();
    const examples = Array.isArray(entry.examples) ? entry.examples : [];
    const typeText = formatTypeLabels(entry, payload?.wordTypeLabels);
    const difficultyText = (payload?.difficultyLabels || {})[entry.difficulty] || entry.difficulty || '—';
    const author = entry.authorName || entry.authorUserId || '—';
    const displayCount = Number(entry.display?.displayCount || 0);

    if (layout === 'compact') {
      return `
      <div class="mb-2"><span class="badge ${statusBadgeClass(status)}">${escapeHtml(status.replace(/_/g, ' ').toUpperCase())}</span></div>
      ${caps.hasDisplayHistory ? `<div class="alert alert-warning py-2 small">Displayed ${displayCount} time(s). Some status changes may need confirmation.</div>` : ''}
      <dl class="row small mb-0">
        <dt class="col-sm-3">Type</dt><dd class="col-sm-9">${escapeHtml(typeText)}</dd>
        <dt class="col-sm-3">Difficulty</dt><dd class="col-sm-9">${escapeHtml(difficultyText)}</dd>
        <dt class="col-sm-3">Pronunciation</dt><dd class="col-sm-9 font-monospace">${escapeHtml(entry.pronunciation || '—')}</dd>
        <dt class="col-sm-3">Meaning</dt><dd class="col-sm-9">${escapeHtml(entry.meaning || '—')}</dd>
        <dt class="col-sm-3">Author</dt><dd class="col-sm-9">${escapeHtml(author)}</dd>
        <dt class="col-sm-3">Created</dt><dd class="col-sm-9">${escapeHtml(entry.audit?.createDateTime || '—')}</dd>
        <dt class="col-sm-3">Modified</dt><dd class="col-sm-9">${escapeHtml(entry.audit?.lastUpdateDateTime || '—')}</dd>
        <dt class="col-sm-3">Displayed</dt><dd class="col-sm-9">${displayCount} time(s)</dd>
      </dl>
      ${examples.length ? `<h3 class="h6 mt-3">Examples</h3><ol class="small ps-3 mb-0">${examples.map((ex) => `<li class="mb-1">${escapeHtml(ex)}</li>`).join('')}</ol>` : ''}
      ${renderMediaBlock(entry, { layout: 'compact' })}
    `;
    }

    const displayWarning = caps.hasDisplayHistory
      ? `<div class="alert alert-warning wod-entry-display-alert py-2 px-3 mb-2"><i class="bi bi-exclamation-triangle me-2"></i>This word was displayed before; some status changes need confirmation.</div>`
      : '';

    return `
      ${displayWarning}
      <div class="wod-entry-chip-row d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div class="d-flex flex-wrap align-items-center gap-2">
          <span class="badge bg-light text-dark border px-3 py-2 fs-6">${escapeHtml(typeText)}</span>
          <span class="badge bg-light text-dark border px-3 py-2 fs-6">${escapeHtml(difficultyText)}</span>
        </div>
        <button type="button" class="btn btn-sm btn-outline-secondary wod-entry-details-toggle flex-shrink-0" data-bs-toggle="collapse" data-bs-target="#wodEntryMetaPanel" aria-expanded="false" aria-controls="wodEntryMetaPanel">
          <i class="bi bi-info-circle me-1" aria-hidden="true"></i>Details
        </button>
      </div>
      ${renderEntryMetaPanel(entry)}
      <section class="wod-entry-meaning-card" aria-labelledby="wod-entry-meaning-heading">
        <div class="wod-entry-meaning-label" id="wod-entry-meaning-heading">Meaning</div>
        <p class="wod-entry-meaning-text">${escapeHtml(entry.meaning || '—')}</p>
      </section>
      ${examples.length ? `<h3 class="wod-entry-examples-title"><i class="bi bi-chat-quote me-2 text-primary"></i>Examples in context</h3><ol class="wod-entry-examples-list">${examples.map((ex) => `<li>${escapeHtml(ex)}</li>`).join('')}</ol>` : ''}
      ${renderMediaBlock(entry, { layout: 'modal' })}
    `;
  }

  function renderHeaderSubtitleHtml(entry) {
    const pronunciation = String(entry?.pronunciation || '').trim();
    if (!pronunciation) return '';
    return `<span class="wod-entry-header-phonetics font-monospace" lang="en">${escapeHtml(pronunciation)}</span>`;
  }

  function renderHeaderStatusHtml(entry) {
    if (!entry) return '';
    const status = String(entry.status || '').toLowerCase();
    const label = status.replace(/_/g, ' ');
    const displayCount = Number(entry.display?.displayCount || 0);
    const statusBadge = label
      ? `<span class="badge ${statusBadgeClass(status)}">${escapeHtml(label)}</span>`
      : '';
    const displayChip = renderDisplayChip(displayCount);
    return `<div class="wod-entry-header-status-chips d-flex flex-wrap align-items-center justify-content-end gap-2">${statusBadge}${displayChip}</div>`;
  }

  function readWorkflowNote(noteInputId) {
    const el = document.getElementById(noteInputId || 'wodListEntryWorkflowNote');
    return el ? String(el.value || '').trim() : '';
  }

  global.WordOfDayEntryDetailUi = {
    escapeHtml,
    statusBadgeClass,
    formatTypeLabels,
    renderActionButtons,
    renderEditLink,
    renderHeaderStatusHtml,
    renderHeaderSubtitleHtml,
    renderDisplayChip,
    renderEntryDetailHtml,
    renderPublicFeedbackModalBody,
    bindEntryMediaInteractions,
    readWorkflowNote,
    workflowLoadingMessage
  };
}(typeof window !== 'undefined' ? window : globalThis));