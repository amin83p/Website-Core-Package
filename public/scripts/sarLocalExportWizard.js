/* global SarLocalExportCore */
(function (root) {
  'use strict';

  const IDB_NAME = 'sarLocalExportTemplates';
  const IDB_STORE = 'templates';

  function openTemplateDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'cacheKey' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open template cache.'));
    });
  }

  function templateCacheKey(orgId, templateRefKey) {
    return `${String(orgId || '').trim()}|${String(templateRefKey || '').trim()}`;
  }

  async function readTemplateCache(orgId, templateRefKey) {
    const db = await openTemplateDb();
    const key = templateCacheKey(orgId, templateRefKey);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const row = tx.objectStore(IDB_STORE).get(key);
      row.onsuccess = () => resolve(row.result || null);
      row.onerror = () => reject(row.error);
    });
  }

  async function writeTemplateCache(orgId, templateRow) {
    const db = await openTemplateDb();
    const templateRefKey = String(templateRow.templateRefKey || '').trim();
    const key = templateCacheKey(orgId, templateRefKey);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ cacheKey: key, orgId, ...templateRow });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function fetchTemplatesFromServer(refs) {
    const response = await fetch('/school/attendances/report/api/local-export/templates', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-AJAX-Request': 'true'
      },
      body: JSON.stringify({ refs })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== 'success') {
      throw new Error(payload?.message || `Template fetch failed (${response.status}).`);
    }
    return payload.templates || {};
  }

  function slimSnapshotForTemplatePrefetch(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    return {
      schemaVersion: snapshot.schemaVersion,
      manifest: snapshot.manifest,
      exportPlan: snapshot.exportPlan,
      reportTemplatesById: snapshot.reportTemplatesById,
      policy: snapshot.policy,
      policySummary: snapshot.policySummary
    };
  }

  async function fetchTemplatesForSnapshot(snapshot) {
    const slim = slimSnapshotForTemplatePrefetch(snapshot);
    const response = await fetch('/school/attendances/report/api/local-export/templates', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-AJAX-Request': 'true'
      },
      body: JSON.stringify({ snapshot: slim })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== 'success') {
      throw new Error(payload?.message || `Template fetch failed (${response.status}).`);
    }
    return {
      templates: payload.templates || {},
      orgId: payload.orgId || snapshot?.manifest?.orgId || '',
      refCount: Number(payload.refCount) || Object.keys(payload.templates || {}).length
    };
  }

  async function resolveDocxTemplates(orgId, refs) {
    const serverRefs = [];
    const templates = {};
    for (let index = 0; index < refs.length; index += 1) {
      const ref = refs[index];
      const templateId = String(ref.templateId || '').trim();
      const variantKey = String(ref.variantKey || 'default').trim() || 'default';
      const templateRefKey = `${templateId}|${variantKey}`;
      const cached = await readTemplateCache(orgId, templateRefKey);
      if (cached?.dataBase64) {
        templates[templateRefKey] = cached;
      } else {
        serverRefs.push({ templateId, variantKey });
      }
    }
    if (serverRefs.length) {
      const fetched = await fetchTemplatesFromServer(serverRefs);
      const entries = Object.entries(fetched);
      for (let index = 0; index < entries.length; index += 1) {
        const [key, row] = entries[index];
        templates[key] = row;
        await writeTemplateCache(orgId, row);
      }
    }
    return templates;
  }

  function refsFromExportPlan(exportPlan) {
    const refs = [];
    const reportTemplateId = String(exportPlan?.reportTemplateId || '').trim();
    if (reportTemplateId) {
      (Array.isArray(exportPlan?.classTemplateDocxOptions) ? exportPlan.classTemplateDocxOptions : []).forEach((opt) => {
        const variantKey = String(opt?.key || opt?.value || '').trim() || 'default';
        refs.push({ templateId: reportTemplateId, variantKey });
      });
    }
    const students = Array.isArray(exportPlan?.students) ? exportPlan.students : [];
    students.forEach((student) => {
      (Array.isArray(student.classes) ? student.classes : []).forEach((classRow) => {
        if (!classRow?.hasDocx || !reportTemplateId) return;
        const options = Array.isArray(classRow.docxOptions) ? classRow.docxOptions : [];
        if (options.length) {
          options.forEach((opt) => {
            const variantKey = String(opt?.key || opt?.value || '').trim() || 'default';
            refs.push({ templateId: reportTemplateId, variantKey });
          });
        } else {
          const variantKey = String(classRow.suggestedDocxKey || 'default').trim() || 'default';
          refs.push({ templateId: reportTemplateId, variantKey });
        }
      });
      (Array.isArray(student.overallOptions) ? student.overallOptions : []).forEach((option) => {
        if (!option?.hasDocx) return;
        const templateId = String(option.id || option.templateId || '').trim();
        if (!templateId) return;
        const variants = Array.isArray(option.templateVariantOptions) ? option.templateVariantOptions : [];
        if (variants.length) {
          variants.forEach((variantRow) => {
            if (variantRow?.hasDocx === false) return;
            const variantKey = String(variantRow?.key || 'default').trim() || 'default';
            refs.push({ templateId, variantKey });
          });
        } else {
          const variantKey = String(option.suggestedTemplateVariantKey || 'default').trim() || 'default';
          refs.push({ templateId, variantKey });
        }
      });
    });
    const unique = new Map();
    refs.forEach((ref) => {
      const key = `${ref.templateId}|${ref.variantKey}`;
      unique.set(key, ref);
    });
    return [...unique.values()];
  }

  function refsFromWizardTargets(targets, exportPlan) {
    const refs = [];
    const students = Array.isArray(exportPlan?.students) ? exportPlan.students : [];
    const byPerson = new Map(students.map((row) => [String(row.personId || '').trim(), row]));
    targets.forEach((target) => {
      const type = String(target.type || '').toLowerCase();
      const student = byPerson.get(String(target.studentId || '').trim());
      if (!student) return;
      if (type === 'class') {
        const docxKey = String(target.docxKey || 'default').trim() || 'default';
        refs.push({
          templateId: String(exportPlan.reportTemplateId || '').trim(),
          variantKey: docxKey
        });
        return;
      }
      if (type === 'overall') {
        const overallId = String(target.overallTemplateId || '').trim();
        const variantKey = String(target.templateVariantKey || 'default').trim() || 'default';
        refs.push({ templateId: overallId, variantKey });
      }
    });
    const unique = new Map();
    refs.forEach((ref) => {
      const key = `${ref.templateId}|${ref.variantKey}`;
      unique.set(key, ref);
    });
    return [...unique.values()];
  }

  async function downloadAndParseSnapshot({ actionStateId, startDate, endDate, studentIds }) {
    const params = new URLSearchParams({
      actionStateId: String(actionStateId || '').trim(),
      startDate: String(startDate || '').trim(),
      endDate: String(endDate || '').trim(),
      studentIds: (Array.isArray(studentIds) ? studentIds : []).join(',')
    });
    const response = await fetch('/school/attendances/report/api/export-raw-snapshot', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-AJAX-Request': 'true'
      },
      body: params.toString()
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || `Snapshot download failed (${response.status}).`);
    }
    const rawText = await response.text();
    const snapshot = JSON.parse(rawText);
    const disposition = response.headers.get('Content-Disposition') || '';
    const fileNameMatch = disposition.match(/filename="([^"]+)"/i);
    const fileName = fileNameMatch?.[1] || `student_attendance_${startDate}_${endDate}.sarraw.json`;
    return { snapshot, fileName, rawText };
  }

  async function prepareBundleFromSnapshot(snapshot, targets, docxTemplates, mergeMode) {
    const response = await fetch('/school/attendances/report/api/local-export/prepare-from-snapshot', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-AJAX-Request': 'true'
      },
      body: JSON.stringify({ snapshot, targets, docxTemplates, mergeMode })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== 'success') {
      throw new Error(payload?.message || `Prepare failed (${response.status}).`);
    }
    return payload.bundle;
  }

  async function cacheTemplatesFromSnapshot(orgId, snapshot) {
    const { templates, orgId: resolvedOrgId } = await fetchTemplatesForSnapshot(snapshot);
    const activeOrgId = String(resolvedOrgId || orgId || snapshot?.manifest?.orgId || '').trim();
    const entries = Object.entries(templates || {});
    for (let index = 0; index < entries.length; index += 1) {
      const [, row] = entries[index];
      // eslint-disable-next-line no-await-in-loop
      await writeTemplateCache(activeOrgId, row);
    }
    return { cachedCount: entries.length, templates, orgId: activeOrgId };
  }

  root.SarLocalExportWizard = {
    resolveDocxTemplates,
    refsFromExportPlan,
    refsFromWizardTargets,
    prepareBundleFromSnapshot,
    downloadAndParseSnapshot,
    fetchTemplatesForSnapshot,
    cacheTemplatesFromSnapshot,
    templateCacheKey
  };
}(typeof self !== 'undefined' ? self : this));
