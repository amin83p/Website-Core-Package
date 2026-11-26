(function initWordOfDayPublicClient(global) {
  'use strict';

  function csrfHeaders() {
    const token = String(document.querySelector('meta[name="csrf-token"]')?.content || '').trim();
    if (!token) return {};
    return { 'X-CSRF-Token': token, 'csrf-token': token };
  }

  function formatAudioTime(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(total / 60);
    const secs = Math.floor(total % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function initAudioPlayer(wrap) {
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

    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    });

    audio.addEventListener('play', () => syncPlayState(true));
    audio.addEventListener('pause', () => syncPlayState(false));
    audio.addEventListener('loadedmetadata', () => {
      if (durationEl) durationEl.textContent = formatAudioTime(audio.duration);
    });
    audio.addEventListener('timeupdate', () => {
      if (currentEl) currentEl.textContent = formatAudioTime(audio.currentTime);
      if (seek && audio.duration) {
        seek.value = String((audio.currentTime / audio.duration) * 100);
      }
    });
    seek.addEventListener('input', () => {
      if (!audio.duration) return;
      audio.currentTime = (Number(seek.value) / 100) * audio.duration;
    });
  }

  function bindPhotoOpen() {
    document.querySelectorAll('[data-wod-photo-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = String(btn.getAttribute('data-url') || '').trim();
        const name = String(btn.getAttribute('data-filename') || 'Image').trim();
        const mime = String(btn.getAttribute('data-mime') || 'image/jpeg').trim();
        if (url && global.ImageViewer && typeof global.ImageViewer.open === 'function') {
          global.ImageViewer.open(url, name, mime);
        }
      });
    });
  }

  function setReactionUi(panel, summary) {
    if (!panel || !summary) return;
    const likeBtn = panel.querySelector('[data-wod-vote="like"]');
    const dislikeBtn = panel.querySelector('[data-wod-vote="dislike"]');
    const vote = String(summary.myVote || '').toLowerCase();
    if (likeBtn) {
      likeBtn.classList.toggle('is-active-like', vote === 'like');
      likeBtn.disabled = false;
    }
    if (dislikeBtn) {
      dislikeBtn.classList.toggle('is-active-dislike', vote === 'dislike');
      dislikeBtn.disabled = false;
    }
    panel.setAttribute('data-my-vote', vote);
  }

  function getDislikePanel(panel) {
    return panel ? panel.querySelector('#wodDislikeFeedback') : null;
  }

  function showDislikePanel(panel, { open } = {}) {
    const box = getDislikePanel(panel);
    if (!box) return;
    const visible = open !== false;
    box.classList.toggle('is-hidden', !visible);
    if (visible) {
      box.removeAttribute('hidden');
    } else {
      box.setAttribute('hidden', '');
    }
  }

  async function postReaction(panel, { vote, dislikeComment } = {}) {
    const entryId = String(panel.getAttribute('data-entry-id') || '').trim();
    const orgId = String(panel.getAttribute('data-org-id') || '').trim();
    const dateKey = String(panel.getAttribute('data-date-key') || '').trim();
    if (!entryId || !vote) return null;

    panel.querySelectorAll('[data-wod-vote]').forEach((b) => { b.disabled = true; });
    const body = { entryId, orgId, dateKey, vote };
    if (vote === 'dislike' && dislikeComment !== undefined) {
      body.dislikeComment = dislikeComment;
    }

    try {
      const res = await fetch('/word-of-the-day/api/reaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...csrfHeaders()
        },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Could not save vote.');
      setReactionUi(panel, data);
      return data;
    } catch (err) {
      panel.querySelectorAll('[data-wod-vote]').forEach((b) => { b.disabled = false; });
      if (global.console && typeof global.console.warn === 'function') {
        global.console.warn(err.message || err);
      }
      return null;
    }
  }

  function bindReactions(panel) {
    if (!panel) return;
    const entryId = String(panel.getAttribute('data-entry-id') || '').trim();
    if (!entryId) return;

    const dislikeBox = getDislikePanel(panel);
    const commentEl = dislikeBox ? dislikeBox.querySelector('#wodDislikeComment') : null;

    panel.querySelectorAll('[data-wod-vote="like"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        showDislikePanel(panel, { open: false });
        await postReaction(panel, { vote: 'like' });
      });
    });

    panel.querySelectorAll('[data-wod-vote="dislike"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const current = String(panel.getAttribute('data-my-vote') || '').toLowerCase();
        showDislikePanel(panel, { open: true });
        if (current === 'dislike' && commentEl) {
          commentEl.focus();
        }
      });
    });

    if (dislikeBox) {
      dislikeBox.querySelector('[data-wod-dislike-submit]')?.addEventListener('click', async () => {
        const text = commentEl ? String(commentEl.value || '').trim() : '';
        const ok = await postReaction(panel, { vote: 'dislike', dislikeComment: text });
        if (ok) showDislikePanel(panel, { open: false });
      });
      dislikeBox.querySelector('[data-wod-dislike-skip]')?.addEventListener('click', async () => {
        if (commentEl) commentEl.value = '';
        const ok = await postReaction(panel, { vote: 'dislike', dislikeComment: '' });
        if (ok) showDislikePanel(panel, { open: false });
      });
      dislikeBox.querySelector('[data-wod-dislike-cancel]')?.addEventListener('click', () => {
        showDislikePanel(panel, { open: false });
      });
    }
  }

  function viewSessionId() {
    const key = 'wodPublicViewSession';
    try {
      let id = String(sessionStorage.getItem(key) || '').trim();
      if (!id && global.crypto?.randomUUID) {
        id = global.crypto.randomUUID();
        sessionStorage.setItem(key, id);
      }
      if (!id) {
        id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(key, id);
      }
      return id;
    } catch (_) {
      return `v_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function initQualifiedVisitTracking(panel) {
    if (!panel) return;
    const entryId = String(panel.getAttribute('data-entry-id') || '').trim();
    const orgId = String(panel.getAttribute('data-org-id') || '').trim();
    const dateKey = String(panel.getAttribute('data-date-key') || '').trim();
    if (!entryId) return;

    const startedAt = Date.now();
    const minMs = 3000;
    const sendVisit = () => {
      const durationMs = Date.now() - startedAt;
      if (durationMs < minMs) return;
      const body = {
        entryId,
        orgId,
        dateKey,
        viewSessionId: viewSessionId(),
        durationMs
      };
      fetch('/word-of-the-day/api/page-visit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...csrfHeaders()
        },
        body: JSON.stringify(body),
        keepalive: true
      }).catch(() => {});
    };

    global.setTimeout(sendVisit, minMs);
  }

  function init() {
    document.querySelectorAll('[data-wod-audio-player]').forEach((node) => initAudioPlayer(node));
    bindPhotoOpen();
    const panel = document.getElementById('wodReactionPanel');
    bindReactions(panel);
    initQualifiedVisitTracking(panel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);