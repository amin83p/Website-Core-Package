#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolUploadPathUtils = require('../packages/school/MVC/utils/schoolUploadPathUtils');
const { requireCoreModule } = require('../packages/school/MVC/services/school/schoolCoreContracts');

const pathResolver = requireCoreModule('MVC/utils/pathResolver');
const coreFilesService = requireCoreModule('MVC/services/coreFilesService');

const APPLY = process.argv.includes('--apply');

function clean(value, fallback = '') {
  const out = String(value || '').replace(/\0/g, '').trim();
  return out || fallback;
}

function parseDataUrl(value = '') {
  const match = String(value || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  if (!buffer.length) return null;
  return { mimeType, buffer };
}

function extensionForMime(mimeType = '') {
  const key = String(mimeType || '').toLowerCase();
  if (key.includes('pdf')) return '.pdf';
  if (key.includes('png')) return '.png';
  if (key.includes('jpeg') || key.includes('jpg')) return '.jpg';
  if (key.includes('gif')) return '.gif';
  if (key.includes('wordprocessingml') || key.includes('msword')) return '.docx';
  if (key.includes('spreadsheetml') || key.includes('excel')) return '.xlsx';
  if (key.includes('plain')) return '.txt';
  return '';
}

function safeFileName(value = '', fallback = 'attachment') {
  const parsed = path.parse(clean(value, fallback));
  const base = clean(parsed.name, fallback).replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 80) || fallback;
  const ext = clean(parsed.ext, '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
  return `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
}

async function writeAttachment({ attachment, classRow, sessionRow, studentPersonId, kind }) {
  const parsed = parseDataUrl(attachment?.dataUrl);
  if (!parsed) throw new Error('Attachment does not contain a valid dataUrl.');

  const category = schoolUploadPathUtils.buildClassWorkspaceCategory({
    classId: classRow?.id,
    sessionId: sessionRow?.sessionId,
    studentPersonId,
    kind
  });
  const scopeId = clean(classRow?.orgId, 'GLOBAL');
  const root = pathResolver.getRootPath(scopeId);
  const fullDir = pathResolver.resolveSafePath(root, category);
  pathResolver.ensureDir(fullDir);

  const requestedName = clean(attachment?.originalName || attachment?.name || attachment?.filename, 'attachment');
  const ext = path.extname(requestedName) || extensionForMime(parsed.mimeType);
  const fileName = safeFileName(ext ? requestedName : `${requestedName}${ext}`);
  const fullPath = path.join(fullDir, fileName);
  await fs.writeFile(fullPath, parsed.buffer);

  const url = coreFilesService.fromDiskPathToUploadsUrl(fullPath) || fullPath;
  return {
    id: clean(attachment?.id, '') || `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: requestedName,
    originalName: requestedName,
    filename: fileName,
    mimeType: parsed.mimeType,
    size: parsed.buffer.length,
    url,
    storagePath: url,
    path: fullPath,
    uploadedAt: clean(attachment?.uploadedAt, new Date().toISOString()),
    uploadedBy: clean(attachment?.uploadedBy, 'migration'),
    migratedFromDataUrl: true,
    classId: clean(classRow?.id),
    sessionId: clean(sessionRow?.sessionId),
    studentPersonId: clean(studentPersonId)
  };
}

async function main() {
  const classes = await schoolDataService.fetchData('classes', {}, null);
  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    classesScanned: 0,
    sessionsScanned: 0,
    inlineAttachmentsFound: 0,
    converted: 0,
    errors: []
  };

  for (const classRow of Array.isArray(classes) ? classes : []) {
    summary.classesScanned += 1;
    const sessions = await schoolDataService.getClassSessions(classRow.id, null);
    let changed = false;

    for (const sessionRow of Array.isArray(sessions) ? sessions : []) {
      summary.sessionsScanned += 1;
      for (const rosterRow of Array.isArray(sessionRow.roster) ? sessionRow.roster : []) {
        const personId = clean(rosterRow?.personId);
        if (rosterRow?.excuseAttachment?.dataUrl) {
          summary.inlineAttachmentsFound += 1;
          if (APPLY) {
            try {
              rosterRow.excuseAttachment = await writeAttachment({
                attachment: rosterRow.excuseAttachment,
                classRow,
                sessionRow,
                studentPersonId: personId,
                kind: 'excuse'
              });
              summary.converted += 1;
              changed = true;
            } catch (error) {
              summary.errors.push(`${classRow.id}/${sessionRow.sessionId}/${personId}/excuse: ${error.message}`);
            }
          }
        }
        for (const comment of Array.isArray(rosterRow?.comments) ? rosterRow.comments : []) {
          if (!comment?.attachment?.dataUrl) continue;
          summary.inlineAttachmentsFound += 1;
          if (APPLY) {
            try {
              comment.attachment = await writeAttachment({
                attachment: comment.attachment,
                classRow,
                sessionRow,
                studentPersonId: personId,
                kind: 'comment'
              });
              summary.converted += 1;
              changed = true;
            } catch (error) {
              summary.errors.push(`${classRow.id}/${sessionRow.sessionId}/${personId}/comment/${comment.id || 'unknown'}: ${error.message}`);
            }
          }
        }
      }
    }

    if (APPLY && changed) {
      await schoolDataService.saveClassSessions(classRow.id, sessions, null);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
