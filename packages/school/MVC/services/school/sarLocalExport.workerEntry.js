'use strict';

const { Buffer } = require('buffer');
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

const { renderTargetDocx } = require('./sarLocalExportCore.browserEntry');

self.onmessage = async (event) => {
  const payload = event.data || {};
  try {
    const row = await renderTargetDocx(payload.target, payload.templates || {});
    const buffer = row.buffer;
    const transfer = buffer instanceof ArrayBuffer
      ? buffer
      : (buffer && buffer.buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : null);
    if (transfer) {
      self.postMessage({
        ok: true,
        index: payload.index,
        fileName: row.fileName,
        buffer: transfer
      }, [transfer]);
    } else {
      self.postMessage({
        ok: true,
        index: payload.index,
        fileName: row.fileName,
        buffer
      });
    }
  } catch (error) {
    self.postMessage({
      ok: false,
      index: payload.index,
      error: error.message || 'Render failed.'
    });
  }
};
