/**
 * Term-based official final grades: multi-step approval (teacher → dept admin → senior admin lock)
 * with full audit history.
 */

const PHASES = Object.freeze(['draft', 'pending_dept', 'pending_senior', 'locked']);

const ACTION_TYPES = Object.freeze([
  'teacher_draft',
  'teacher_finalize',
  'dept_approve',
  'senior_lock',
  'release_lock',
  'migrated_legacy'
]);

function cleanPersonKey(k) {
  const pid = String(k || '').trim().replace(/\0/g, '');
  if (!pid || pid.length > 80) return null;
  if (!/^[A-Za-z0-9:_-]+$/.test(pid)) return null;
  return pid;
}

function clampScore(n) {
  if (n === null || n === undefined || n === '') return null;
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(Math.min(100, Math.max(0, x)) * 100) / 100;
}

function sanitizeHistoryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = String(raw.action || '').trim().slice(0, 40);
  if (!ACTION_TYPES.includes(action)) return null;
  const at = String(raw.at || '').trim().slice(0, 40);
  const userId = String(raw.userId || '').trim().slice(0, 80);
  const displayName = String(raw.displayName || '').trim().slice(0, 160);
  const phaseAfter = String(raw.phaseAfter || '').trim().slice(0, 32);
  const reason = String(raw.reason || '').trim().slice(0, 2000);
  const score = raw.score === undefined || raw.score === null || raw.score === '' ? null : clampScore(raw.score);
  return {
    at: at || new Date().toISOString(),
    userId,
    displayName,
    action,
    phaseAfter: PHASES.includes(phaseAfter) ? phaseAfter : 'draft',
    score,
    reason: reason || undefined
  };
}

function sanitizeHistory(arr, options) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    const e = sanitizeHistoryEntry(row);
    if (e) out.push(e);
  }
  return out.slice(-(options?.maxEntries || 400));
}

function normalizeRecord(v) {
  if (v === null || v === undefined) {
    return { score: null, phase: 'draft', history: [] };
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return {
      score: clampScore(v),
      phase: 'draft',
      history: [
        {
          at: new Date().toISOString(),
          userId: '',
          displayName: 'System',
          action: 'migrated_legacy',
          phaseAfter: 'draft',
          score: clampScore(v)
        }
      ]
    };
  }
  if (typeof v !== 'object' || Array.isArray(v)) {
    return { score: null, phase: 'draft', history: [] };
  }
  const phase = PHASES.includes(String(v.phase)) ? String(v.phase) : 'draft';
  return {
    score: clampScore(v.score),
    phase,
    history: sanitizeHistory(v.history)
  };
}

/**
 * Migrate legacy flat numbers to workflow records.
 */
function normalizeOfficialFinalGradesMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    const pid = cleanPersonKey(k);
    if (!pid) continue;
    out[pid] = normalizeRecord(v);
  }
  return out;
}

function sanitizeOfficialFinalGradesMap(map) {
  return normalizeOfficialFinalGradesMap(map);
}

function buildEntry(actor, action, phaseAfter, { score = null, reason = '' } = {}) {
  return {
    at: new Date().toISOString(),
    userId: String(actor.userId || '').trim().slice(0, 80),
    displayName: String(actor.displayName || 'User').trim().slice(0, 160),
    action,
    phaseAfter,
    score: score === undefined ? null : clampScore(score),
    reason: reason ? String(reason).trim().slice(0, 2000) : undefined
  };
}

function applyWorkflowAction(gradesMap, input) {
  const map = normalizeOfficialFinalGradesMap(gradesMap);
  const personId = cleanPersonKey(input.personId);
  if (!personId) throw new Error('personId is required.');
  const action = String(input.action || '').trim();
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : { userId: '', displayName: '' };
  const current = map[personId] || normalizeRecord(null);

  if (action === 'teacher_draft') {
    if (current.phase !== 'draft') {
      throw new Error('You can only edit the official % while the grade is in draft (e.g. after a lock is released).');
    }
    const score = clampScore(input.score);
    const next = {
      ...current,
      score,
      history: [...current.history, buildEntry(actor, 'teacher_draft', 'draft', { score })]
    };
    map[personId] = next;
    return map;
  }

  if (action === 'teacher_finalize') {
    if (current.phase !== 'draft') {
      throw new Error('Submit for approval is only available in draft status.');
    }
    const score = clampScore(input.score);
    if (score === null || score === undefined) {
      throw new Error('A finalized score is required before submitting for approval.');
    }
    map[personId] = {
      score,
      phase: 'pending_dept',
      history: [...current.history, buildEntry(actor, 'teacher_finalize', 'pending_dept', { score })]
    };
    return map;
  }

  if (action === 'dept_approve') {
    if (current.phase !== 'pending_dept') {
      throw new Error('Department approval is only available while waiting on department review.');
    }
    map[personId] = {
      ...current,
      phase: 'pending_senior',
      history: [...current.history, buildEntry(actor, 'dept_approve', 'pending_senior', { score: current.score })]
    };
    return map;
  }

  if (action === 'senior_lock') {
    if (current.phase !== 'pending_senior') {
      throw new Error('Final lock is only available after department approval.');
    }
    map[personId] = {
      ...current,
      phase: 'locked',
      history: [...current.history, buildEntry(actor, 'senior_lock', 'locked', { score: current.score })]
    };
    return map;
  }

  if (action === 'release_lock') {
    if (current.phase !== 'locked') {
      throw new Error('Release is only available when the grade is locked.');
    }
    const reason = String(input.reason || '').trim();
    if (reason.length < 3) {
      throw new Error('A reason is required to release a lock (at least 3 characters).');
    }
    map[personId] = {
      ...current,
      phase: 'draft',
      history: [...current.history, buildEntry(actor, 'release_lock', 'draft', { score: current.score, reason })]
    };
    return map;
  }

  throw new Error('Invalid workflow action.');
}

module.exports = {
  PHASES,
  ACTION_TYPES,
  normalizeOfficialFinalGradesMap,
  sanitizeOfficialFinalGradesMap,
  applyWorkflowAction,
  normalizeRecord,
  clampScore
};
