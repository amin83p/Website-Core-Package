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

  function scoreNaturalEnglishVoice(voice) {
    const name = String(voice?.name || '');
    const lang = String(voice?.lang || '').toLowerCase().replace('_', '-');
    if (!/^en(-|$)/.test(lang)) return Number.NEGATIVE_INFINITY;

    let score = 0;
    if (lang === 'en-us') score += 40;
    else if (lang.startsWith('en-')) score += 12;

    if (/\(natural\)|\bneural\b/i.test(name)) score += 120;
    if (/\bonline\b/i.test(name)) score += 20;
    if (/google/i.test(name) && /english/i.test(name)) score += 88;

    const lower = name.toLowerCase();
    if (/microsoft\s+(aria|jenny|emma|brian|ava|andrew|guy|michelle|christopher)\b/.test(lower)) {
      score += 82;
    }
    if (/\bmicrosoft\s+(david|zira|mark)\b/.test(lower) && !/\(natural\)/i.test(name)) {
      score -= 90;
    }
    if (voice.localService && !/\(natural\)|\bneural\b|google/i.test(name)) {
      score -= 40;
    }

    return score;
  }

  function pickEnglishVoice(synth) {
    if (!synth || typeof synth.getVoices !== 'function') return null;
    const voices = synth.getVoices();
    if (!Array.isArray(voices) || !voices.length) return null;

    const enCandidates = voices.filter((v) => /^en(-|_)/i.test(String(v.lang || '')));
    const pool = enCandidates.length ? enCandidates : voices;

    let picked = pool[0];
    let pickedScore = scoreNaturalEnglishVoice(picked);
    pool.forEach((v) => {
      const score = scoreNaturalEnglishVoice(v);
      if (score > pickedScore) {
        pickedScore = score;
        picked = v;
      }
    });

    return picked || null;
  }

  function initSpeechControls() {
    const synth = global.speechSynthesis;
    if (!synth || typeof global.SpeechSynthesisUtterance === 'undefined') {
      document.querySelectorAll('[data-wod-speak]').forEach((btn) => {
        btn.classList.add('d-none');
      });
      return;
    }

    let preferredVoice = pickEnglishVoice(synth);
    const refreshVoice = () => {
      preferredVoice = pickEnglishVoice(synth) || preferredVoice;
    };
    synth.addEventListener('voiceschanged', refreshVoice);
    refreshVoice();

    const clearSpeakingUi = () => {
      document.querySelectorAll('[data-wod-speak].is-speaking').forEach((node) => {
        node.classList.remove('is-speaking');
      });
    };

    document.querySelectorAll('[data-wod-speak]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = String(btn.getAttribute('data-speak-text') || '').trim();
        if (!text) return;

        if (btn.classList.contains('is-speaking')) {
          synth.cancel();
          clearSpeakingUi();
          return;
        }

        synth.cancel();
        clearSpeakingUi();

        if (!preferredVoice || /Microsoft (David|Zira|Mark)\b/.test(String(preferredVoice.name || ''))) {
          preferredVoice = pickEnglishVoice(synth) || preferredVoice;
        }

        const utter = new global.SpeechSynthesisUtterance(text);
        if (preferredVoice) {
          utter.voice = preferredVoice;
          utter.lang = String(preferredVoice.lang || 'en-US');
        } else {
          utter.lang = 'en-US';
        }

        utter.onend = clearSpeakingUi;
        utter.onerror = clearSpeakingUi;

        btn.classList.add('is-speaking');
        synth.speak(utter);
      });
    });
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

  const SOCIAL_EXPORT_MIN = 600;
  const SOCIAL_EXPORT_MAX = 1920;
  const SOCIAL_EXPORT_MAX_AREA = 3686400;

  function clampSocialExportDim(value) {
    const n = Math.round(Number(value) || 0);
    return Math.min(SOCIAL_EXPORT_MAX, Math.max(SOCIAL_EXPORT_MIN, n));
  }

  function validateSocialExportSize(width, height) {
    const w = clampSocialExportDim(width);
    const h = clampSocialExportDim(height);
    if (w * h > SOCIAL_EXPORT_MAX_AREA) {
      throw new Error('Image area is too large. Use smaller width or height.');
    }
    return { width: w, height: h };
  }

  function readSocialExportPayload() {
    const el = document.getElementById('wodSocialExportPayload');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || '{}');
    } catch (_) {
      return null;
    }
  }

  async function hydrateSocialExportPhoto(card) {
    const img = card?.querySelector('.wod-social-export-photo');
    if (!img || img.dataset.exportPhotoReady === '1') return;
    const src = String(img.getAttribute('src') || img.src || '').trim();
    if (!src) return;
    img.removeAttribute('crossorigin');
    if (src.startsWith('blob:')) {
      throw new Error('Export image URL is invalid. Refresh the page and try again.');
    }
    if (img.complete && img.naturalWidth > 0) {
      img.dataset.exportPhotoReady = '1';
      return;
    }
    await new Promise((resolve, reject) => {
      const done = () => {
        img.dataset.exportPhotoReady = '1';
        resolve();
      };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', () => reject(new Error('Could not load illustration for export.')), { once: true });
    });
  }

  function waitForSocialExportImages(card) {
    const imgs = Array.from(card.querySelectorAll('img'));
    return Promise.all(imgs.map((img) => {
      if (img.complete && img.naturalWidth) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
    }));
  }

  function socialExportLayoutKind(width, height) {
    const safeW = Math.max(1, Number(width) || 1);
    const safeH = Math.max(1, Number(height) || 1);
    const aspect = safeW / safeH;
    if (aspect > 1.15) return 'landscape';
    if (aspect < 0.82) return 'story';
    return 'square';
  }

  function computeSocialExportWordSize(wordText, width, height, layout) {
    const minDim = Math.min(width, height);
    const text = String(wordText || '').trim();
    const len = text.length || 1;
    let ratio = 0.088;
    if (layout === 'story') ratio = 0.096;
    if (layout === 'landscape') ratio = 0.14 * (height / minDim);
    if (len > 24) ratio *= 0.55;
    else if (len > 18) ratio *= 0.68;
    else if (len > 14) ratio *= 0.8;
    else if (len > 10) ratio *= 0.9;
    else if (len <= 7) ratio *= 1.06;
    const size = Math.round(minDim * ratio);
    return Math.max(28, Math.min(size, Math.round(minDim * 0.15)));
  }

  function applySocialExportLayout(card, width, height) {
    if (!card) return;
    const w = clampSocialExportDim(width);
    const h = clampSocialExportDim(height);
    const minDim = Math.min(w, h);
    const layout = socialExportLayoutKind(w, h);
    const wordEl = card.querySelector('[data-wod-export-word]') || card.querySelector('.wod-social-export-word');
    const wordText = wordEl?.textContent || '';
    const pad = Math.round(minDim * 0.052);
    const gap = Math.round(minDim * 0.016);
    const blockGap = layout === 'story' ? Math.round(h * 0.022) : gap;

    card.dataset.wodExportLayout = layout;
    card.style.width = `${w}px`;
    card.style.height = `${h}px`;
    card.style.setProperty('--wod-ex-pad', `${pad}px`);
    card.style.setProperty('--wod-ex-gap', `${gap}px`);
    card.style.setProperty('--wod-ex-block-gap', `${blockGap}px`);
    card.style.setProperty('--wod-ex-radius', `${Math.round(minDim * 0.024)}px`);
    card.style.setProperty('--wod-ex-photo-radius', `${Math.round(minDim * 0.018)}px`);
    card.style.setProperty('--wod-ex-kicker', `${Math.round(minDim * 0.028)}px`);
    card.style.setProperty('--wod-ex-date', `${Math.round(minDim * 0.024)}px`);
    card.style.setProperty('--wod-ex-word', `${computeSocialExportWordSize(wordText, w, h, layout)}px`);
    card.style.setProperty('--wod-ex-pron', `${Math.round(minDim * 0.026)}px`);
    card.style.setProperty('--wod-ex-meaning', `${Math.round(minDim * (layout === 'landscape' ? 0.032 : 0.028))}px`);
    card.style.setProperty('--wod-ex-example', `${Math.round(minDim * 0.024)}px`);
    card.style.setProperty('--wod-ex-chip', `${Math.round(minDim * 0.022)}px`);
    card.style.setProperty('--wod-ex-brand', `${Math.round(minDim * 0.022)}px`);
  /** Photo height as share of canvas — scales with story vs square vs landscape. */
    const photoMax = layout === 'story'
      ? Math.round(h * 0.34)
      : layout === 'landscape'
        ? Math.round(h * 0.78)
        : Math.round(h * 0.3);
    card.style.setProperty('--wod-ex-photo-max', `${photoMax}px`);
    card.style.setProperty('--wod-ex-brand-margin', layout === 'story' ? `${Math.round(gap * 0.5)}px 0 0 0` : '0');
  }

  function initSocialImageExport() {
    const root = document.querySelector('[data-wod-social-export]');
    const openBtn = document.querySelector('[data-wod-social-export-open]');
    const card = document.getElementById('wodSocialExportCard');
    const stage = document.getElementById('wodSocialExportStage');
    if (!root || !openBtn || !card || !stage) return;

    const modalEl = document.getElementById('wodSocialExportModal');
    const bsModal = global.bootstrap?.Modal ? global.bootstrap.Modal.getOrCreateInstance(modalEl) : null;
    const widthInput = root.querySelector('[data-wod-social-width]');
    const heightInput = root.querySelector('[data-wod-social-height]');
    const aspectLock = root.querySelector('[data-wod-social-aspect-lock]');
    const previewWrap = root.querySelector('[data-wod-social-preview-wrap]');
    const previewScaler = root.querySelector('[data-wod-social-preview-scaler]');
    const downloadBtn = root.querySelector('[data-wod-social-download]');
    const errorEl = root.querySelector('[data-wod-social-export-error]');
    const payload = readSocialExportPayload() || {};
    const stageHome = stage.parentNode;
    let stageMountedInPreview = false;

    let aspectRatio = 1;

    function showExportError(msg) {
      if (!errorEl) return;
      if (msg) {
        errorEl.textContent = msg;
        errorEl.classList.remove('d-none');
      } else {
        errorEl.textContent = '';
        errorEl.classList.add('d-none');
      }
    }

    function unmountStageFromPreview() {
      if (!stageMountedInPreview || !stageHome) return;
      stage.classList.remove('wod-social-export-stage--preview');
      stage.style.transform = '';
      stageHome.appendChild(stage);
      stageMountedInPreview = false;
    }

    function updatePreview(width, height) {
      if (!previewWrap || !previewScaler) return;
      applySocialExportLayout(card, width, height);
      if (!stageMountedInPreview) {
        stageMountedInPreview = true;
        stage.classList.add('wod-social-export-stage--preview');
        previewScaler.appendChild(stage);
      }
      const wrapW = previewWrap.clientWidth || 1;
      const scale = Math.min(1, (wrapW - 16) / width);
      stage.style.width = `${width}px`;
      stage.style.height = `${height}px`;
      stage.style.transform = `scale(${scale})`;
      stage.style.transformOrigin = 'top center';
    }

    function applyCardSize(width, height) {
      updatePreview(width, height);
    }

    function readSize() {
      return validateSocialExportSize(widthInput?.value, heightInput?.value);
    }

    function setPreset(w, h) {
      if (widthInput) widthInput.value = String(w);
      if (heightInput) heightInput.value = String(h);
      aspectRatio = w / h;
      try {
        const size = readSize();
        applyCardSize(size.width, size.height);
        showExportError('');
      } catch (error) {
        showExportError(error.message);
      }
    }

    modalEl?.addEventListener('hidden.bs.modal', () => {
      unmountStageFromPreview();
    });

    openBtn.addEventListener('click', async () => {
      showExportError('');
      try {
        await hydrateSocialExportPhoto(card);
        await waitForSocialExportImages(card);
      } catch (error) {
        showExportError(error?.message || 'Could not load illustration.');
        return;
      }
      setPreset(1080, 1080);
      if (bsModal) bsModal.show();
      else if (modalEl) {
        modalEl.classList.add('show');
        modalEl.style.display = 'block';
      }
    });

    root.querySelectorAll('[data-wod-social-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const token = String(btn.getAttribute('data-wod-social-preset') || '');
        const parts = token.split('x').map((x) => Number(x));
        if (parts.length === 2 && parts[0] && parts[1]) setPreset(parts[0], parts[1]);
      });
    });

    const onDimChange = (changed) => {
      try {
        let w = Number(widthInput?.value);
        let h = Number(heightInput?.value);
        if (aspectLock?.checked && aspectRatio > 0) {
          if (changed === 'width') {
            h = Math.round(w / aspectRatio);
            if (heightInput) heightInput.value = String(h);
          } else {
            w = Math.round(h * aspectRatio);
            if (widthInput) widthInput.value = String(w);
          }
        }
        const size = readSize();
        aspectRatio = size.width / size.height;
        applyCardSize(size.width, size.height);
        showExportError('');
      } catch (error) {
        showExportError(error.message);
      }
    };

    widthInput?.addEventListener('input', () => onDimChange('width'));
    heightInput?.addEventListener('input', () => onDimChange('height'));
    aspectLock?.addEventListener('change', () => {
      try {
        const size = readSize();
        aspectRatio = size.width / size.height;
      } catch (_) { /* ignore */ }
    });

    downloadBtn?.addEventListener('click', async () => {
      showExportError('');
      if (!global.htmlToImage?.toPng) {
        showExportError('Image library did not load. Refresh and try again.');
        return;
      }
      try {
        const size = readSize();
        unmountStageFromPreview();
        applySocialExportLayout(card, size.width, size.height);
        downloadBtn.disabled = true;
        await hydrateSocialExportPhoto(card);
        await waitForSocialExportImages(card);
        const dataUrl = await global.htmlToImage.toPng(card, {
          width: size.width,
          height: size.height,
          pixelRatio: 1,
          cacheBust: false,
          skipFonts: true,
          backgroundColor: '#ffffff'
        });
        const link = document.createElement('a');
        const dateKey = String(payload.dateKey || 'today').replace(/[^\d-]/g, '') || 'today';
        link.download = `word-of-the-day-${dateKey}-${size.width}x${size.height}.png`;
        link.href = dataUrl;
        link.click();
      } catch (error) {
        showExportError(error?.message || 'Could not create image.');
      } finally {
        downloadBtn.disabled = false;
      }
    });
  }

  function init() {
    document.querySelectorAll('[data-wod-audio-player]').forEach((node) => initAudioPlayer(node));
    bindPhotoOpen();
    initSpeechControls();
    const panel = document.getElementById('wodReactionPanel');
    bindReactions(panel);
    initQualifiedVisitTracking(panel);
    initSocialImageExport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);