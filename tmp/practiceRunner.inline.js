(() => {
  function parseJson(id, fallback) {
    try {
      const node = document.getElementById(id);
      return JSON.parse((node && node.textContent) || '');
    } catch (_) {
      return fallback;
    }
  }

  function clean(value) {
    return String(value || '').replace(/\0/g, '').trim();
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nl2br(value) {
    return esc(String(value || '')).replace(/\r?\n/g, '<br>');
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function toInt(value, fallback = 0) {
    const numeric = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return Number(fallback || 0);
    return numeric;
  }

  function parseMinutesToSeconds(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric <= 0) return Number(fallback || 0);
    return Math.max(0, Math.floor(numeric * 60));
  }

  function nowMs() {
    return Date.now();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isAnsweredStatus(status) {
    const token = clean(status).toLowerCase();
    return ['saved', 'submitted', 'auto_submitted', 'scored', 'feedback_provided'].includes(token);
  }

  function isRetakeRequiredStatus(status) {
    return isAnsweredStatus(status);
  }

  function isSkippableStatus(status) {
    const token = clean(status).toLowerCase();
    if (!token) return true;
    if (token === 'abandoned') return false;
    return !isAnsweredStatus(token);
  }

  function normalizeQuestionTypeToken(questionType) {
    const raw = clean(questionType).toLowerCase();
    if (!raw) return '';
    const compact = raw
      .replace(/[\s-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!compact) return '';
    if (compact.startsWith('speaking_')) return compact;
    const speakingAliases = new Set([
      'read_aloud',
      'repeat_sentence',
      'describe_image',
      'respond_to_situation',
      'answer_short_question'
    ]);
    if (speakingAliases.has(compact)) return `speaking_${compact}`;
    return compact;
  }

  function isSpeakingType(questionType, questionSkill = '') {
    const token = normalizeQuestionTypeToken(questionType);
    if (token.startsWith('speaking_')) return true;
    return clean(questionSkill).toLowerCase() === 'speaking';
  }

  function formatQuestionTypeLabel(questionType) {
    const token = normalizeQuestionTypeToken(questionType);
    if (!token) return '';
    return token
      .split('_')
      .map((part) => part ? (part.charAt(0).toUpperCase() + part.slice(1)) : '')
      .join(' ')
      .trim();
  }

  const QUESTION_TYPES_WITH_PROMPT_AUDIO = new Set([
    'speaking_repeat_sentence',
    'listening_mcq_single',
    'listening_mcq_multiple',
    'listening_fill_in_blank',
    'listening_dictation',
    'listening_matching'
  ]);

  function resolveQuestionMediaUrl(questionRow, assetRef) {
    const tokenRaw = clean(assetRef);
    const token = tokenRaw.toLowerCase();
    if (!token) return '';
    if (/^https?:\/\//i.test(tokenRaw)) return tokenRaw;
    if (/^\/uploads\//i.test(tokenRaw)) return tokenRaw;
    if (/^uploads\//i.test(tokenRaw)) return '/' + tokenRaw;

    const mediaRows = toArray(questionRow && questionRow.mediaAssets);
    const media = mediaRows.find((row) => {
      const keys = [
        row && row.id,
        row && row.name,
        row && row.originalName,
        row && row.filename,
        row && row.path,
        row && row.url
      ]
        .map((value) => clean(value).toLowerCase())
        .filter(Boolean);
      return keys.includes(token);
    }) || null;
    if (!media) return '';
    if (clean(media.url)) return clean(media.url);
    if (clean(media.path)) {
      const normalized = clean(media.path).replace(/\\/g, '/');
      const match = normalized.match(/\/uploads\/(.+)$/i);
      if (match && match[1]) return '/uploads/' + String(match[1]).replace(/^\/+/, '');
    }
    return '';
  }

  function renderPromptAudioBlock(questionRow, assetRef, label = 'Prompt Audio', { autoPlay = false } = {}) {
    const audioUrl = resolveQuestionMediaUrl(questionRow, assetRef);
    if (!audioUrl) return '';
    return ''
      + '<div class="pte-prompt-media-block mb-3">'
      + '  <div class="small fw-bold text-uppercase text-muted mb-1">' + esc(label) + '</div>'
      + '  <audio id="ptePracticePromptAudio" controls preload="auto" class="w-100"' + (autoPlay ? ' autoplay' : '') + '>'
      + '    <source src="' + esc(audioUrl) + '">'
      + '  </audio>'
      + '</div>';
  }

  function renderPromptImageBlock(questionRow, assetRef, label = 'Prompt Image') {
    const imageUrl = resolveQuestionMediaUrl(questionRow, assetRef);
    if (!imageUrl) return '';
    return ''
      + '<div class="mb-3">'
      + '  <div class="small fw-bold text-uppercase text-muted mb-1">' + esc(label) + '</div>'
      + '  <div class="pte-prompt-image-frame"><img src="' + esc(imageUrl) + '" alt="Question prompt image"></div>'
      + '</div>';
  }

  function getPromptAudioElement() {
    return document.getElementById('ptePracticePromptAudio');
  }

  function stopPromptAudioPlayback({ reset = false } = {}) {
    const audio = getPromptAudioElement();
    if (!audio) return;
    try {
      audio.pause();
      if (reset) audio.currentTime = 0;
    } catch (_) {}
  }

  function resolveTiming(payload = {}) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const prepSeconds = Math.max(
      0,
      toInt(source.prepTimeSeconds, 0),
      toInt(source.preparationTimeSeconds, 0),
      toInt(source.prepSeconds, 0),
      parseMinutesToSeconds(source.planningTimeMinutes, 0)
    );
    const responseSeconds = Math.max(
      0,
      toInt(source.responseTimeSeconds, 0),
      toInt(source.recordingTimeSeconds, 0),
      toInt(source.answerTimeSeconds, 0),
      toInt(source.speakingTimeSeconds, 0),
      parseMinutesToSeconds(source.recommendedTimeMinutes, 0),
      toInt(source.timeLimitSeconds, 0)
    );
    return {
      prepSeconds,
      responseSeconds,
      hasTiming: prepSeconds > 0 || responseSeconds > 0
    };
  }

  function showMessage(title, message, icon = 'info') {
    if (typeof window.showMessageModal === 'function') {
      return window.showMessageModal({
        title,
        message,
        icon,
        buttons: [{ text: 'OK', class: icon === 'error' ? 'btn-danger' : 'btn-primary' }]
      });
    }
    return Promise.resolve();
  }

  function describeMicrophoneError(error) {
    const rawMessage = clean(error?.message || error || '', 600);
    const errorName = clean(error?.name || '').toLowerCase();
    const token = `${errorName} ${rawMessage}`.toLowerCase();
    const secureContext = !(typeof window !== 'undefined' && window.isSecureContext === false);

    if (!secureContext || token.includes('securityerror') || token.includes('secure context')) {
      return {
        key: 'insecure_context',
        inline: 'Microphone access requires HTTPS (or localhost) in a secure browser context.',
        title: 'Microphone Access Blocked',
        message: 'This page is not in a secure context.\nUse HTTPS (or localhost) and try again.'
      };
    }
    if (token.includes('notallowederror') || token.includes('permission denied') || token.includes('denied') || token.includes('permission')) {
      return {
        key: 'permission_denied',
        inline: 'Microphone permission is denied. Please allow microphone access and try again.',
        title: 'Microphone Permission Required',
        message: 'Microphone access is blocked for this site.\nPlease allow microphone in your browser site settings, then try Start Recording again.'
      };
    }
    if (token.includes('notfounderror') || token.includes('no microphone') || token.includes('device not found')) {
      return {
        key: 'device_not_found',
        inline: 'No microphone device was found.',
        title: 'No Microphone Detected',
        message: 'No microphone device was detected.\nConnect a microphone and try again.'
      };
    }
    if (token.includes('notreadableerror') || token.includes('could not start') || token.includes('track start') || token.includes('busy')) {
      return {
        key: 'device_busy',
        inline: 'Microphone is unavailable or currently in use by another app.',
        title: 'Microphone Unavailable',
        message: 'Microphone could not be started.\nClose other apps that use the microphone and try again.'
      };
    }
    return {
      key: 'unknown',
      inline: rawMessage || 'Unable to start microphone recording.',
      title: 'Microphone Error',
      message: rawMessage || 'Unable to start microphone recording. Please try again.'
    };
  }

  function setButtonBusy(button, busy, label = 'Working...') {
    if (!button) return;
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>' + label;
      return;
    }
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }

  function revokeUrl(url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch (_) {}
  }

  function isSpeakingQuestion(item) {
    const qType = item?.question?.questionType || item?.questionType || '';
    const skill = item?.question?.skill || item?.skill || '';
    return isSpeakingType(qType, skill);
  }

  const session = parseJson('ptePracticeSessionJson', {});
  const items = toArray(parseJson('ptePracticeItemsJson', []));
  const actionStateId = clean(document.getElementById('ptePracticeActionStateId')?.value);
  if (!session || !clean(session.id) || !items.length) return;

  const nodes = {
    layoutRow: document.getElementById('ptePracticeLayoutRow'),
    sidebarCol: document.getElementById('ptePracticeSidebarCol'),
    contentCol: document.getElementById('ptePracticeContentCol'),
    sidebarToggleBtn: document.getElementById('ptePracticeSidebarToggleBtn'),
    topProgressWrap: document.getElementById('ptePracticeTopProgressWrap'),
    topProgressBar: document.getElementById('ptePracticeTopProgressBar'),
    topProgressText: document.getElementById('ptePracticeTopProgressText'),
    nav: document.getElementById('ptePracticeQuestionNav'),
    progressBar: document.getElementById('ptePracticeProgressBar'),
    progressText: document.getElementById('ptePracticeProgressText'),
    title: document.getElementById('ptePracticeQuestionTitle'),
    skill: document.getElementById('ptePracticeQuestionSkill'),
    type: document.getElementById('ptePracticeQuestionType'),
    statusBadge: document.getElementById('ptePracticeQuestionStatusBadge'),
    seenTime: document.getElementById('ptePracticeSeenTime'),
    prompt: document.getElementById('ptePracticeQuestionPrompt'),
    response: document.getElementById('ptePracticeResponsePanel'),
    ratingModal: document.getElementById('ptePracticeRatingModal'),
    openRatingBtn: document.getElementById('ptePracticeOpenRatingBtn'),
    ratingButtons: Array.from(document.querySelectorAll('#ptePracticeRatingModal button[data-difficulty-rating]')),
    ratingMeta: document.getElementById('ptePracticeRatingMeta'),
    saveBtn: document.getElementById('ptePracticeSaveBtn'),
    prevBtn: document.getElementById('ptePracticePrevBtn'),
    nextBtn: document.getElementById('ptePracticeNextBtn'),
    finishTopBtn: document.getElementById('ptePracticeFinishBtnTop'),
    finishBottomBtn: document.getElementById('ptePracticeFinishBtnBottom')
  };

  const state = {
    index: 0,
    activeItemId: '',
    viewOpenedAtMs: 0,
    startedItemIds: new Set(),
    startedInFlight: new Set(),
    openedItemIds: new Set(),
    itemMap: new Map(items.map((row) => [clean(row.id), row])),
    ratingInFlight: false,
    ratingLocked: true,
    sidebarCollapsed: false,
    speaking: {
      activeItemId: '',
      phase: 'idle',
      timerHandle: null,
      remainingSeconds: 0,
      phaseTotalSeconds: 0,
      lastPermissionErrorItemId: '',
      mediaStream: null,
      mediaRecorder: null,
      mimeType: '',
      recordStartedAtMs: 0,
      recordedChunks: [],
      flowToken: 0
    }
  };

  const SIDEBAR_PREF_KEY = 'pte_practice_runner_sidebar_collapsed';
  const ratingModalInstance = (nodes.ratingModal && typeof window !== 'undefined' && window.bootstrap && window.bootstrap.Modal)
    ? new window.bootstrap.Modal(nodes.ratingModal)
    : null;

  function readSidebarCollapsedPreference() {
    try {
      return localStorage.getItem(SIDEBAR_PREF_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function writeSidebarCollapsedPreference(collapsed) {
    try {
      localStorage.setItem(SIDEBAR_PREF_KEY, collapsed ? '1' : '0');
    } catch (_) {}
  }

  function applySidebarLayout(collapsed, { persist = true } = {}) {
    state.sidebarCollapsed = !!collapsed;

    if (nodes.sidebarCol) {
      nodes.sidebarCol.classList.toggle('d-none', state.sidebarCollapsed);
    }
    if (nodes.contentCol) {
      nodes.contentCol.classList.toggle('col-xl-9', !state.sidebarCollapsed);
      nodes.contentCol.classList.toggle('col-xl-12', state.sidebarCollapsed);
    }
    if (nodes.topProgressWrap) {
      nodes.topProgressWrap.classList.toggle('d-none', !state.sidebarCollapsed);
    }
    if (nodes.sidebarToggleBtn) {
      nodes.sidebarToggleBtn.innerHTML = state.sidebarCollapsed
        ? '<i class="bi bi-layout-sidebar me-1"></i> Show Questions'
        : '<i class="bi bi-layout-sidebar-inset me-1"></i> Hide Questions';
      nodes.sidebarToggleBtn.setAttribute('aria-pressed', state.sidebarCollapsed ? 'true' : 'false');
    }

    if (persist) writeSidebarCollapsedPreference(state.sidebarCollapsed);
  }

  function openRatingModal({ afterSave = false } = {}) {
    const item = getActiveItem();
    if (!item) return false;

    updateRatingUI(item);
    const shouldLock = !isRetakeRequiredStatus(clean(item.status || 'pending'));
    setRatingLocked(shouldLock, 'Save your response first, then choose a difficulty rating.');

    if (afterSave && !state.ratingLocked && nodes.ratingMeta) {
      const rating = clean(item.selfDifficultyRating || '').toLowerCase();
      if (!rating) {
        nodes.ratingMeta.textContent = 'Response saved. Please choose a difficulty rating now.';
      }
    }

    if (ratingModalInstance) {
      ratingModalInstance.show();
      return true;
    }
    return false;
  }

  async function notifyMicrophoneError(item, error) {
    const info = describeMicrophoneError(error);
    const itemId = clean(item?.id);
    const shouldDedup = info.key === 'permission_denied' && itemId && state.speaking.lastPermissionErrorItemId === itemId;
    if (!shouldDedup) {
      await showMessage(info.title, info.message, info.key === 'unknown' ? 'error' : 'warning');
      if (itemId) state.speaking.lastPermissionErrorItemId = itemId;
    }
    return info;
  }

  function getItemRuntime(item) {
    if (!item || typeof item !== 'object') return {};
    if (!item.__runnerRuntime || typeof item.__runnerRuntime !== 'object') {
      item.__runnerRuntime = {
        transcript: '',
        mapText: '',
        textDraft: '',
        selectedSingle: '',
        selectedMultiple: [],
        selectedTrueFalse: '',
        speaking: {
          phase: 'idle',
          prepRemaining: 0,
          prepTotalSeconds: 0,
          responseRemaining: 0,
          responseTotalSeconds: 0,
          responseElapsedSeconds: 0,
          localBlob: null,
          localUrl: '',
          durationSeconds: 0,
          uploadedArtifactId: '',
          uploadedArtifact: null,
          uploadPromise: null,
          lastError: ''
        }
      };
    }
    return item.__runnerRuntime;
  }

  function pickSupportedAudioMime() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/mp4'
    ];
    return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || '';
  }

  function speakingUi() {
    return {
      panel: document.getElementById('pteSpeakPanel'),
      phase: document.getElementById('pteSpeakPhaseChip'),
      timer: document.getElementById('pteSpeakTimerChip'),
      timerDisplay: document.getElementById('pteSpeakTimerDisplay'),
      progressWrap: document.getElementById('pteSpeakProgressWrap'),
      progressBar: document.getElementById('pteSpeakProgressBar'),
      progressLabel: document.getElementById('pteSpeakProgressLabel'),
      hint: document.getElementById('pteSpeakHint'),
      startBtn: document.getElementById('pteSpeakStartBtn'),
      stopBtn: document.getElementById('pteSpeakStopBtn'),
      playback: document.getElementById('pteSpeakPlayback'),
      transcript: document.querySelector('#ptePracticeResponsePanel textarea[data-response-text]')
    };
  }

  function formatSeconds(seconds) {
    const s = Math.max(0, toInt(seconds, 0));
    return `${s}s`;
  }

  function formatClock(seconds) {
    const total = Math.max(0, toInt(seconds, 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function toPercent(numerator, denominator) {
    const num = Number(numerator);
    const den = Number(denominator);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((num / den) * 100)));
  }

  function getSpeakingTiming(item) {
    const question = item?.question || {};
    const payload = (question.payload && typeof question.payload === 'object') ? question.payload : {};
    const questionTiming = (question.timing && typeof question.timing === 'object') ? question.timing : {};
    const metadataTiming = (item?.metadata?.timing && typeof item.metadata.timing === 'object') ? item.metadata.timing : {};
    return resolveTiming({
      ...questionTiming,
      ...metadataTiming,
      ...payload
    });
  }

  function getQuestionTypeToken(item) {
    return normalizeQuestionTypeToken(item?.question?.questionType || item?.questionType || '');
  }

  function getPromptAudioUrlForItem(item) {
    const question = item?.question || {};
    const payload = (question.payload && typeof question.payload === 'object') ? question.payload : {};
    const qType = getQuestionTypeToken(item);
    if (!QUESTION_TYPES_WITH_PROMPT_AUDIO.has(qType)) return '';
    return resolveQuestionMediaUrl(question, payload.promptAudioAssetId);
  }

  async function playRepeatSentencePromptThenRecord(item, timing = {}) {
    const itemId = clean(item?.id);
    if (!itemId) return;
    const promptAudio = getPromptAudioElement();
    const promptAudioUrl = getPromptAudioUrlForItem(item);
    if (!promptAudio || !promptAudioUrl) {
      await beginRecordingPhase(item, timing);
      return;
    }

    const flowToken = Number(state.speaking.flowToken || 0) + 1;
    state.speaking.flowToken = flowToken;
    state.speaking.phase = 'prep';
    updateSpeakingUi(
      item,
      'Listening Prompt',
      'Listen to the sentence. Recording will start after playback.',
      '',
      {
        tone: 'prep',
        showProgress: false
      }
    );

    const playbackResult = await new Promise((resolve) => {
      let resolved = false;
      const finish = (result) => {
        if (resolved) return;
        resolved = true;
        promptAudio.removeEventListener('ended', onEnded);
        promptAudio.removeEventListener('error', onError);
        resolve(result);
      };
      const onEnded = () => finish('ended');
      const onError = () => finish('error');

      promptAudio.addEventListener('ended', onEnded);
      promptAudio.addEventListener('error', onError);
      try {
        promptAudio.currentTime = 0;
      } catch (_) {}

      const playPromise = promptAudio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {})
          .catch(() => finish('blocked'));
      } else {
        window.setTimeout(() => {
          const isPlaying = !promptAudio.paused;
          if (!isPlaying) finish('blocked');
        }, 250);
      }
    });

    if (clean(state.speaking.activeItemId) !== itemId) return;
    if (Number(state.speaking.flowToken || 0) !== flowToken) return;

    if (playbackResult === 'ended') {
      await beginRecordingPhase(item, timing);
      return;
    }

    if (playbackResult === 'blocked') {
      await showMessage(
        'Playback Blocked',
        'Browser blocked auto-play. Click play on prompt audio, then click Start Recording.',
        'warning'
      );
      updateSpeakingUi(
        item,
        'Ready',
        'Play the prompt audio, then click Start Recording.',
        '',
        { tone: 'idle', showProgress: false }
      );
      return;
    }

    updateSpeakingUi(
      item,
      'Ready',
      'Prompt audio could not be played. Click Start Recording to continue.',
      '',
      { tone: 'idle', showProgress: false }
    );
  }

  function renderSpeakingPlayback(item) {
    const ui = speakingUi();
    if (!ui.playback) return;
    const runtime = getItemRuntime(item);
    const speaking = runtime.speaking || {};
    if (speaking.localUrl) {
      ui.playback.innerHTML = ''
        + '<div class="small text-success mb-1">Recorded locally (' + formatSeconds(speaking.durationSeconds || 0) + ').</div>'
        + '<audio controls preload="metadata" class="w-100"><source src="' + esc(speaking.localUrl) + '"></audio>'
        + '<div class="small text-muted mt-1">You can listen and click Re-record if you want a better attempt.</div>';
      return;
    }
    if (speaking.uploadedArtifact && clean(speaking.uploadedArtifact.url)) {
      ui.playback.innerHTML = ''
        + '<div class="small text-success mb-1">Uploaded audio artifact.</div>'
        + '<audio controls preload="metadata" class="w-100"><source src="' + esc(speaking.uploadedArtifact.url) + '"></audio>';
      return;
    }
    ui.playback.innerHTML = '<div class="small text-muted">No recording yet.</div>';
  }

  function updateSpeakingUi(item, phaseText = '', hintText = '', timerText = '', visual = {}) {
    const ui = speakingUi();
    if (!ui.phase) return;
    const phase = clean(phaseText) || 'Ready';
    const tone = clean(visual.tone || '').toLowerCase();
    const timerDisplayText = clean(visual.timerDisplay || timerText);
    const progressLabel = clean(visual.progressLabel || '');
    const hasProgressPercent = Number.isFinite(Number(visual.progressPercent));
    const progressPercent = hasProgressPercent
      ? Math.max(0, Math.min(100, Number(visual.progressPercent)))
      : ((tone === 'recording' && visual.showProgress === true) ? 100 : 0);

    if (ui.panel) {
      ui.panel.classList.remove('pte-speak-panel-prep', 'pte-speak-panel-recording', 'pte-speak-panel-finished');
      if (tone === 'prep') ui.panel.classList.add('pte-speak-panel-prep');
      if (tone === 'recording') ui.panel.classList.add('pte-speak-panel-recording');
      if (tone === 'finished' || tone === 'recorded') ui.panel.classList.add('pte-speak-panel-finished');
    }

    let phaseClass = 'badge border';
    if (tone === 'prep') phaseClass += ' bg-warning text-dark';
    else if (tone === 'recording') phaseClass += ' bg-danger text-white';
    else if (tone === 'finished' || tone === 'recorded') phaseClass += ' bg-success text-white';
    else phaseClass += ' bg-primary-subtle text-primary-emphasis';
    ui.phase.className = phaseClass;
    ui.phase.textContent = phase;

    if (ui.hint) ui.hint.textContent = hintText || 'Use Start/Stop controls or timed auto-record for speaking responses.';

    if (ui.timer) {
      if (timerText) {
        ui.timer.style.display = 'inline-flex';
        ui.timer.textContent = timerText;
        ui.timer.className = 'badge border fw-bold ' + (
          tone === 'recording'
            ? 'bg-danger-subtle text-danger-emphasis'
            : (tone === 'prep'
              ? 'bg-warning-subtle text-warning-emphasis'
              : 'bg-light text-dark')
        );
      } else {
        ui.timer.style.display = 'none';
        ui.timer.textContent = '';
      }
    }

    if (ui.timerDisplay) {
      if (timerDisplayText) {
        ui.timerDisplay.style.display = 'block';
        ui.timerDisplay.textContent = timerDisplayText;
        ui.timerDisplay.className = 'pte-speak-timer-display ' + (
          tone === 'recording'
            ? 'pte-speak-tone-recording'
            : (tone === 'prep'
              ? 'pte-speak-tone-prep'
              : 'pte-speak-tone-finished')
        );
      } else {
        ui.timerDisplay.style.display = 'none';
        ui.timerDisplay.textContent = '';
        ui.timerDisplay.className = 'pte-speak-timer-display';
      }
    }

    if (ui.progressWrap) {
      const showProgress = visual.showProgress === true || hasProgressPercent || !!progressLabel;
      ui.progressWrap.style.display = showProgress ? '' : 'none';
    }
    if (ui.progressBar) {
      ui.progressBar.style.width = `${progressPercent}%`;
      ui.progressBar.className = 'progress-bar';
      if (tone === 'recording') ui.progressBar.classList.add('bg-danger');
      else if (tone === 'prep') ui.progressBar.classList.add('bg-warning');
      else if (tone === 'finished' || tone === 'recorded') ui.progressBar.classList.add('bg-success');
      else ui.progressBar.classList.add('bg-secondary');
      if (tone === 'recording' && !hasProgressPercent) {
        ui.progressBar.classList.add('progress-bar-striped', 'progress-bar-animated');
      }
      ui.progressBar.setAttribute('aria-valuenow', String(progressPercent));
      ui.progressBar.setAttribute('aria-valuemin', '0');
      ui.progressBar.setAttribute('aria-valuemax', '100');
    }
    if (ui.progressLabel) {
      ui.progressLabel.textContent = progressLabel;
      ui.progressLabel.style.display = progressLabel ? '' : 'none';
    }

    const speakingRuntime = getItemRuntime(item).speaking || {};
    if (ui.startBtn) {
      const isRecording = state.speaking.mediaRecorder && state.speaking.mediaRecorder.state === 'recording';
      const hasLocalRecording = Boolean(clean(speakingRuntime.localUrl) || clean(speakingRuntime.uploadedArtifactId));
      ui.startBtn.disabled = isRecording;
      const startText = isRecording
        ? 'Recording...'
        : (tone === 'prep'
          ? 'Start Recording Now'
          : (hasLocalRecording ? 'Re-record' : 'Start Recording'));
      ui.startBtn.innerHTML = `<i class="bi bi-mic me-1"></i>${esc(startText)}`;
    }
    if (ui.stopBtn) {
      const isRecording = state.speaking.mediaRecorder && state.speaking.mediaRecorder.state === 'recording';
      ui.stopBtn.disabled = !isRecording;
    }
    renderSpeakingPlayback(item);
    if (ui.transcript && speakingRuntime && typeof speakingRuntime === 'object') {
      if (!ui.transcript.value && speakingRuntime.transcript) {
        ui.transcript.value = speakingRuntime.transcript;
      }
    }
  }

  function clearSpeakingTimer() {
    if (state.speaking.timerHandle) {
      clearInterval(state.speaking.timerHandle);
      state.speaking.timerHandle = null;
    }
  }

  function stopStreamTracks(stream) {
    if (!stream || !Array.isArray(stream.getTracks?.())) return;
    stream.getTracks().forEach((track) => {
      try { track.stop(); } catch (_) {}
    });
  }

  async function stopSpeakingRecorder(item, { preserveBlob = true } = {}) {
    const runtime = getItemRuntime(item);
    const speaking = runtime.speaking || {};
    const recorder = state.speaking.mediaRecorder;
    if (!recorder) return;
    if (recorder.state === 'inactive') {
      state.speaking.mediaRecorder = null;
      stopStreamTracks(state.speaking.mediaStream);
      state.speaking.mediaStream = null;
      return;
    }
    await new Promise((resolve) => {
      const chunks = Array.isArray(state.speaking.recordedChunks) ? state.speaking.recordedChunks : [];
      recorder.onstop = () => {
        if (preserveBlob && chunks.length) {
          if (speaking.localUrl) revokeUrl(speaking.localUrl);
          const blobType = state.speaking.mimeType || 'audio/webm';
          speaking.localBlob = new Blob(chunks, { type: blobType });
          speaking.durationSeconds = Math.max(
            0,
            Math.round((nowMs() - state.speaking.recordStartedAtMs) / 1000)
          );
          speaking.localUrl = URL.createObjectURL(speaking.localBlob);
          // New local recording supersedes any previously uploaded artifact.
          speaking.uploadedArtifactId = '';
          speaking.uploadedArtifact = null;
        }
        state.speaking.recordedChunks = [];
        state.speaking.mediaRecorder = null;
        stopStreamTracks(state.speaking.mediaStream);
        state.speaking.mediaStream = null;
        resolve();
      };
      try {
        recorder.stop();
      } catch (_) {
        state.speaking.mediaRecorder = null;
        stopStreamTracks(state.speaking.mediaStream);
        state.speaking.mediaStream = null;
        resolve();
      }
    });
    runtime.speaking = speaking;
  }

  async function startSpeakingRecorder(item) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('This browser does not support microphone access.');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder API is not supported in this browser.');
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      const insecureError = new Error('Microphone access requires a secure context (HTTPS or localhost).');
      insecureError.name = 'SecurityError';
      throw insecureError;
    }
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      let micPermissionState = '';
      try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        micPermissionState = clean(status?.state || '').toLowerCase();
      } catch (_) {
        // Ignore permissions API failures and rely on getUserMedia result.
      }
      if (micPermissionState === 'denied') {
        const deniedError = new Error('Microphone permission is blocked by browser settings.');
        deniedError.name = 'NotAllowedError';
        throw deniedError;
      }
    }
    const runtime = getItemRuntime(item);
    const speaking = runtime.speaking || {};
    speaking.lastError = '';
    // Starting a fresh recording means the next save/submit must upload this new blob.
    speaking.uploadedArtifactId = '';
    speaking.uploadedArtifact = null;
    speaking.responseElapsedSeconds = 0;

    if (!state.speaking.mediaStream) {
      state.speaking.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    const mimeType = pickSupportedAudioMime();
    state.speaking.mimeType = mimeType;
    const options = mimeType ? { mimeType } : undefined;
    state.speaking.mediaRecorder = new MediaRecorder(state.speaking.mediaStream, options);
    state.speaking.recordedChunks = [];
    state.speaking.mediaRecorder.ondataavailable = (event) => {
      if (event?.data && event.data.size > 0) {
        state.speaking.recordedChunks.push(event.data);
      }
    };
    state.speaking.recordStartedAtMs = nowMs();
    state.speaking.mediaRecorder.start(250);
    state.speaking.phase = 'recording';
    state.speaking.lastPermissionErrorItemId = '';
    speaking.phase = 'recording';
    runtime.speaking = speaking;
  }

  function startCountdown(seconds, onTick, onDone) {
    clearSpeakingTimer();
    let remaining = Math.max(0, toInt(seconds, 0));
    onTick(remaining);
    if (remaining <= 0) {
      onDone();
      return;
    }
    state.speaking.timerHandle = setInterval(() => {
      remaining -= 1;
      onTick(Math.max(0, remaining));
      if (remaining <= 0) {
        clearSpeakingTimer();
        onDone();
      }
    }, 1000);
  }

  async function beginRecordingPhase(item, timing = {}) {
    if (!item || !isSpeakingQuestion(item)) return;
    const runtime = getItemRuntime(item);
    const speaking = runtime.speaking || {};
    const itemId = clean(item.id);
    state.speaking.activeItemId = itemId;
    state.speaking.phase = 'recording';
    speaking.phase = 'recording';
    speaking.prepRemaining = 0;
    speaking.responseTotalSeconds = Math.max(0, toInt(timing.responseSeconds, 0));
    speaking.responseRemaining = speaking.responseTotalSeconds;
    speaking.responseElapsedSeconds = 0;
    runtime.speaking = speaking;
    updateSpeakingUi(
      item,
      'Recording',
      'Preparation finished. Microphone is starting now.',
      speaking.responseTotalSeconds > 0 ? `Recording ${formatClock(speaking.responseTotalSeconds)} left` : '',
      {
        tone: 'recording',
        timerDisplay: speaking.responseTotalSeconds > 0 ? `${formatClock(speaking.responseTotalSeconds)} left` : '',
        showProgress: speaking.responseTotalSeconds > 0,
        progressPercent: 0,
        progressLabel: speaking.responseTotalSeconds > 0
          ? `REC | Spoken ${formatClock(0)} / ${formatClock(speaking.responseTotalSeconds)}`
          : ''
      }
    );

    try {
      await startSpeakingRecorder(item);
    } catch (error) {
      const micError = await notifyMicrophoneError(item, error);
      speaking.lastError = clean(micError.inline || error?.message, 300);
      state.speaking.phase = 'idle';
      speaking.phase = 'idle';
      updateSpeakingUi(item, 'Ready', speaking.lastError || 'Unable to start microphone recording.', '', {
        tone: 'idle'
      });
      runtime.speaking = speaking;
      return;
    }

    if (speaking.responseTotalSeconds > 0) {
      const total = speaking.responseTotalSeconds;
      state.speaking.phaseTotalSeconds = total;
      startCountdown(
        total,
        (remaining) => {
          if (clean(state.speaking.activeItemId) !== itemId) return;
          speaking.responseRemaining = remaining;
          const elapsed = Math.max(0, total - remaining);
          speaking.responseElapsedSeconds = elapsed;
          updateSpeakingUi(
            item,
            'Recording',
            'You are recording now. Stop anytime, or wait for auto-stop at the time limit.',
            `Recording ${formatClock(remaining)} left`,
            {
              tone: 'recording',
              timerDisplay: `${formatClock(remaining)} left`,
              showProgress: true,
              progressPercent: toPercent(elapsed, total),
              progressLabel: `REC | Spoken ${formatClock(elapsed)} / ${formatClock(total)}`
            }
          );
        },
        async () => {
          if (clean(state.speaking.activeItemId) !== itemId) return;
          await stopSpeakingRecorder(item, { preserveBlob: true });
          state.speaking.phase = 'recorded';
          speaking.phase = 'recorded';
          speaking.responseRemaining = 0;
          speaking.responseElapsedSeconds = total;
          updateSpeakingUi(
            item,
            'Time Finished',
            'Response time is finished. Listen if needed, then save or submit this answer.',
            `Recorded ${formatClock(speaking.durationSeconds || total)}`,
            {
              tone: 'finished',
              timerDisplay: `${formatClock(speaking.durationSeconds || total)} spoken`,
              showProgress: true,
              progressPercent: 100,
              progressLabel: 'Recording auto-stopped at time limit.'
            }
          );
        }
      );
      runtime.speaking = speaking;
      return;
    }

    clearSpeakingTimer();
    updateSpeakingUi(
      item,
      'Recording',
      'You are recording now. Stop anytime when you finish speaking.',
      '',
      {
        tone: 'recording',
        timerDisplay: `${formatClock(0)} elapsed`,
        showProgress: true,
        progressLabel: 'REC | Spoken 00:00 (no fixed limit for this question)'
      }
    );
    state.speaking.timerHandle = setInterval(() => {
      if (clean(state.speaking.activeItemId) !== itemId) {
        clearSpeakingTimer();
        return;
      }
      const recorder = state.speaking.mediaRecorder;
      if (!recorder || recorder.state !== 'recording') {
        clearSpeakingTimer();
        return;
      }
      const elapsed = Math.max(0, Math.floor((nowMs() - state.speaking.recordStartedAtMs) / 1000));
      speaking.responseElapsedSeconds = elapsed;
      updateSpeakingUi(
        item,
        'Recording',
        'You are recording now. Stop anytime when you finish speaking.',
        '',
        {
          tone: 'recording',
          timerDisplay: `${formatClock(elapsed)} elapsed`,
          showProgress: true,
          progressLabel: `REC | Spoken ${formatClock(elapsed)} (no fixed limit for this question)`
        }
      );
    }, 1000);
    runtime.speaking = speaking;
  }

  async function runSpeakingFlow(item, { manual = false } = {}) {
    if (!item || !isSpeakingQuestion(item)) return;
    const timing = getSpeakingTiming(item);
    const runtime = getItemRuntime(item);
    const speaking = runtime.speaking || {};
    const itemId = clean(item.id);
    const questionType = getQuestionTypeToken(item);
    state.speaking.activeItemId = itemId;
    speaking.prepTotalSeconds = Math.max(0, toInt(timing.prepSeconds, 0));
    speaking.responseTotalSeconds = Math.max(0, toInt(timing.responseSeconds, 0));
    runtime.speaking = speaking;

    if (manual) {
      const recorder = state.speaking.mediaRecorder;
      if (recorder && recorder.state === 'recording') return;
      state.speaking.flowToken = Number(state.speaking.flowToken || 0) + 1;
      stopPromptAudioPlayback({ reset: true });
      clearSpeakingTimer();
      await beginRecordingPhase(item, timing);
      return;
    }

    if (questionType === 'speaking_repeat_sentence') {
      await playRepeatSentencePromptThenRecord(item, timing);
      runtime.speaking = speaking;
      return;
    }

    if (timing.prepSeconds > 0) {
      state.speaking.phase = 'prep';
      speaking.phase = 'prep';
      state.speaking.phaseTotalSeconds = timing.prepSeconds;
      startCountdown(
        timing.prepSeconds,
        (remaining) => {
          if (clean(state.speaking.activeItemId) !== itemId) return;
          speaking.prepRemaining = remaining;
          const elapsed = Math.max(0, timing.prepSeconds - remaining);
          updateSpeakingUi(
            item,
            'Preparation',
            'Preparation time is running. You can start recording now or wait for auto-start.',
            `Prep ${formatClock(remaining)}`,
            {
              tone: 'prep',
              timerDisplay: `${formatClock(remaining)} prep`,
              showProgress: true,
              progressPercent: toPercent(elapsed, timing.prepSeconds),
              progressLabel: `Preparation ${formatClock(elapsed)} / ${formatClock(timing.prepSeconds)}`
            }
          );
        },
        async () => {
          if (state.speaking.phase !== 'prep') return;
          if (clean(state.speaking.activeItemId) !== itemId) return;
          await beginRecordingPhase(item, timing);
        }
      );
      runtime.speaking = speaking;
      return;
    }

    await beginRecordingPhase(item, timing);
    runtime.speaking = speaking;
  }

  async function stopSpeakingFlowForActiveItem({ preserveBlob = true } = {}) {
    state.speaking.flowToken = Number(state.speaking.flowToken || 0) + 1;
    stopPromptAudioPlayback({ reset: false });
    const currentItem = state.itemMap.get(clean(state.speaking.activeItemId || state.activeItemId || '')) || null;
    clearSpeakingTimer();
    if (!currentItem) {
      stopStreamTracks(state.speaking.mediaStream);
      state.speaking.mediaStream = null;
      state.speaking.mediaRecorder = null;
      return;
    }
    await stopSpeakingRecorder(currentItem, { preserveBlob });
    const timing = getSpeakingTiming(currentItem);
    const runtime = getItemRuntime(currentItem);
    const speaking = runtime.speaking || {};
    if (preserveBlob && speaking.localBlob) {
      state.speaking.phase = 'recorded';
      speaking.phase = 'recorded';
      const duration = Math.max(0, toInt(speaking.durationSeconds, 0));
      updateSpeakingUi(
        currentItem,
        'Recorded',
        'Recording stopped. You can listen and Re-record if needed, then save or submit.',
        `Recorded ${formatClock(duration)}`,
        {
          tone: 'recorded',
          timerDisplay: `${formatClock(duration)} spoken`,
          showProgress: timing.responseSeconds > 0,
          progressPercent: timing.responseSeconds > 0 ? toPercent(duration, timing.responseSeconds) : 0,
          progressLabel: timing.responseSeconds > 0
            ? `Spoken ${formatClock(duration)} / ${formatClock(timing.responseSeconds)}`
            : `Spoken ${formatClock(duration)}`
        }
      );
    } else {
      state.speaking.phase = 'idle';
      speaking.phase = 'idle';
      updateSpeakingUi(currentItem, 'Ready', 'Press Start Recording to begin your speaking response.', '', {
        tone: 'idle',
        showProgress: false
      });
    }
    runtime.speaking = speaking;
  }

  function buildRuntimeEndpoint(path) {
    if (!actionStateId) return path;
    return path + (path.includes('?') ? '&' : '?') + 'actionStateId=' + encodeURIComponent(actionStateId);
  }

  async function postRuntime(path, runtimePlan) {
    const body = new URLSearchParams();
    body.set('runtimePlan', JSON.stringify(runtimePlan || {}));
    body.set('actionStateId', actionStateId);
    const response = await fetch(buildRuntimeEndpoint(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-AJAX-Request': 'true',
        'Accept': 'application/json'
      },
      credentials: 'include',
      body: body.toString()
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.status !== 'success') {
      throw new Error((result && result.message) || ('Request failed with status ' + response.status + '.'));
    }
    return result.results || {};
  }

  async function uploadSpeakingArtifact(item) {
    if (!item || !isSpeakingQuestion(item)) return null;
    const runtime = getItemRuntime(item);
    const speaking = runtime.speaking || {};
    if (!speaking.localBlob) return speaking.uploadedArtifact || null;
    if (speaking.uploadedArtifactId) return speaking.uploadedArtifact || null;
    if (speaking.uploadPromise) return speaking.uploadPromise;

    const itemId = clean(item.id);
    const sessionId = clean(session.id);
    const extension = (state.speaking.mimeType || speaking.localBlob.type || 'audio/webm').includes('ogg') ? 'ogg' : 'webm';
    const filename = `${itemId || 'item'}_${Date.now()}.${extension}`;

    const formData = new FormData();
    formData.append('audioFile', speaking.localBlob, filename);
    formData.append('durationSeconds', String(Math.max(0, toInt(speaking.durationSeconds, 0))));
    formData.append('actionStateId', actionStateId);
    formData.append('runtimePlan', JSON.stringify({
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'response_saved',
        eventId: 'PTE-PRACTICE-AUDIO-' + itemId + '-' + Date.now(),
        idempotencyKey: 'PTE-PRACTICE-AUDIO-' + itemId + '-' + nowIso()
      }
    }));

    speaking.uploadPromise = (async () => {
      const response = await fetch(
        buildRuntimeEndpoint('/pte/practice/api/runtime/' + encodeURIComponent(sessionId) + '/items/' + encodeURIComponent(itemId) + '/upload-audio'),
        {
          method: 'POST',
          headers: {
            'X-AJAX-Request': 'true',
            'Accept': 'application/json'
          },
          credentials: 'include',
          body: formData
        }
      );
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || result.status !== 'success') {
        throw new Error((result && result.message) || ('Audio upload failed with status ' + response.status + '.'));
      }
      const updatedItem = result?.results?.item || null;
      if (updatedItem) Object.assign(item, updatedItem);
      const artifact = result?.results?.artifact || null;
      speaking.uploadedArtifact = artifact;
      speaking.uploadedArtifactId = clean(artifact?.id || '');
      return artifact;
    })().finally(() => {
      speaking.uploadPromise = null;
    });

    runtime.speaking = speaking;
    return speaking.uploadPromise;
  }

  function getActiveItem() {
    return items[state.index] || null;
  }

  function persistCurrentDraft() {
    const prevId = clean(state.activeItemId);
    if (!prevId) return;
    const prevItem = state.itemMap.get(prevId);
    if (!prevItem) return;
    const runtime = getItemRuntime(prevItem);

    const textArea = nodes.response.querySelector('textarea[data-response-text]');
    if (textArea) {
      const value = String(textArea.value || '');
      if (isSpeakingQuestion(prevItem)) runtime.speaking.transcript = value;
      else runtime.textDraft = value;
    }
    const mapArea = nodes.response.querySelector('textarea[data-response-map]');
    if (mapArea) runtime.mapText = String(mapArea.value || '');
    const tfSelect = nodes.response.querySelector('select[data-response-true-false]');
    if (tfSelect) runtime.selectedTrueFalse = clean(tfSelect.value).toLowerCase();
    const single = nodes.response.querySelector('input[type="radio"][name="practice_single_choice"]:checked');
    runtime.selectedSingle = clean(single?.value || '');
    runtime.selectedMultiple = Array.from(nodes.response.querySelectorAll('input[type="checkbox"][name="practice_multi_choice"]:checked'))
      .map((node) => clean(node.value))
      .filter(Boolean);
  }

  function collectResponseSummary(item) {
    const questionType = normalizeQuestionTypeToken(item?.question?.questionType || item?.questionType || '');
    const runtime = getItemRuntime(item);
    const speaking = runtime.speaking || {};
    const summary = {
      kind: questionType || 'unknown',
      payloadBytes: 0,
      textLength: 0,
      wordCount: 0,
      optionCount: 0,
      blankCount: 0,
      pairCount: 0,
      audioDurationSeconds: 0,
      artifactCount: 0
    };

    const textArea = nodes.response.querySelector('textarea[data-response-text]');
    if (textArea) {
      const text = String(textArea.value || '');
      summary.textLength = text.length;
      summary.wordCount = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
    }

    const singleChoice = nodes.response.querySelector('input[type="radio"][name="practice_single_choice"]:checked');
    if (singleChoice) summary.optionCount = 1;
    const multiChoice = Array.from(nodes.response.querySelectorAll('input[type="checkbox"][name="practice_multi_choice"]:checked'));
    if (multiChoice.length) summary.optionCount = multiChoice.length;

    const tfSelect = nodes.response.querySelector('select[data-response-true-false]');
    if (tfSelect && clean(tfSelect.value)) summary.optionCount = 1;

    const mapTextarea = nodes.response.querySelector('textarea[data-response-map]');
    if (mapTextarea) {
      const text = clean(mapTextarea.value);
      if (text) summary.textLength = Math.max(summary.textLength, text.length);
    }

    if (isSpeakingQuestion(item)) {
      summary.audioDurationSeconds = Math.max(0, Number(speaking.durationSeconds || 0) || 0);
      const artifactCount = Array.isArray(item.artifactIds) ? item.artifactIds.length : 0;
      summary.artifactCount = Math.max(artifactCount, speaking.uploadedArtifactId ? 1 : 0);
    } else {
      summary.artifactCount = Array.isArray(item.artifactIds) ? item.artifactIds.length : 0;
    }

    summary.payloadBytes = JSON.stringify(summary).length;
    return summary;
  }

  function renderQuestionPrompt(item) {
    const question = item?.question || {};
    const payload = (question.payload && typeof question.payload === 'object') ? question.payload : {};
    const qType = normalizeQuestionTypeToken(question.questionType || item?.questionType || '');
    const instructionText = clean(payload.instructions || question.instructions || '');
    const taskTitle = clean(
      payload.taskTitle
      || payload.promptTitle
      || payload.sourceTitle
      || payload.stemTitle
      || question.title
      || item?.metadata?.questionTitle
      || ''
    );
    const normalizePromptToken = (value) => clean(value).toLowerCase().replace(/\s+/g, ' ').trim();
    let html = '';
    let hasPromptBody = false;
    const promptTokenSet = new Set();

    const rememberToken = (value) => {
      const token = normalizePromptToken(value);
      if (token) promptTokenSet.add(token);
    };

    const appendPromptBody = (value, className = 'mb-2') => {
      const text = clean(value);
      const token = normalizePromptToken(text);
      if (!token || promptTokenSet.has(token)) return;
      promptTokenSet.add(token);
      hasPromptBody = true;
      html += '<div class="' + className + '">' + nl2br(text) + '</div>';
    };

    const appendSituationBlock = (value) => {
      const raw = clean(value);
      if (!raw) return;
      const body = clean(raw.replace(/^situation\s*:\s*/i, '')) || raw;
      const token = normalizePromptToken(body);
      if (!token || promptTokenSet.has(token)) return;
      promptTokenSet.add(token);
      hasPromptBody = true;
      html += ''
        + '<div class="mb-3">'
        + '  <div class="small fw-bold text-uppercase text-muted mb-1">Situation</div>'
        + '  <div class="border rounded p-2 bg-white">' + nl2br(body) + '</div>'
        + '</div>';
    };

    const appendGenericPromptBodies = () => {
      appendPromptBody(payload.sourceText, 'mb-2');
      appendPromptBody(payload.stem, 'fw-bold mb-2');
      appendSituationBlock(payload.situationText);
      appendSituationBlock(payload.scenarioText);
      const promptText = clean(payload.promptText);
      if (/^situation\s*:/i.test(promptText)) appendSituationBlock(promptText);
      else appendPromptBody(promptText, 'mb-2');
      appendPromptBody(payload.transcriptWithBlanks, 'mb-2');
      appendPromptBody(payload.passageWithBlanks, 'mb-2');
      appendPromptBody(payload.promptTextOrAudio, 'mb-2');
      if (payload.expectedTranscript && !hasPromptBody) {
        appendPromptBody(payload.expectedTranscript, 'mb-2');
      }
    };

    if (instructionText) {
      html += ''
        + '<div class="mb-3">'
        + '  <div class="small fw-bold text-uppercase text-muted mb-1">Instruction</div>'
        + '  <div class="border rounded p-2 bg-white">' + nl2br(instructionText) + '</div>'
        + '</div>';
      rememberToken(instructionText);
    }
    if (taskTitle) rememberToken(taskTitle);

    switch (qType) {
      case 'speaking_repeat_sentence': {
        const audioBlock = renderPromptAudioBlock(question, payload.promptAudioAssetId, 'Prompt Audio', { autoPlay: true });
        if (audioBlock) {
          html += audioBlock;
          hasPromptBody = true;
        } else {
          html += '<div class="small text-warning mb-2">Prompt audio is not attached yet.</div>';
        }
        appendPromptBody(payload.promptTextOrAudio, 'mb-2');
        appendPromptBody(payload.expectedTranscript, 'small text-muted mb-2');
        break;
      }
      case 'speaking_describe_image': {
        const imageBlock = renderPromptImageBlock(question, payload.imageAssetId, 'Prompt Image');
        if (imageBlock) {
          html += imageBlock;
          hasPromptBody = true;
        } else {
          html += '<div class="small text-warning mb-2">Prompt image is not attached yet.</div>';
        }
        appendPromptBody(payload.imageCaption, 'small text-muted mb-2');
        appendPromptBody(payload.sourceText, 'mb-2');
        break;
      }
      case 'speaking_respond_to_situation': {
        appendSituationBlock(payload.situationText || payload.scenarioText || payload.promptText);
        const roleLine = [
          clean(payload.role) ? ('Role: ' + clean(payload.role)) : '',
          clean(payload.audience) ? ('Audience: ' + clean(payload.audience)) : '',
          clean(payload.targetFunction) ? ('Function: ' + clean(payload.targetFunction)) : '',
          clean(payload.targetRegister) ? ('Register: ' + clean(payload.targetRegister)) : ''
        ].filter(Boolean).join(' | ');
        if (roleLine) {
          html += '<div class="small text-muted mb-2">' + esc(roleLine) + '</div>';
          hasPromptBody = true;
        }
        appendPromptBody(payload.promptText, 'mb-2');
        break;
      }
      case 'speaking_answer_short_question': {
        const audioBlock = renderPromptAudioBlock(question, payload.promptAudioAssetId, 'Prompt Audio', { autoPlay: true });
        if (audioBlock) {
          html += audioBlock;
          hasPromptBody = true;
        }
        appendPromptBody(payload.promptTextOrAudio || payload.promptText || payload.stem, 'mb-2');
        break;
      }
      case 'listening_mcq_single':
      case 'listening_mcq_multiple':
      case 'listening_fill_in_blank':
      case 'listening_dictation': {
        const audioBlock = renderPromptAudioBlock(question, payload.promptAudioAssetId, 'Listening Audio', { autoPlay: false });
        if (audioBlock) {
          html += audioBlock;
          hasPromptBody = true;
        } else {
          html += '<div class="small text-warning mb-2">Listening audio is not attached yet.</div>';
        }
        appendPromptBody(payload.stem, 'fw-bold mb-2');
        appendPromptBody(payload.transcriptWithBlanks, 'mb-2');
        appendPromptBody(payload.passageWithBlanks, 'mb-2');
        appendPromptBody(payload.promptText, 'mb-2');
        break;
      }
      case 'reading_fill_in_blank':
        appendPromptBody(payload.passageWithBlanks, 'mb-2');
        appendPromptBody(payload.stem, 'fw-bold mb-2');
        break;
      case 'reading_reorder_paragraphs': {
        const rows = Array.isArray(payload.paragraphItems) ? payload.paragraphItems : [];
        if (rows.length) {
          html += '<div class="small fw-bold mb-2">Paragraphs</div><ol class="small mb-2">';
          rows.forEach((row) => {
            html += '<li class="mb-1">' + esc(clean(row)) + '</li>';
          });
          html += '</ol>';
          hasPromptBody = true;
        }
        appendPromptBody(payload.stem, 'fw-bold mb-2');
        break;
      }
      case 'reading_matching':
      case 'listening_matching': {
        if (qType === 'listening_matching') {
          const audioBlock = renderPromptAudioBlock(question, payload.promptAudioAssetId, 'Listening Audio', { autoPlay: false });
          if (audioBlock) {
            html += audioBlock;
            hasPromptBody = true;
          } else {
            html += '<div class="small text-warning mb-2">Listening audio is not attached yet.</div>';
          }
        }
        appendPromptBody(payload.stem, 'fw-bold mb-2');
        const leftCount = Array.isArray(payload.leftItems) ? payload.leftItems.length : 0;
        const rightCount = Array.isArray(payload.rightItems) ? payload.rightItems.length : 0;
        if (leftCount || rightCount) {
          html += '<div class="small text-muted mb-2">Matching Items: Left ' + leftCount + ' / Right ' + rightCount + '</div>';
          hasPromptBody = true;
        }
        break;
      }
      default:
        appendGenericPromptBodies();
        break;
    }

    if (taskTitle && !hasPromptBody) {
      html += '<div class="small text-muted mb-2">' + esc(taskTitle) + '</div>';
    }

    if (!hasPromptBody && payload.imageAssetId) {
      const imageBlock = renderPromptImageBlock(question, payload.imageAssetId, 'Prompt Image');
      if (imageBlock) {
        html += imageBlock;
        hasPromptBody = true;
      }
    }

    if (isSpeakingQuestion(item)) {
      const timing = getSpeakingTiming(item);
      const prepText = timing.prepSeconds > 0 ? ('Prep ' + timing.prepSeconds + 's') : '';
      const responseText = timing.responseSeconds > 0 ? ('Response ' + timing.responseSeconds + 's') : '';
      const timingLabel = [prepText, responseText].filter(Boolean).join(' / ');
      if (timingLabel) {
        html += '<div class="badge bg-primary-subtle text-primary-emphasis border mt-1">' + esc(timingLabel) + '</div>';
      }
    }

    if (!html) {
      html = '<div class="text-muted">Prompt preview is not available for this type yet. Continue with response actions for runtime tracking.</div>';
    }

    if (Array.isArray(payload.options) && payload.options.length && !qType.includes('matching')) {
      html += '<hr><div class="small fw-bold mb-1">Options</div><ul class="small mb-0">';
      payload.options.forEach((opt) => {
        const key = clean(opt && (opt.key || opt.id || ''));
        const text = clean(opt && (opt.text || opt.label || opt.value || ''));
        html += '<li><span class="font-monospace">' + esc(key || '-') + '</span> - ' + esc(text || '-') + '</li>';
      });
      html += '</ul>';
    }

    return html;
  }

  function renderResponsePanel(item) {
    const question = item?.question || {};
    const payload = (question.payload && typeof question.payload === 'object') ? question.payload : {};
    const qType = normalizeQuestionTypeToken(question.questionType || item.questionType || '');
    const runtime = getItemRuntime(item);
    let html = '';

    if (isSpeakingQuestion(item)) {
      html = ''
        + '<div id="pteSpeakPanel" class="pte-speak-panel border rounded p-3 bg-light-subtle mb-3">'
        + '  <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">'
        + '    <span id="pteSpeakPhaseChip" class="badge bg-primary-subtle text-primary-emphasis border">Ready</span>'
        + '    <span id="pteSpeakTimerChip" class="badge bg-light text-dark border" style="display:none;"></span>'
        + '  </div>'
        + '  <div id="pteSpeakTimerDisplay" class="pte-speak-timer-display"></div>'
        + '  <div id="pteSpeakProgressWrap" class="pte-speak-progress-wrap" style="display:none;">'
        + '    <div class="progress mb-1" style="height: 12px;">'
        + '      <div id="pteSpeakProgressBar" class="progress-bar bg-secondary" role="progressbar" style="width:0%;"></div>'
        + '    </div>'
        + '    <div id="pteSpeakProgressLabel" class="small fw-bold text-muted mb-2" style="display:none;"></div>'
        + '  </div>'
        + '  <div id="pteSpeakHint" class="small text-muted mb-2">Speaking response requires microphone recording.</div>'
        + '  <div class="d-flex align-items-center gap-2 flex-wrap mb-2">'
        + '    <button type="button" id="pteSpeakStartBtn" class="btn btn-outline-primary btn-sm"><i class="bi bi-mic me-1"></i>Start Recording</button>'
        + '    <button type="button" id="pteSpeakStopBtn" class="btn btn-outline-danger btn-sm" disabled><i class="bi bi-stop-circle me-1"></i>Stop</button>'
        + '  </div>'
        + '  <div id="pteSpeakPlayback"></div>'
        + '</div>'
        + '<label class="form-label fw-bold">Transcript Notes (Optional)</label>'
        + '<textarea class="form-control" rows="5" data-response-text placeholder="Optional transcript / notes for this speaking response...">' + esc(runtime.speaking.transcript || '') + '</textarea>';
    } else if (qType.includes('mcq_single')) {
      const options = Array.isArray(payload.options) ? payload.options : [];
      html = options.map((row, index) => {
        const key = clean(row && (row.key || row.id || String.fromCharCode(65 + index)));
        const text = clean(row && (row.text || row.label || row.value || ''));
        const checked = runtime.selectedSingle && runtime.selectedSingle === key ? ' checked' : '';
        return ''
          + '<div class="form-check mb-2">'
          + '  <input class="form-check-input" type="radio" name="practice_single_choice" id="practice_single_' + index + '" value="' + esc(key) + '"' + checked + '>'
          + '  <label class="form-check-label" for="practice_single_' + index + '"><span class="font-monospace">' + esc(key) + '</span> - ' + esc(text) + '</label>'
          + '</div>';
      }).join('');
    } else if (qType.includes('mcq_multiple')) {
      const options = Array.isArray(payload.options) ? payload.options : [];
      const selectedSet = new Set(Array.isArray(runtime.selectedMultiple) ? runtime.selectedMultiple : []);
      html = options.map((row, index) => {
        const key = clean(row && (row.key || row.id || String.fromCharCode(65 + index)));
        const text = clean(row && (row.text || row.label || row.value || ''));
        const checked = selectedSet.has(key) ? ' checked' : '';
        return ''
          + '<div class="form-check mb-2">'
          + '  <input class="form-check-input" type="checkbox" name="practice_multi_choice" id="practice_multi_' + index + '" value="' + esc(key) + '"' + checked + '>'
          + '  <label class="form-check-label" for="practice_multi_' + index + '"><span class="font-monospace">' + esc(key) + '</span> - ' + esc(text) + '</label>'
          + '</div>';
      }).join('');
    } else if (qType.includes('true_false')) {
      html = ''
        + '<label class="form-label fw-bold">Select</label>'
        + '<select class="form-select" data-response-true-false>'
        + '  <option value="">-- Select --</option>'
        + '  <option value="true"' + (runtime.selectedTrueFalse === 'true' ? ' selected' : '') + '>True</option>'
        + '  <option value="false"' + (runtime.selectedTrueFalse === 'false' ? ' selected' : '') + '>False</option>'
        + '  <option value="not_given"' + (runtime.selectedTrueFalse === 'not_given' ? ' selected' : '') + '>Not Given</option>'
        + '</select>';
    } else if (qType.includes('matching') || qType.includes('fill_in_blank') || qType.includes('reorder_paragraphs')) {
      html = '<textarea class="form-control" rows="6" data-response-map placeholder="Enter your response map / order / blanks in JSON or text form...">' + esc(runtime.mapText || '') + '</textarea>';
    } else {
      html = '<textarea class="form-control" rows="8" data-response-text placeholder="Type your response...">' + esc(runtime.textDraft || '') + '</textarea>';
    }

    nodes.response.innerHTML = html || '<div class="text-muted">No response input required.</div>';
  }

  function refreshQuestionNav() {
    nodes.nav.innerHTML = items.map((item, index) => {
      const status = clean(item.status || 'pending').toLowerCase() || 'pending';
      const isCurrent = index === state.index;
      const badgeClass = isAnsweredStatus(status)
        ? 'bg-success'
        : (status === 'abandoned' ? 'bg-warning text-dark' : 'bg-secondary');
      return ''
        + '<button type="button" class="btn btn-sm text-start border pte-practice-nav-btn ' + (isCurrent ? 'border-primary bg-light' : 'border-light') + '" data-index="' + index + '">'
        + '  <div class="d-flex align-items-center justify-content-between gap-2">'
        + '    <span class="fw-bold">Q' + (index + 1) + '</span>'
        + '    <span class="badge ' + badgeClass + '">' + esc(status || 'pending') + '</span>'
        + '  </div>'
        + '  <div class="small text-muted">' + esc(formatQuestionTypeLabel(clean(item.questionType || item?.question?.questionType)) || '-') + '</div>'
        + '</button>';
    }).join('');

    nodes.nav.querySelectorAll('.pte-practice-nav-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const index = Number.parseInt(clean(btn.getAttribute('data-index')), 10);
        if (!Number.isFinite(index) || index < 0 || index >= items.length) return;
        persistCurrentDraft();
        await stopSpeakingFlowForActiveItem({ preserveBlob: true });
        state.index = index;
        await renderActiveQuestion();
      });
    });
  }

  function refreshProgress() {
    const answered = items.filter((row) => isAnsweredStatus(row.status)).length;
    const pct = items.length ? Math.round((answered / items.length) * 100) : 0;
    const progressText = answered + ' / ' + items.length + ' answered';
    if (nodes.progressBar) nodes.progressBar.style.width = pct + '%';
    if (nodes.progressText) nodes.progressText.textContent = progressText;
    if (nodes.topProgressBar) nodes.topProgressBar.style.width = pct + '%';
    if (nodes.topProgressText) nodes.topProgressText.textContent = progressText;
  }

  function formatRatingLabel(rating = '') {
    const token = clean(rating).toLowerCase();
    if (!token) return '';
    return token
      .split('_')
      .map((part) => part ? (part.charAt(0).toUpperCase() + part.slice(1)) : '')
      .join(' ')
      .trim();
  }

  function setRatingButtonsBusy(busy, activeRating = '') {
    const active = clean(activeRating).toLowerCase();
    (Array.isArray(nodes.ratingButtons) ? nodes.ratingButtons : []).forEach((btn) => {
      const token = clean(btn.getAttribute('data-difficulty-rating')).toLowerCase();
      btn.disabled = !!busy || !!state.ratingLocked;
      btn.classList.toggle('is-saving', !!busy && active && token === active);
    });
  }

  function updateRatingUI(item) {
    const rating = clean(item.selfDifficultyRating || '').toLowerCase();
    (Array.isArray(nodes.ratingButtons) ? nodes.ratingButtons : []).forEach((btn) => {
      const token = clean(btn.getAttribute('data-difficulty-rating')).toLowerCase();
      const selected = !!rating && token === rating;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (!nodes.ratingMeta) return;
    if (!rating) {
      nodes.ratingMeta.textContent = 'No difficulty rating saved yet.';
      return;
    }
    const ratedAt = clean(item.selfDifficultyRatedAt);
    nodes.ratingMeta.textContent = 'Saved as ' + formatRatingLabel(rating) + (ratedAt ? (' at ' + new Date(ratedAt).toLocaleString()) : '.');
  }

  function setRatingLocked(locked, hintText = '') {
    state.ratingLocked = !!locked;
    setRatingButtonsBusy(state.ratingInFlight, '');
    if (!nodes.ratingMeta) return;
    if (!state.ratingLocked) return;
    const item = getActiveItem();
    const hasRating = !!clean(item?.selfDifficultyRating || '');
    if (!hasRating && hintText) nodes.ratingMeta.textContent = hintText;
  }

  function renderStartGate(actionLabel = 'Start', message = '', mode = 'start') {
    const isRestart = clean(mode).toLowerCase() === 'restart';
    const buttonClass = isRestart
      ? 'btn btn-filled btn-warning btn-lg px-5 py-3 fw-bold'
      : 'btn btn-filled btn-primary btn-lg px-5 py-3 fw-bold';
    return ''
      + '<div class="border rounded p-5 text-center bg-light-subtle">'
      + '  <button type="button" id="ptePracticeStartBtn" data-start-mode="' + esc(mode) + '" class="' + buttonClass + '">'
      + '    <i class="bi bi-play-circle me-1"></i>' + esc(actionLabel)
      + '  </button>'
      + '  <div class="small text-muted mt-3">' + esc(message || '') + '</div>'
      + '</div>';
  }

  function resetItemForRestart(item) {
    if (!item || typeof item !== 'object') return;
    const runtime = getItemRuntime(item);
    runtime.textDraft = '';
    runtime.mapText = '';
    runtime.selectedSingle = '';
    runtime.selectedMultiple = [];
    runtime.selectedTrueFalse = '';
    runtime.transcript = '';
    const speaking = runtime.speaking || {};
    if (speaking.localUrl) revokeUrl(speaking.localUrl);
    runtime.speaking = {
      phase: 'idle',
      prepRemaining: 0,
      prepTotalSeconds: 0,
      responseRemaining: 0,
      responseTotalSeconds: 0,
      responseElapsedSeconds: 0,
      localBlob: null,
      localUrl: '',
      durationSeconds: 0,
      uploadedArtifactId: '',
      uploadedArtifact: null,
      uploadPromise: null,
      lastError: ''
    };
    if (Array.isArray(item.artifactIds)) item.artifactIds = [];
    item.selfDifficultyRating = '';
    item.selfDifficultyRatedAt = '';
    item.status = 'in_progress';
  }

  async function startOrRestartCurrentQuestion(restart = false) {
    const item = getActiveItem();
    if (!item) return;
    const itemId = clean(item.id);
    if (!itemId) return;
    const startButton = document.getElementById('ptePracticeStartBtn');
    setButtonBusy(startButton, true, restart ? 'Restarting...' : 'Starting...');
    try {
      await stopSpeakingFlowForActiveItem({ preserveBlob: false });
      if (restart) resetItemForRestart(item);
      await ensureItemStarted(item);
      state.openedItemIds.add(itemId);
      await renderActiveQuestion();
      if (isSpeakingQuestion(item)) {
        await runSpeakingFlow(item, { manual: false });
      }
    } catch (error) {
      await showMessage(restart ? 'Restart Failed' : 'Start Failed', error.message || 'Unable to start this question.', 'error');
    } finally {
      setButtonBusy(startButton, false);
    }
  }

  async function ensureItemStarted(item) {
    const itemId = clean(item.id);
    if (!itemId) return;
    if (state.startedInFlight.has(itemId)) return;
    state.startedInFlight.add(itemId);
    try {
      await postRuntime('/pte/practice/api/runtime/' + encodeURIComponent(clean(session.id)) + '/items/' + encodeURIComponent(itemId) + '/start', {
        source: {
          module: 'pte_practice_runner_ui',
          eventType: 'question_started',
          eventId: 'PTE-PRACTICE-STARTITEM-' + itemId + '-' + Date.now()
        }
      });
      state.startedItemIds.add(itemId);
    } catch (_) {
      // Keep UI usable if start event fails.
    } finally {
      state.startedInFlight.delete(itemId);
    }
  }

  async function ensureSpeakingArtifactSaved(item) {
    if (!item || !isSpeakingQuestion(item)) return;
    await stopSpeakingFlowForActiveItem({ preserveBlob: true });
    const runtime = getItemRuntime(item);
    const speaking = runtime.speaking || {};
    if (!speaking.localBlob || speaking.uploadedArtifactId) return;
    await uploadSpeakingArtifact(item);
    renderSpeakingPlayback(item);
  }

  async function renderActiveQuestion() {
    const item = getActiveItem();
    if (!item) return;
    persistCurrentDraft();
    await stopSpeakingFlowForActiveItem({ preserveBlob: true });

    state.activeItemId = clean(item.id);
    state.speaking.activeItemId = state.activeItemId;
    state.viewOpenedAtMs = nowMs();

    const question = item.question || {};
    const title = clean(question.title || item?.metadata?.questionTitle || ('Question ' + (state.index + 1)));
    const skill = clean(question.skill || item.skill || '');
    const questionType = clean(question.questionType || item.questionType || '');
    const status = clean(item.status || 'pending').toLowerCase() || 'pending';
    const isOpen = state.openedItemIds.has(state.activeItemId);
    const isRetakeRequired = isRetakeRequiredStatus(status);

    nodes.title.textContent = title || ('Question ' + (state.index + 1));
    nodes.skill.textContent = skill || '-';
    nodes.type.textContent = formatQuestionTypeLabel(questionType) || '-';
    nodes.statusBadge.textContent = status;
    nodes.statusBadge.className = 'badge ' + (isAnsweredStatus(status) ? 'bg-success' : (status === 'abandoned' ? 'bg-warning text-dark' : 'bg-secondary'));
    refreshQuestionNav();
    refreshProgress();
    nodes.seenTime.textContent = 'Seen: ' + Number(item.totalSeenSeconds || 0) + ' sec';

    if (!isOpen && !isRetakeRequired) {
      nodes.prompt.innerHTML = renderStartGate(
        'Start',
        'Click Start to reveal this question and begin answering.',
        'start'
      );
      nodes.response.innerHTML = '<div class="small text-muted">Question and response controls will appear after you start.</div>';
      if (nodes.saveBtn) nodes.saveBtn.disabled = true;
      updateRatingUI(item);
      setRatingLocked(true, 'Save your response first, then choose a difficulty rating.');
      return;
    }

    nodes.prompt.innerHTML = renderQuestionPrompt(item);

    if (!isOpen && isRetakeRequired) {
      nodes.response.innerHTML = renderStartGate(
        'Restart',
        'This question already has a saved response. Click Restart to retake it.',
        'restart'
      );
      if (nodes.saveBtn) nodes.saveBtn.disabled = true;
      updateRatingUI(item);
      setRatingLocked(false, '');
      return;
    }

    renderResponsePanel(item);
    if (nodes.saveBtn) nodes.saveBtn.disabled = false;
    updateRatingUI(item);
    setRatingLocked(!isRetakeRequiredStatus(clean(item.status || 'pending')), 'Save your response first, then choose a difficulty rating.');
  }

  function seenSecondsForCurrentView() {
    if (!state.viewOpenedAtMs) return 0;
    return Math.max(0, Math.floor((nowMs() - state.viewOpenedAtMs) / 1000));
  }

  async function saveResponseItem() {
    const item = getActiveItem();
    if (!item) return;
    const itemId = clean(item.id);
    if (!itemId || !state.openedItemIds.has(itemId)) {
      await showMessage('Start Required', 'Please click Start before saving this response.', 'info');
      return;
    }
    persistCurrentDraft();
    setButtonBusy(nodes.saveBtn, true, 'Saving...');
    try {
      await ensureSpeakingArtifactSaved(item);
      const summary = collectResponseSummary(item);
      const result = await postRuntime('/pte/practice/api/runtime/' + encodeURIComponent(clean(session.id)) + '/items/' + encodeURIComponent(clean(item.id)) + '/submit', {
        responseSummary: summary,
        seenSeconds: seenSecondsForCurrentView(),
        source: {
          module: 'pte_practice_runner_ui',
          eventType: 'question_submitted',
          eventId: 'PTE-PRACTICE-SUBMIT-' + clean(item.id) + '-' + Date.now()
        }
      });
      if (result.item) Object.assign(item, result.item);
      state.openedItemIds.delete(itemId);
      refreshQuestionNav();
      refreshProgress();
      await renderActiveQuestion();
      const opened = openRatingModal({ afterSave: true });
      if (!opened) {
        await showMessage('Saved', 'Response saved. You can now choose a difficulty rating.', 'success');
      }
    } catch (error) {
      await showMessage('Save Failed', error.message || 'Unable to save response.', 'error');
    } finally {
      setButtonBusy(nodes.saveBtn, false);
    }
  }

  async function rateCurrentItem(selectedRating = '') {
    const item = getActiveItem();
    if (!item) return;
    if (state.ratingInFlight) return;
    if (state.ratingLocked) return;
    const rating = clean(selectedRating).toLowerCase();
    if (!rating) {
      return;
    }
    const previousRating = clean(item.selfDifficultyRating || '').toLowerCase();
    const previousRatedAt = clean(item.selfDifficultyRatedAt || '');
    item.selfDifficultyRating = rating;
    updateRatingUI(item);
    if (nodes.ratingMeta) {
      nodes.ratingMeta.textContent = `Saving ${formatRatingLabel(rating)}...`;
    }
    state.ratingInFlight = true;
    setRatingButtonsBusy(true, rating);
    try {
      const result = await postRuntime('/pte/practice/api/runtime/' + encodeURIComponent(clean(session.id)) + '/items/' + encodeURIComponent(clean(item.id)) + '/rate', {
        rating,
        source: {
          module: 'pte_practice_runner_ui',
          eventType: 'difficulty_rated',
          eventId: 'PTE-PRACTICE-RATE-' + clean(item.id) + '-' + Date.now()
        }
      });
      if (result.item) Object.assign(item, result.item);
      updateRatingUI(item);
    } catch (error) {
      item.selfDifficultyRating = previousRating;
      item.selfDifficultyRatedAt = previousRatedAt;
      updateRatingUI(item);
      await showMessage('Rating Failed', error.message || 'Unable to save rating.', 'error');
    } finally {
      state.ratingInFlight = false;
      setRatingButtonsBusy(false, '');
    }
  }

  async function autoSkipCurrentItemIfNeeded(item, reason = 'navigate') {
    if (!item) return;
    const itemId = clean(item.id);
    if (!itemId) return;
    if (!state.openedItemIds.has(itemId)) return;
    if (!isSkippableStatus(item.status || 'pending')) {
      state.openedItemIds.delete(itemId);
      return;
    }

    try {
      const result = await postRuntime('/pte/practice/api/runtime/' + encodeURIComponent(clean(session.id)) + '/items/' + encodeURIComponent(itemId) + '/skip', {
        seenSeconds: seenSecondsForCurrentView(),
        source: {
          module: 'pte_practice_runner_ui',
          eventType: 'question_skipped',
          eventId: 'PTE-PRACTICE-SKIP-' + itemId + '-' + Date.now(),
          reason: clean(reason).toLowerCase() || 'navigate'
        }
      });
      if (result.item) Object.assign(item, result.item);
    } catch (_) {
      // Keep navigation resilient even if skip logging fails.
    } finally {
      state.openedItemIds.delete(itemId);
    }
  }

  async function goNextQuestion() {
    const item = getActiveItem();
    if (!item) return;
    persistCurrentDraft();
    await autoSkipCurrentItemIfNeeded(item, 'next');
    await stopSpeakingFlowForActiveItem({ preserveBlob: true });
    if (state.index < items.length - 1) {
      state.index += 1;
      await renderActiveQuestion();
      return;
    }
    await showMessage('End of Session', 'You reached the last question. You can finish the practice session now.', 'info');
  }

  async function goPreviousQuestion() {
    const item = getActiveItem();
    if (!item) return;
    persistCurrentDraft();
    await autoSkipCurrentItemIfNeeded(item, 'previous');
    await stopSpeakingFlowForActiveItem({ preserveBlob: true });
    if (state.index > 0) {
      state.index -= 1;
      await renderActiveQuestion();
      return;
    }
    await showMessage('Start of Session', 'You are already on the first question.', 'info');
  }

  async function finishSession(triggerBtn) {
    setButtonBusy(triggerBtn, true, 'Finishing...');
    try {
      persistCurrentDraft();
      await autoSkipCurrentItemIfNeeded(getActiveItem(), 'finish');
      await stopSpeakingFlowForActiveItem({ preserveBlob: true });
      const result = await postRuntime('/pte/practice/api/runtime/' + encodeURIComponent(clean(session.id)) + '/finish', {
        source: {
          module: 'pte_practice_runner_ui',
          eventType: 'attempt_finished',
          eventId: 'PTE-PRACTICE-FINISH-' + clean(session.id) + '-' + Date.now()
        }
      });
      const status = clean(result?.session?.status || '');
      await showMessage('Session Finished', 'Practice session is now ' + (status || 'finished') + '.', 'success');
      window.location.href = '/pte/practice/by-skills';
    } catch (error) {
      await showMessage('Finish Failed', error.message || 'Unable to finish session.', 'error');
    } finally {
      setButtonBusy(triggerBtn, false);
    }
  }

  nodes.response?.addEventListener('click', async (event) => {
    const target = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('button')
      : null;
    if (!target) return;
    if (target.id === 'ptePracticeStartBtn') {
      target.disabled = true;
      const mode = clean(target.getAttribute('data-start-mode')).toLowerCase();
      await startOrRestartCurrentQuestion(mode === 'restart');
      return;
    }
    const item = getActiveItem();
    if (!item || !isSpeakingQuestion(item)) return;
    if (target.id === 'pteSpeakStartBtn') {
      target.disabled = true;
      await runSpeakingFlow(item, { manual: true });
      return;
    }
    if (target.id === 'pteSpeakStopBtn') {
      target.disabled = true;
      await stopSpeakingFlowForActiveItem({ preserveBlob: true });
      return;
    }
  });

  nodes.prompt?.addEventListener('click', async (event) => {
    const target = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('button')
      : null;
    if (!target || target.id !== 'ptePracticeStartBtn') return;
    target.disabled = true;
    const mode = clean(target.getAttribute('data-start-mode')).toLowerCase();
    await startOrRestartCurrentQuestion(mode === 'restart');
  });

  nodes.response?.addEventListener('input', (event) => {
    const item = getActiveItem();
    if (!item) return;
    const runtime = getItemRuntime(item);
    if (event.target && event.target.matches('textarea[data-response-text]')) {
      if (isSpeakingQuestion(item)) runtime.speaking.transcript = String(event.target.value || '');
      else runtime.textDraft = String(event.target.value || '');
    }
    if (event.target && event.target.matches('textarea[data-response-map]')) {
      runtime.mapText = String(event.target.value || '');
    }
  });

  nodes.saveBtn?.addEventListener('click', () => saveResponseItem());
  nodes.openRatingBtn?.addEventListener('click', async () => {
    const opened = openRatingModal({ afterSave: false });
    if (!opened) {
      await showMessage('Self Difficulty Rating', 'Save your response first, then set your difficulty rating.', 'info');
    }
  });
  nodes.sidebarToggleBtn?.addEventListener('click', () => {
    applySidebarLayout(!state.sidebarCollapsed);
  });
  nodes.prevBtn?.addEventListener('click', () => goPreviousQuestion());
  nodes.nextBtn?.addEventListener('click', () => goNextQuestion());
  (Array.isArray(nodes.ratingButtons) ? nodes.ratingButtons : []).forEach((btn) => {
    btn.addEventListener('click', () => {
      const rating = clean(btn.getAttribute('data-difficulty-rating')).toLowerCase();
      rateCurrentItem(rating);
    });
  });
  nodes.finishTopBtn?.addEventListener('click', () => finishSession(nodes.finishTopBtn));
  nodes.finishBottomBtn?.addEventListener('click', () => finishSession(nodes.finishBottomBtn));
  window.addEventListener('beforeunload', () => {
    stopSpeakingFlowForActiveItem({ preserveBlob: false }).catch(() => {});
  });

  applySidebarLayout(readSidebarCollapsedPreference(), { persist: false });
  renderActiveQuestion().catch(() => {});
})();
