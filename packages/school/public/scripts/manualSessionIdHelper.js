(function initManualSessionIdHelper(global) {
  const root = global || (typeof window !== 'undefined' ? window : globalThis);
  if (!root) return;

  const MANUAL_SESSION_PATTERN = /^MAN-(.+)-(\d{4,})$/;

  function normalizeScopeId(scopeId) {
    return String(scopeId || '').trim();
  }

  function parseManualSessionId(sessionId) {
    const token = normalizeScopeId(sessionId);
    const match = token.match(MANUAL_SESSION_PATTERN);
    if (!match) return null;
    const sequence = Number(match[2]);
    if (!Number.isFinite(sequence) || sequence < 1) return null;
    return { scopeId: match[1], sequence };
  }

  function buildManualSessionId(scopeId, sequence) {
    const scopeToken = normalizeScopeId(scopeId);
    if (!scopeToken) throw new Error('scopeId is required.');
    const seq = Number(sequence);
    const width = Math.max(4, String(Math.floor(seq)).length);
    return `MAN-${scopeToken}-${String(Math.floor(seq)).padStart(width, '0')}`;
  }

  function buildNextManualSessionId(scopeId, existingEntries) {
    const scopeToken = normalizeScopeId(scopeId);
    if (!scopeToken) return `MAN-NEW-${Date.now()}`;
    const usedSequences = new Set();
    const usedIds = new Set();
    (Array.isArray(existingEntries) ? existingEntries : []).forEach((row) => {
      const sessionId = String(row?.sessionId || row?.materializedSessionId || '').trim();
      if (!sessionId) return;
      usedIds.add(sessionId);
      const parsed = parseManualSessionId(sessionId);
      if (parsed && parsed.scopeId === scopeToken) usedSequences.add(parsed.sequence);
    });
    let sequence = 0;
    for (let guard = 0; guard < 100000; guard += 1) {
      sequence += 1;
      const candidate = buildManualSessionId(scopeToken, sequence);
      if (!usedSequences.has(sequence) && !usedIds.has(candidate)) return candidate;
    }
    return `MAN-${scopeToken}-${Date.now()}`;
  }

  root.SchoolManualSessionIdHelper = {
    buildManualSessionId,
    buildNextManualSessionId,
    parseManualSessionId
  };
})(typeof window !== 'undefined' ? window : globalThis);
