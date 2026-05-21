// MVC/controllers/importControllerFactory.js
const fs = require('fs');
const { parse } = require('csv-parse');
const fileAssetStorage = require('../services/fileAssetStorageService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');

// Shared in-memory job store
const activeJobs = {};

/**
 * Generic CSV import controller factory.
 *
 * @param {Object} config
 * @param {string} config.downloadRouteBase - (Deprecated in V2 - we use generic file download)
 * @param {(record: any, context: any) => Promise<void>} config.processRecord
 * @param {(record: any, context: any) => Promise<void>} [config.validateRecord]
 * @param {(req: any) => any} [config.buildContext]
 */
function createImportController({ processRecord, validateRecord, buildContext }) {
  if (!processRecord) {
    throw new Error('processRecord is required in createImportController()');
  }

  // ─────────────────────────────────────────
  // 1. Start import (upload handler)
  // ─────────────────────────────────────────
  async function startImport(req, res) {
    console.log('[ImportController] startImport called');

    try {
      if (!req.file) {
        return res.status(400).json({ status: 'error', message: 'No file uploaded or expired.' });
      }

      const jobId = Math.random().toString(36).substring(7);

      // ✅ Capture User Context automatically
      const userContext = req.user ? { 
          userId: req.user.id, 
          username: req.user.username || req.user.email,
          orgId: req.user.activeOrgId 
      } : { userId: 'guest', orgId: 'GLOBAL' };

      // Merge with custom context if provided
      const extraContext = typeof buildContext === 'function' ? buildContext(req) : {};
      const context = { ...userContext, ...extraContext };

      activeJobs[jobId] = {
        progress: 0,
        clients: [],
        aborted: false,
        filePath: req.file.path,
        context,
      };

      processImportBackground(jobId);

      return res.status(202).json({ status: 'success', jobId, message: 'Upload accepted, processing started' });
    } catch (error) {
      console.error('[ImportController] Error in startImport:', error);
      return res.status(500).json({ status: 'error', message: error.message });
    }
  }

  // ─────────────────────────────────────────
  // 2. Stream status (SSE) - Unchanged
  // ─────────────────────────────────────────
  function streamImportStatus(req, res) {
    const jobId = req.params.jobId;
    if (!activeJobs[jobId]) return res.status(404).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    activeJobs[jobId].clients.push(res);

    req.on('close', () => {
      if (activeJobs[jobId]) {
        activeJobs[jobId].clients = activeJobs[jobId].clients.filter(c => c !== res);
      }
    });
  }

  // ─────────────────────────────────────────
  // 3. Abort import - Unchanged
  // ─────────────────────────────────────────
  function abortImport(req, res) {
    const jobId = req.params.jobId;
    if (activeJobs[jobId]) {
      activeJobs[jobId].aborted = true;
      return res.json({ status: 'success' });
    }
    return res.status(404).json({ status: 'error', message: 'Job not found' });
  }

  // ─────────────────────────────────────────
  // 4. Download - Legacy Support
  // ─────────────────────────────────────────
  // Note: V2 mostly uses the URL sent in the SSE 'complete' event, 
  // but we keep this for backward compatibility if needed.
  function downloadImportReport(req, res) {
      res.status(410).send("Please use the File Manager to download reports.");
  }

  // ─────────────────────────────────────────
  // Background Worker
  // ─────────────────────────────────────────
  async function processImportBackground(jobId) {
    const job = activeJobs[jobId];
    if (!job) return;

    const { filePath, context } = job;

    const reportLines = [
      `IMPORT REPORT`,
      `Job ID: ${jobId}`,
      `User: ${context.username || context.userId}`,
      `Date: ${new Date().toLocaleString()}`,
      '--------------------------------------------------',
    ];

    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;

    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');

      parse(
        fileContent,
        { columns: true, skip_empty_lines: true, trim: true },
        async (err, records) => {
          if (err) {
            broadcast(jobId, { status: 'error', message: 'CSV Parse Error: ' + err.message });
            cleanup(jobId);
            return;
          }

          const total = records.length;
          broadcast(jobId, { status: 'info', message: `Processing ${total} records...`, totalItems: total });

          for (const record of records) {
            if (!activeJobs[jobId]) break;
            if (job.aborted) {
              reportLines.push(`[ABORTED] Process stopped by user.`);
              broadcast(jobId, { status: 'abort', message: 'Aborted' });
              break;
            }

            processedCount++;
            const progress = Math.round((processedCount / total) * 100);

            try {
              if (typeof validateRecord === 'function') await validateRecord(record, context);
              await processRecord(record, context);
              successCount++;
              reportLines.push(`[SUCCESS] Row ${processedCount}: ${record.name || record.email || 'Record'} imported.`);
              broadcast(jobId, { progress, status: 'success', message: `Imported row ${processedCount}` });
            } catch (e) {
              errorCount++;
              reportLines.push(`[ERROR]   Row ${processedCount}: ${e.message}`);
              broadcast(jobId, { progress, status: 'error', message: `Row ${processedCount} Failed: ${e.message}` });
            }
            await new Promise(r => setTimeout(r, 20)); // Small delay for UI updates
          }

          reportLines.push('--------------------------------------------------');
          reportLines.push(`SUMMARY: Total: ${total} | Success: ${successCount} | Failed: ${errorCount}`);

          // ✅ NEW: Save to 'importReports' in the correct Scope
          const reportContent = reportLines.join('\n');
          
          // 1. Determine scoped File Manager path
          const scopeId = (context.orgId && context.orgId !== 'SYSTEM') ? context.orgId : 'GLOBAL';
          const reportDir = uploadFolderSettingsService.resolveUploadFolder('generated.importReports');

          // 2. Generate Filename: ImportReport_YYYY-MM-DD_HHMM_User_JobId.txt
          const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const safeUser = (context.userId || 'system').replace(/[^a-zA-Z0-9]/g, '');
          const filename = `ImportReport_${dateStr}_${safeUser}_${jobId}.txt`;

          // 3. Write File
          const savedReport = await fileAssetStorage.saveBuffer({
            scopeKey: scopeId,
            relativeDir: reportDir,
            fileName: filename,
            originalName: filename,
            mimeType: 'text/plain',
            buffer: Buffer.from(reportContent, 'utf8')
          });

          // 4. Generate Download Link (Using File Controller V2 Logic)
          // Path format for File Controller: "ORG_XX/importReports/filename.txt"
          const relativePath = savedReport.relativePath;
          const downloadUrl = `/files/download/dummy?path=${encodeURIComponent(relativePath)}`;

          if (!job.aborted) {
            broadcast(jobId, {
              isComplete: true,
              status: 'success',
              message: 'Import Complete! Report saved.',
              downloadUrl: downloadUrl // Modal uses this to show "Download Log" button
            });
          }

          cleanup(jobId);
        }
      );
    } catch (e) {
      console.error('[ImportWorker] System error:', e);
      broadcast(jobId, { status: 'error', message: 'System error during import.' });
      cleanup(jobId);
    }
  }

  function broadcast(jobId, data) {
    const job = activeJobs[jobId];
    if (!job) return;
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    job.clients.forEach(client => client.write(msg));
  }

  function cleanup(jobId) {
    const job = activeJobs[jobId];
    if (!job) return;
    setTimeout(() => {
      try { if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath); } catch (e) {}
      delete activeJobs[jobId];
    }, 1000);
  }

  return {
    startImport,
    streamImportStatus,
    abortImport,
    downloadImportReport,
  };
}

module.exports = createImportController;
