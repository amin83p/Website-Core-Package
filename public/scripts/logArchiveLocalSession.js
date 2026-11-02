(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LogArchiveLocalSession = api;
  }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const DB_NAME = 'logArchiveLocalSession';
  const DB_VERSION = 1;
  const STORE = 'sessions';
  const ACTIVE_KEY = 'logArchiveLocalSessionId';

  function createSessionId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `las-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  function getActiveSessionId() {
    try {
      const fromLocal = String(localStorage.getItem(ACTIVE_KEY) || '').trim();
      if (fromLocal) return fromLocal;
      const fromSession = String(sessionStorage.getItem(ACTIVE_KEY) || '').trim();
      if (fromSession) {
        localStorage.setItem(ACTIVE_KEY, fromSession);
        return fromSession;
      }
    } catch (_) {
      // ignore
    }
    return '';
  }

  function setActiveSessionId(id) {
    try {
      if (id) {
        const value = String(id);
        localStorage.setItem(ACTIVE_KEY, value);
        sessionStorage.setItem(ACTIVE_KEY, value);
      } else {
        localStorage.removeItem(ACTIVE_KEY);
        sessionStorage.removeItem(ACTIVE_KEY);
      }
    } catch (_) {
      // ignore
    }
  }

  async function saveSession(record) {
    const id = String(record?.id || createSessionId());
    const staging = Boolean(record?.staging);
    const payload = {
      id,
      savedAt: new Date().toISOString(),
      staging,
      storageBackend: String(record?.storageBackend || ''),
      logs: staging ? [] : (record.logs || []),
      actionStates: staging ? [] : (record.actionStates || []),
      refs: record.refs || { sections: [], operations: [] },
      manifest: record.manifest || {},
      reportSetup: record.reportSetup || {},
      meta: record.meta || {}
    };
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to save session.'));
      tx.objectStore(STORE).put(payload);
    });
    db.close();
    setActiveSessionId(id);
    return id;
  }

  async function loadLatestSession() {
    const db = await openDb();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      tx.onerror = () => reject(tx.error || new Error('Failed to list sessions.'));
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error('Failed to list sessions.'));
    });
    db.close();
    if (!rows.length) return null;
    rows.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
    return rows[0] || null;
  }

  async function loadSession(id) {
    let sessionId = String(id || getActiveSessionId() || '').trim();
    if (!sessionId && !id) {
      const latest = await loadLatestSession();
      if (latest?.id) {
        sessionId = String(latest.id);
        setActiveSessionId(sessionId);
      }
    }
    if (!sessionId) return null;
    const db = await openDb();
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      tx.onerror = () => reject(tx.error || new Error('Failed to load session.'));
      const req = tx.objectStore(STORE).get(sessionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Failed to load session.'));
    });
    db.close();
    return row;
  }

  async function hydrateSessionFromStaging(session) {
    if (!session || !session.staging) return session;
    const Staging = root.LogArchiveStaging;
    if (!Staging || typeof Staging.readAllLogs !== 'function') {
      return session;
    }
    const backend = session.storageBackend || session.manifest?.storageBackend;
    const [logs, actionStates, refs] = await Promise.all([
      Staging.readAllLogs(session.id, backend),
      Staging.readAllActionStates(session.id, backend),
      Staging.loadRefs(session.id, backend)
    ]);
    return {
      ...session,
      logs,
      actionStates,
      refs: {
        sections: refs?.sections?.length ? refs.sections : (session.refs?.sections || []),
        operations: refs?.operations?.length ? refs.operations : (session.refs?.operations || [])
      }
    };
  }

  async function loadSessionWithData(id) {
    const session = await loadSession(id);
    if (!session) return null;
    return hydrateSessionFromStaging(session);
  }

  async function listAllSessions() {
    const db = await openDb();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      tx.onerror = () => reject(tx.error || new Error('Failed to list sessions.'));
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error('Failed to list sessions.'));
    });
    db.close();
    return rows;
  }

  async function clearAllSessions() {
    const rows = await listAllSessions();
    const Staging = root.LogArchiveStaging;
    if (Staging && typeof Staging.clearSessionStaging === 'function') {
      await Promise.all(rows.map((row) => Staging.clearSessionStaging(row.id)));
    }
    if (Staging && typeof Staging.clearAllStagingData === 'function') {
      await Staging.clearAllStagingData();
    }
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to clear sessions.'));
      const store = tx.objectStore(STORE);
      rows.forEach((row) => {
        if (row?.id) store.delete(row.id);
      });
    });
    db.close();
    setActiveSessionId('');
  }

  async function clearSession(id) {
    const sessionId = String(id || getActiveSessionId() || '').trim();
    if (sessionId) {
      const Staging = root.LogArchiveStaging;
      if (Staging && typeof Staging.clearSessionStaging === 'function') {
        await Staging.clearSessionStaging(sessionId);
      }
      if (Staging && typeof Staging.removeMirrorSessionFolder === 'function') {
        await Staging.removeMirrorSessionFolder(sessionId);
      }
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Failed to clear session.'));
        tx.objectStore(STORE).delete(sessionId);
      });
      db.close();
    }
    setActiveSessionId('');
  }

  return {
    saveSession,
    loadSession,
    loadLatestSession,
    listAllSessions,
    loadSessionWithData,
    hydrateSessionFromStaging,
    clearSession,
    clearAllSessions,
    getActiveSessionId,
    setActiveSessionId,
    createSessionId
  };
}));
