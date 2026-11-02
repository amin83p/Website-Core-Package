(function (root, factory) {
  const api = factory(root.LogArchiveAnalyzerRange || {});
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LogArchiveStagingCore = api;
  }
}(typeof self !== 'undefined' ? self : this, function (Range) {
  'use strict';

  const DEFAULT_CHUNK_MAX_LINES = 5000;
  const msToArchiveDateKey = Range.msToArchiveDateKey || (() => '');

  function cleanText(value, max) {
    const text = String(value == null ? '' : value).trim();
    const cap = Number(max) > 0 ? Number(max) : 500;
    return text.length > cap ? text.slice(0, cap) : text;
  }

  function resolveLogTimestampMs(row) {
    const ms = new Date(String(row?.timestamp || row?.createdAt || '')).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  function createBoundsTracker() {
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = Number.NEGATIVE_INFINITY;
    let count = 0;
    return {
      add(row) {
        count += 1;
        const ms = resolveLogTimestampMs(row);
        if (Number.isFinite(ms) && ms > 0) {
          minMs = Math.min(minMs, ms);
          maxMs = Math.max(maxMs, ms);
        }
      },
      snapshot(timezone, fallbackStart, fallbackEnd) {
        if (!count || !Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
          return {
            count,
            effectiveStartDate: cleanText(fallbackStart, 10),
            effectiveEndDate: cleanText(fallbackEnd, 10)
          };
        }
        return {
          count,
          effectiveStartDate: msToArchiveDateKey(minMs, timezone) || cleanText(fallbackStart, 10),
          effectiveEndDate: msToArchiveDateKey(maxMs, timezone) || cleanText(fallbackEnd, 10),
          minMs,
          maxMs
        };
      }
    };
  }

  function padChunkIndex(n) {
    return String(Number(n) || 0).padStart(6, '0');
  }

  function logChunkFileName(index) {
    return `logs-${padChunkIndex(index)}.ndjson`;
  }

  function actionStateChunkFileName(index) {
    return `action-states-${padChunkIndex(index)}.ndjson`;
  }

  function createNdjsonChunkWriter({ maxLines = DEFAULT_CHUNK_MAX_LINES, fileNameAtIndex }) {
    let chunkIndex = 1;
    let buffer = [];
    const flushedFiles = [];

    function flush() {
      if (!buffer.length) return null;
      const fileName = fileNameAtIndex(chunkIndex);
      const text = `${buffer.join('\n')}\n`;
      const lineCount = buffer.length;
      buffer = [];
      chunkIndex += 1;
      flushedFiles.push({ fileName, lineCount });
      return { fileName, text, lineCount };
    }

    return {
      appendRows(rows) {
        const out = [];
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          if (!row || typeof row !== 'object') return;
          buffer.push(JSON.stringify(row));
          if (buffer.length >= maxLines) {
            const flushed = flush();
            if (flushed) out.push(flushed);
          }
        });
        return out;
      },
      finish() {
        const flushed = flush();
        return {
          flushed: flushed ? [flushed] : [],
          files: flushedFiles.slice()
        };
      },
      get files() {
        return flushedFiles.slice();
      }
    };
  }

  function parseNdjsonText(text) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);
  }

  function paginateArray(items, offset, limit) {
    const list = Array.isArray(items) ? items : [];
    const off = Math.max(0, Number(offset) || 0);
    const lim = Math.max(0, Number(limit) || 0);
    if (!lim) return list.slice(off);
    return list.slice(off, off + lim);
  }

  return {
    DEFAULT_CHUNK_MAX_LINES,
    createBoundsTracker,
    createNdjsonChunkWriter,
    logChunkFileName,
    actionStateChunkFileName,
    parseNdjsonText,
    paginateArray,
    resolveLogTimestampMs
  };
}));
