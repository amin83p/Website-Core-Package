(function (root, factory) {
  const Core = factory(root.LogArchiveStagingCore || {});
  if (typeof module === 'object' && module.exports) {
    module.exports = Core;
  } else {
    root.LogArchiveStaging = Core;
  }
}(typeof self !== 'undefined' ? self : this, function (StagingCore) {
  'use strict';

  const STAGING_DB = 'logArchiveStaging';
  const STAGING_DB_VERSION = 1;
  const STAGING_STORE = 'files';
  const OPFS_ROOT = 'sessions';
  const MIRROR_DIR_NAME = '.log-archive-analyzer-staging';

  const {
    DEFAULT_CHUNK_MAX_LINES,
    createBoundsTracker,
    createNdjsonChunkWriter,
    logChunkFileName,
    actionStateChunkFileName,
    parseNdjsonText,
    paginateArray
  } = StagingCore;

  let mirrorDirHandle = null;

  function supportsOpfs() {
    return typeof navigator !== 'undefined'
      && navigator.storage
      && typeof navigator.storage.getDirectory === 'function';
  }

  function openStagingDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(STAGING_DB, STAGING_DB_VERSION);
      req.onerror = () => reject(req.error || new Error('Staging DB open failed'));
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STAGING_STORE)) {
          db.createObjectStore(STAGING_STORE, { keyPath: 'path' });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  async function idbPutFile(path, blob) {
    const db = await openStagingDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STAGING_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STAGING_STORE).put({ path, blob, updatedAt: Date.now() });
    });
    db.close();
  }

  async function idbGetFile(path) {
    const db = await openStagingDb();
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction(STAGING_STORE, 'readonly');
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(STAGING_STORE).get(path);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return row?.blob || null;
  }

  async function idbDeletePrefix(prefix) {
    const db = await openStagingDb();
    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction(STAGING_STORE, 'readonly');
      const store = tx.objectStore(STAGING_STORE);
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const toDelete = keys.filter((k) => String(k).startsWith(`${prefix}/`));
    if (toDelete.length) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STAGING_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const store = tx.objectStore(STAGING_STORE);
        toDelete.forEach((k) => store.delete(k));
      });
    }
    db.close();
  }

  async function getOpfsSessionDir(sessionId, create) {
    if (!supportsOpfs()) return null;
    const root = await navigator.storage.getDirectory();
    const sessions = await root.getDirectoryHandle(OPFS_ROOT, { create: true });
    return sessions.getDirectoryHandle(String(sessionId), { create: Boolean(create) });
  }

  async function resolveOpfsFileHandle(sessionDir, filePath, create) {
    const parts = String(filePath || '').split('/').filter(Boolean);
    if (!parts.length) throw new Error('Invalid staging file path');
    let dir = sessionDir;
    for (let i = 0; i < parts.length - 1; i += 1) {
      dir = await dir.getDirectoryHandle(parts[i], { create: Boolean(create) });
    }
    return dir.getFileHandle(parts[parts.length - 1], { create: Boolean(create) });
  }

  async function writeSessionFile(sessionId, fileName, text, backend) {
    const path = `${sessionId}/${fileName}`;
    const blob = new Blob([text], { type: 'application/x-ndjson' });
    if (backend === 'opfs') {
      const dir = await getOpfsSessionDir(sessionId, true);
      if (dir) {
        const fh = await resolveOpfsFileHandle(dir, fileName, true);
        const writable = await fh.createWritable();
        await writable.write(text);
        await writable.close();
        return;
      }
    }
    await idbPutFile(path, blob);
  }

  async function readSessionFile(sessionId, fileName, backend) {
    if (backend === 'opfs') {
      try {
        const dir = await getOpfsSessionDir(sessionId, false);
        if (dir) {
          const fh = await resolveOpfsFileHandle(dir, fileName, false);
          const file = await fh.getFile();
          return file.text();
        }
      } catch (_) { /* fall through */ }
    }
    const blob = await idbGetFile(`${sessionId}/${fileName}`);
    if (!blob) return '';
    return blob.text();
  }

  async function clearOpfsSession(sessionId) {
    if (!supportsOpfs()) return;
    try {
      const root = await navigator.storage.getDirectory();
      const sessions = await root.getDirectoryHandle(OPFS_ROOT, { create: false });
      await sessions.removeEntry(String(sessionId), { recursive: true });
    } catch (_) { /* ignore */ }
  }

  function createStagingWriter(sessionId, options) {
    const timezone = String(options?.timezone || 'UTC');
    const requestedStart = String(options?.requestedStartDate || '');
    const requestedEnd = String(options?.requestedEndDate || '');
    const backend = supportsOpfs() ? 'opfs' : 'idb';
    const logBounds = createBoundsTracker();
    const logWriter = createNdjsonChunkWriter({
      maxLines: Number(options?.chunkMaxLines) || DEFAULT_CHUNK_MAX_LINES,
      fileNameAtIndex: logChunkFileName
    });
    const asWriter = createNdjsonChunkWriter({
      maxLines: Number(options?.chunkMaxLines) || DEFAULT_CHUNK_MAX_LINES,
      fileNameAtIndex: actionStateChunkFileName
    });
    const logChunkFiles = [];
    const actionStateChunkFiles = [];
    let actionStateCount = 0;

    async function flushParts(parts, bucket) {
      for (const part of parts) {
        await writeSessionFile(sessionId, part.fileName, part.text, backend);
        bucket.push(part.fileName);
      }
    }

    return {
      backend,
      async appendLogs(logs) {
        const rows = Array.isArray(logs) ? logs : [];
        rows.forEach((row) => logBounds.add(row));
        const flushed = logWriter.appendRows(rows);
        await flushParts(flushed, logChunkFiles);
      },
      async appendActionStates(rows) {
        const list = Array.isArray(rows) ? rows : [];
        actionStateCount += list.length;
        const flushed = asWriter.appendRows(list);
        await flushParts(flushed, actionStateChunkFiles);
      },
      async finalize(manifestBase, refs) {
        const tailLogs = logWriter.finish();
        await flushParts(tailLogs.flushed, logChunkFiles);
        const tailAs = asWriter.finish();
        await flushParts(tailAs.flushed, actionStateChunkFiles);

        const bounds = logBounds.snapshot(timezone, requestedStart, requestedEnd);
        const manifest = {
          ...(manifestBase || {}),
          schemaVersion: 2,
          staging: true,
          storageBackend: backend,
          reportRange: {
            startDate: bounds.effectiveStartDate,
            endDate: bounds.effectiveEndDate
          },
          requestedReportRange: {
            startDate: requestedStart,
            endDate: requestedEnd
          },
          counts: {
            logs: bounds.count,
            actionStates: actionStateCount
          },
          chunks: {
            logs: logChunkFiles.slice(),
            actionStates: actionStateChunkFiles.slice()
          }
        };

        await writeSessionFile(sessionId, 'manifest.json', JSON.stringify(manifest, null, 2), backend);
        if (refs) {
          await writeSessionFile(sessionId, 'reference/sections.json', JSON.stringify(refs.sections || []), backend);
          await writeSessionFile(sessionId, 'reference/operations.json', JSON.stringify(refs.operations || []), backend);
        }

        return { manifest, logChunkFiles: logChunkFiles.slice(), actionStateChunkFiles: actionStateChunkFiles.slice() };
      }
    };
  }

  async function readManifest(sessionId, backendHint) {
    const text = await readSessionFile(sessionId, 'manifest.json', backendHint || 'opfs');
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function resolveLogUserId(row) {
    const details = row?.details && typeof row.details === 'object' ? row.details : {};
    const actor = details.actor && typeof details.actor === 'object' ? details.actor : {};
    return String(row?.userId || actor.userId || '').trim();
  }

  function resolveLogTimestampMs(row) {
    const ms = new Date(String(row?.timestamp || row?.createdAt || '')).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  function resolveActionStateTimestampMs(row) {
    const ms = new Date(String(row?.startedAt || row?.createdAt || row?.updatedAt || '')).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  function resolveActionStateUserId(row) {
    return String(row?.userId || row?.context?.userId || '').trim();
  }

  async function* iterateStagedLogs(sessionId, backendHint) {
    const manifest = await readManifest(sessionId, backendHint);
    if (!manifest) return;
    const backend = backendHint || manifest.storageBackend || 'idb';
    const files = manifest.chunks?.logs || [];
    for (const fileName of files) {
      const text = await readSessionFile(sessionId, fileName, backend);
      const parsed = parseNdjsonText(text);
      for (let i = 0; i < parsed.length; i += 1) {
        yield parsed[i];
      }
    }
  }

  function resolveLogUserLabel(row, userId) {
    const details = row?.details && typeof row.details === 'object' ? row.details : {};
    const actor = details.actor && typeof details.actor === 'object' ? details.actor : {};
    const label = String(
      actor.displayName
      || actor.name
      || actor.username
      || row?.username
      || row?.displayName
      || userId
      || ''
    ).trim();
    return label.length > 180 ? label.slice(0, 180) : label;
  }

  async function collectArchiveUsers(sessionId, backendHint, allowedUserIds) {
    const allowed = allowedUserIds instanceof Set
      ? allowedUserIds
      : (Array.isArray(allowedUserIds) && allowedUserIds.length
        ? new Set(allowedUserIds.map((id) => String(id).trim()).filter(Boolean))
        : null);
    const byId = new Map();
    // eslint-disable-next-line no-restricted-syntax
    for await (const row of iterateStagedLogs(sessionId, backendHint)) {
      const uid = resolveLogUserId(row);
      if (!uid) continue;
      if (allowed && !allowed.has(uid)) continue;
      if (!byId.has(uid)) {
        byId.set(uid, resolveLogUserLabel(row, uid));
      }
    }
    return Array.from(byId.entries())
      .map(([id, label]) => ({ id, label: label || id }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }

  async function collectArchiveUserIds(sessionId, backendHint, allowedUserIds) {
    const users = await collectArchiveUsers(sessionId, backendHint, allowedUserIds);
    return users.map((u) => u.id);
  }

  function resolveLogSectionId(row) {
    return String(row?.sectionId || '').trim();
  }

  function resolveLogOperationId(row) {
    return String(row?.operationId || '').trim();
  }

  async function collectArchiveSectionOperationsForUser({
    sessionId,
    backend: backendHint,
    userId,
    startMs,
    endMs,
    allowedUserIds
  }) {
    const uid = String(userId || '').trim();
    const start = Number(startMs);
    const end = Number(endMs);
    if (!sessionId || !uid || !Number.isFinite(start) || !Number.isFinite(end)) {
      return { sections: [], operationsBySection: {} };
    }
    const allowed = allowedUserIds instanceof Set
      ? allowedUserIds
      : (Array.isArray(allowedUserIds) && allowedUserIds.length
        ? new Set(allowedUserIds.map((id) => String(id).trim()).filter(Boolean))
        : null);
    const sectionSet = new Set();
    const operationsBySection = new Map();
    // eslint-disable-next-line no-restricted-syntax
    for await (const row of iterateStagedLogs(sessionId, backendHint)) {
      const rowUser = resolveLogUserId(row);
      if (rowUser !== uid) continue;
      if (allowed && !allowed.has(rowUser)) continue;
      const ms = resolveLogTimestampMs(row);
      if (ms < start || ms > end) continue;
      const sectionId = resolveLogSectionId(row);
      if (!sectionId) continue;
      sectionSet.add(sectionId);
      const operationId = resolveLogOperationId(row);
      if (!operationsBySection.has(sectionId)) {
        operationsBySection.set(sectionId, new Set());
      }
      if (operationId) {
        operationsBySection.get(sectionId).add(operationId);
      }
    }
    const sections = Array.from(sectionSet)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ id }));
    const operationsBySectionObj = {};
    operationsBySection.forEach((opSet, sectionId) => {
      operationsBySectionObj[sectionId] = Array.from(opSet)
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ id }));
    });
    return { sections, operationsBySection: operationsBySectionObj };
  }

  async function loadStagedRecordsForUserWindow({
    sessionId,
    backend,
    userId,
    startMs,
    endMs,
    allowedUserIds
  }) {
    const uid = String(userId || '').trim();
    const start = Number(startMs);
    const end = Number(endMs);
    if (!sessionId || !uid || !Number.isFinite(start) || !Number.isFinite(end)) {
      return { logs: [], actionStates: [] };
    }
    const allowed = allowedUserIds instanceof Set
      ? allowedUserIds
      : (Array.isArray(allowedUserIds) && allowedUserIds.length
        ? new Set(allowedUserIds.map((id) => String(id).trim()).filter(Boolean))
        : null);
    const logs = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const row of iterateStagedLogs(sessionId, backend)) {
      const rowUser = resolveLogUserId(row);
      if (rowUser !== uid) continue;
      if (allowed && !allowed.has(rowUser)) continue;
      const ms = resolveLogTimestampMs(row);
      if (ms < start || ms > end) continue;
      logs.push(row);
    }
    const actionStates = [];
    const allStates = await readAllActionStates(sessionId, backend);
    allStates.forEach((row) => {
      const rowUser = resolveActionStateUserId(row);
      if (rowUser && rowUser !== uid) return;
      if (allowed && rowUser && !allowed.has(rowUser)) return;
      const ms = resolveActionStateTimestampMs(row);
      if (ms < start || ms > end) return;
      actionStates.push(row);
    });
    return { logs, actionStates };
  }

  async function readAllLogs(sessionId, backendHint) {
    const manifest = await readManifest(sessionId, backendHint);
    if (!manifest) return [];
    const backend = backendHint || manifest.storageBackend || 'idb';
    const files = manifest.chunks?.logs || [];
    const logs = [];
    for (const fileName of files) {
      const text = await readSessionFile(sessionId, fileName, backend);
      parseNdjsonText(text).forEach((row) => logs.push(row));
    }
    return logs;
  }

  async function readAllActionStates(sessionId, backendHint) {
    const manifest = await readManifest(sessionId, backendHint);
    if (!manifest) return [];
    const backend = backendHint || manifest.storageBackend || 'idb';
    const files = manifest.chunks?.actionStates || [];
    const rows = [];
    for (const fileName of files) {
      const text = await readSessionFile(sessionId, fileName, backend);
      parseNdjsonText(text).forEach((row) => rows.push(row));
    }
    return rows;
  }

  async function readLogsPage(sessionId, { offset = 0, limit = 50, backendHint } = {}) {
    const manifest = await readManifest(sessionId, backendHint);
    if (!manifest) return { rows: [], total: 0 };
    const backend = backendHint || manifest.storageBackend || 'idb';
    const files = manifest.chunks?.logs || [];
    const total = Number(manifest.counts?.logs) || 0;
    const off = Math.max(0, Number(offset) || 0);
    const lim = Math.max(0, Number(limit) || 0);
    if (!lim) return { rows: [], total };

    let skipped = 0;
    const rows = [];
    for (const fileName of files) {
      const text = await readSessionFile(sessionId, fileName, backend);
      const parsed = parseNdjsonText(text);
      for (let i = 0; i < parsed.length; i += 1) {
        if (skipped < off) {
          skipped += 1;
          continue;
        }
        rows.push(parsed[i]);
        if (rows.length >= lim) return { rows, total };
      }
    }
    return { rows, total: total || skipped + rows.length };
  }

  async function loadRefs(sessionId, backendHint) {
    const manifest = await readManifest(sessionId, backendHint);
    const backend = backendHint || manifest?.storageBackend || 'idb';
    const sectionsText = await readSessionFile(sessionId, 'reference/sections.json', backend);
    const operationsText = await readSessionFile(sessionId, 'reference/operations.json', backend);
    let sections = [];
    let operations = [];
    try { sections = JSON.parse(sectionsText || '[]'); } catch (_) { /* ignore */ }
    try { operations = JSON.parse(operationsText || '[]'); } catch (_) { /* ignore */ }
    return { sections, operations };
  }

  async function clearSessionStaging(sessionId) {
    if (!sessionId) return;
    await idbDeletePrefix(String(sessionId));
    await clearOpfsSession(sessionId);
  }

  async function listOpfsSessionIds() {
    if (!supportsOpfs()) return [];
    try {
      const root = await navigator.storage.getDirectory();
      const sessions = await root.getDirectoryHandle(OPFS_ROOT, { create: false });
      const ids = [];
      // eslint-disable-next-line no-restricted-syntax
      for await (const [name, handle] of sessions.entries()) {
        if (handle.kind === 'directory') ids.push(String(name));
      }
      return ids;
    } catch (_) {
      return [];
    }
  }

  async function idbStagingFootprint() {
    const db = await openStagingDb();
    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction(STAGING_STORE, 'readonly');
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(STAGING_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const sessionIds = new Set();
    (keys || []).forEach((key) => {
      const first = String(key).split('/')[0];
      if (first) sessionIds.add(first);
    });
    return {
      fileCount: keys.length,
      sessionIds: Array.from(sessionIds)
    };
  }

  async function scanStagingFootprint() {
    const [opfsSessionIds, idbFootprint] = await Promise.all([
      listOpfsSessionIds(),
      idbStagingFootprint()
    ]);
    const sessionIds = new Set(opfsSessionIds);
    idbFootprint.sessionIds.forEach((id) => sessionIds.add(id));
    return {
      opfsSessionIds,
      idbSessionIds: idbFootprint.sessionIds,
      idbFileCount: idbFootprint.fileCount,
      sessionIds: Array.from(sessionIds)
    };
  }

  async function idbClearEntireStore() {
    const db = await openStagingDb();
    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction(STAGING_STORE, 'readonly');
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(STAGING_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    if (keys.length) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STAGING_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const store = tx.objectStore(STAGING_STORE);
        keys.forEach((k) => store.delete(k));
      });
    }
    db.close();
  }

  async function clearAllStagingData() {
    const opfsIds = await listOpfsSessionIds();
    await Promise.all(opfsIds.map((id) => clearOpfsSession(id)));
    await idbClearEntireStore();
    clearMirrorDirectoryHandle();
  }

  async function pickMirrorDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') {
      throw new Error('Writable folder pick is not supported in this browser.');
    }
    mirrorDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    return mirrorDirHandle;
  }

  function getMirrorDirectoryHandle() {
    return mirrorDirHandle;
  }

  function clearMirrorDirectoryHandle() {
    mirrorDirHandle = null;
  }

  async function mirrorSessionToDirectory(sessionId, dirHandle) {
    const handle = dirHandle || mirrorDirHandle;
    if (!handle || !sessionId) return false;
    const manifest = await readManifest(sessionId);
    if (!manifest) return false;
    const backend = manifest.storageBackend || 'idb';
    const sessionDir = await handle.getDirectoryHandle(MIRROR_DIR_NAME, { create: true });
    const target = await sessionDir.getDirectoryHandle(String(sessionId), { create: true });
    const files = ['manifest.json']
      .concat(manifest.chunks?.logs || [])
      .concat(manifest.chunks?.actionStates || [])
      .concat(['reference/sections.json', 'reference/operations.json']);

    for (const filePath of files) {
      const text = await readSessionFile(sessionId, filePath, backend);
      if (!text && filePath !== 'manifest.json') continue;
      const parts = filePath.split('/');
      let dir = target;
      for (let i = 0; i < parts.length - 1; i += 1) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }
      const name = parts[parts.length - 1];
      const fh = await dir.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(text || '');
      await writable.close();
    }
    return true;
  }

  async function removeMirrorSessionFolder(sessionId) {
    if (!mirrorDirHandle || !sessionId) return;
    try {
      const sessionDir = await mirrorDirHandle.getDirectoryHandle(MIRROR_DIR_NAME, { create: false });
      await sessionDir.removeEntry(String(sessionId), { recursive: true });
    } catch (_) { /* ignore */ }
  }

  return {
    supportsOpfs,
    supportsWritableDirectoryPicker: () => typeof window.showDirectoryPicker === 'function',
    createStagingWriter,
    readManifest,
    iterateStagedLogs,
    collectArchiveUsers,
    collectArchiveUserIds,
    collectArchiveSectionOperationsForUser,
    loadStagedRecordsForUserWindow,
    readAllLogs,
    readAllActionStates,
    readLogsPage,
    loadRefs,
    clearSessionStaging,
    scanStagingFootprint,
    clearAllStagingData,
    pickMirrorDirectory,
    getMirrorDirectoryHandle,
    clearMirrorDirectoryHandle,
    mirrorSessionToDirectory,
    removeMirrorSessionFolder,
    DEFAULT_CHUNK_MAX_LINES
  };
}));
