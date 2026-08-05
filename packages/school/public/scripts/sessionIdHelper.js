(function attachSessionIdHelper(global) {
  const DEFAULT_SEQUENCE_WIDTH = 4;
  const SESSION_ID_PREFIX = 'SES-';
  const SESSION_ID_PATTERN = /^SES-(.+)-(\d{4,})$/;

  function parseSessionId(sessionId) {
    const token = String(sessionId || '').trim();
    const match = token.match(SESSION_ID_PATTERN);
    if (!match) return null;
    const sequence = Number(match[2]);
    if (!Number.isFinite(sequence) || sequence < 1) return null;
    return { classId: match[1], sequence };
  }

  function collectUsedSequences(classId, sessions) {
    const classToken = String(classId || '').trim();
    const used = new Set();
    (Array.isArray(sessions) ? sessions : []).forEach((row) => {
      const sessionId = String(row?.sessionId || row?.id || '').trim();
      const parsed = parseSessionId(sessionId);
      if (!parsed || parsed.classId !== classToken) return;
      used.add(parsed.sequence);
    });
    return used;
  }

  function buildSessionId(classId, sequence) {
    const classToken = String(classId || '').trim();
    if (!classToken) throw new Error('classId is required to build a session id.');
    const seq = Number(sequence);
    if (!Number.isFinite(seq) || seq < 1) throw new Error('Session sequence must be a positive integer.');
    const width = Math.max(DEFAULT_SEQUENCE_WIDTH, String(Math.floor(seq)).length);
    return `${SESSION_ID_PREFIX}${classToken}-${String(Math.floor(seq)).padStart(width, '0')}`;
  }

  function buildNextSessionId(classId, existingSessions) {
    const classToken = String(classId || '').trim();
    if (!classToken) {
      return `${SESSION_ID_PREFIX}NEW-${String(Date.now()).slice(-8)}`;
    }
    const usedSequences = collectUsedSequences(classToken, existingSessions);
    const usedIds = new Set(
      (Array.isArray(existingSessions) ? existingSessions : [])
        .map((row) => String(row?.sessionId || row?.id || '').trim())
        .filter(Boolean)
    );
    let sequence = 0;
    for (let guard = 0; guard < 100000; guard += 1) {
      sequence += 1;
      const candidate = buildSessionId(classToken, sequence);
      if (!usedSequences.has(sequence) && !usedIds.has(candidate)) return candidate;
    }
    throw new Error('Unable to allocate a unique session id.');
  }

  global.SchoolSessionIdHelper = {
    SESSION_ID_PREFIX,
    buildSessionId,
    buildNextSessionId,
    parseSessionId
  };
})(typeof window !== 'undefined' ? window : globalThis);
