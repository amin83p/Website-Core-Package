'use strict';

const { Buffer } = require('buffer');
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

const JSZip = require('jszip');
const core = require('./reportDocxRenderCore');

const BUNDLE_SCHEMA_VERSION = 1;

function validateClientBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Render bundle must be a JSON object.');
  }
  if (Number(bundle.schemaVersion) !== BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported bundle schema version (expected ${BUNDLE_SCHEMA_VERSION}).`);
  }
  if (!Array.isArray(bundle.targets) || !bundle.targets.length) {
    throw new Error('Bundle has no targets.');
  }
  if (!bundle.templates || typeof bundle.templates !== 'object') {
    throw new Error('Bundle is missing templates.');
  }
  return true;
}

async function parseSarBundleZip(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const manifestText = await zip.file('manifest.json')?.async('string');
  const targetsText = await zip.file('targets.json')?.async('string');
  const templateIndexText = await zip.file('templates/index.json')?.async('string');
  if (!manifestText || !targetsText || !templateIndexText) {
    throw new Error('Invalid .sarbundle.zip: missing manifest, targets, or template index.');
  }
  const manifestPack = JSON.parse(manifestText);
  const targets = JSON.parse(targetsText);
  const templateIndex = JSON.parse(templateIndexText);
  const templates = {};
  await Promise.all(Object.entries(templateIndex).map(async ([key, meta]) => {
    const b64 = await zip.file(meta.file)?.async('string');
    if (!b64) throw new Error(`Missing template payload for ${key}.`);
    templates[key] = {
      templateId: meta.templateId,
      variantKey: meta.variantKey,
      label: meta.label,
      dataBase64: b64
    };
  }));
  const bundle = {
    schemaVersion: manifestPack.schemaVersion,
    renderCoreVersion: manifestPack.renderCoreVersion,
    manifest: manifestPack.manifest,
    templates,
    targets
  };
  validateClientBundle(bundle);
  return bundle;
}

function base64ToUint8Array(b64) {
  const binary = atob(String(b64 || ''));
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBuffer(binaryLike) {
  if (Buffer.isBuffer(binaryLike)) return binaryLike;
  if (binaryLike instanceof Uint8Array) return Buffer.from(binaryLike);
  if (binaryLike instanceof ArrayBuffer) return Buffer.from(new Uint8Array(binaryLike));
  return Buffer.from(binaryLike || []);
}

async function renderTargetDocx(target, templates) {
  const tpl = templates[target.templateRefKey];
  if (!tpl?.dataBase64) throw new Error(`Missing template ${target.templateRefKey}`);
  const binary = toBuffer(base64ToUint8Array(tpl.dataBase64));
  return core.renderDocxFromTemplateBuffer(binary, {
    placeholders: target.placeholders || {},
    collections: target.collections || {},
    fileName: target.fileName || 'report.docx'
  });
}

async function runPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 4, 16));
  const results = new Array(list.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(list[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function renderWithWorkerPool(targets, templates, concurrency, workerScriptUrl, onProgress) {
  return new Promise((resolve, reject) => {
    const list = Array.isArray(targets) ? targets : [];
    const limit = Math.max(1, Math.min(Number(concurrency) || 4, 16));
    const results = new Array(list.length);
    let nextIndex = 0;
    let completed = 0;
    let failed = false;

    const workers = Array.from({ length: Math.min(limit, list.length) }, () => new Worker(workerScriptUrl));

    const finishIfDone = () => {
      if (completed === list.length) {
        workers.forEach((worker) => worker.terminate());
        resolve(results);
      }
    };

    const assignWork = (worker, workerIndex) => {
      if (failed) return;
      if (nextIndex >= list.length) return;
      const index = nextIndex;
      nextIndex += 1;
      const target = list[index];
      worker.onmessage = (event) => {
        const payload = event.data || {};
        if (!payload.ok) {
          failed = true;
          workers.forEach((row) => row.terminate());
          reject(new Error(payload.error || 'Worker render failed.'));
          return;
        }
        results[index] = {
          buffer: payload.buffer,
          fileName: payload.fileName || target.fileName || `report_${index + 1}.docx`
        };
        completed += 1;
        if (typeof onProgress === 'function') {
          onProgress({ index, total: list.length, fileName: results[index].fileName, phase: 'render' });
        }
        if (nextIndex < list.length) {
          assignWork(worker, workerIndex);
        } else {
          finishIfDone();
        }
      };
      worker.onerror = (error) => {
        failed = true;
        workers.forEach((row) => row.terminate());
        reject(error);
      };
      const transfers = [];
      worker.postMessage({ target, templates, index }, transfers);
    };

    workers.forEach((worker, workerIndex) => assignWork(worker, workerIndex));
    if (!list.length) resolve([]);
  });
}

async function exportBundleLocally(bundle, { concurrency = 4, onProgress, workerScriptUrl } = {}) {
  validateClientBundle(bundle);
  const defaultConcurrency = Math.max(
    1,
    Math.min(Number(concurrency) || (typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) - 1 : 4), 8)
  );
  const useWorkers = typeof Worker !== 'undefined' && String(workerScriptUrl || '').trim();
  const rendered = useWorkers
    ? await renderWithWorkerPool(bundle.targets, bundle.templates, defaultConcurrency, workerScriptUrl, onProgress)
    : await runPool(bundle.targets, defaultConcurrency, async (target, index) => {
      const row = await renderTargetDocx(target, bundle.templates);
      if (typeof onProgress === 'function') {
        onProgress({ index, total: bundle.targets.length, fileName: row.fileName, phase: 'render' });
      }
      return row;
    });
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'merge', total: bundle.targets.length });
  }
  const mode = String(bundle.manifest?.mergePolicy?.mode || 'single').toLowerCase();
  const stem = String(bundle.manifest?.mergePolicy?.outputStem || 'student_attendance_export')
    .replace(/[^A-Za-z0-9._-]+/g, '_');
  if (mode === 'zip') {
    const zip = new JSZip();
    const used = new Set();
    rendered.forEach((row, index) => {
      let name = String(bundle.targets[index]?.fileName || row.fileName || `report_${index + 1}.docx`);
      const key = name.toLowerCase();
      if (used.has(key)) name = `report_${index + 1}_${name}`;
      used.add(key);
      zip.file(name, row.buffer);
    });
    const buffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    if (typeof onProgress === 'function') onProgress({ phase: 'complete', fileName: `${stem}.zip` });
    return { buffer: toBuffer(buffer), fileName: `${stem}.zip`, contentType: 'application/zip' };
  }
  const merged = core.mergeReportInstanceDocxBuffers(
    rendered.map((row) => toBuffer(row.buffer))
  );
  if (typeof onProgress === 'function') onProgress({ phase: 'complete', fileName: `${stem}.docx` });
  return {
    buffer: merged,
    fileName: `${stem}.docx`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
}

module.exports = {
  ...core,
  BUNDLE_SCHEMA_VERSION,
  validateClientBundle,
  parseSarBundleZip,
  exportBundleLocally,
  renderTargetDocx
};
