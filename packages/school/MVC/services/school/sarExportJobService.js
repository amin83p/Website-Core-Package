'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const JOB_TTL_MS = 60 * 60 * 1000;
const jobs = new Map();

function cleanId(value = '') {
  return String(value ?? '').trim();
}

function pruneExpiredJobs() {
  const now = Date.now();
  jobs.forEach((job, id) => {
    if (!job || now - job.createdAt > JOB_TTL_MS) {
      if (job?.filePath) {
        try {
          fs.unlinkSync(job.filePath);
        } catch {
          // ignore missing temp files
        }
      }
      jobs.delete(id);
    }
  });
}

function createJob({
  userId = '',
  activeOrgId = '',
  jobType = 'export',
  totalItems = 0
} = {}) {
  pruneExpiredJobs();
  const id = crypto.randomUUID();
  const total = Math.max(0, Number(totalItems) || 0);
  const job = {
    id,
    userId: cleanId(userId),
    activeOrgId: cleanId(activeOrgId),
    jobType: cleanId(jobType) === 'report' ? 'report' : 'export',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: 0,
    totalItems: total,
    processedItems: 0,
    phase: '',
    error: '',
    filePath: '',
    contentType: '',
    fileName: '',
    resultPayload: null
  };
  jobs.set(id, job);
  return job;
}

function assertJobAccess(job, reqUser) {
  if (!job) {
    const error = new Error('Export job was not found or has expired.');
    error.statusCode = 404;
    throw error;
  }
  const userId = cleanId(reqUser?.id || reqUser?.userId);
  if (job.userId && userId && job.userId !== userId) {
    const error = new Error('You do not have access to this export job.');
    error.statusCode = 403;
    throw error;
  }
  const activeOrgId = cleanId(reqUser?.activeOrgId);
  if (job.activeOrgId && activeOrgId && job.activeOrgId !== activeOrgId) {
    const error = new Error('Export job is not available for the active organization.');
    error.statusCode = 403;
    throw error;
  }
}

function getJobForUser(jobId, reqUser) {
  pruneExpiredJobs();
  const job = jobs.get(cleanId(jobId));
  assertJobAccess(job, reqUser);
  return job;
}

function computeEstimatedSecondsRemaining(job = {}) {
  const processed = Math.max(0, Number(job.processedItems) || 0);
  const total = Math.max(0, Number(job.totalItems) || 0);
  const startedAt = Number(job.startedAt) || 0;
  if (!processed || !total || processed >= total || !startedAt) return null;
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs <= 0) return null;
  const remaining = total - processed;
  const msPerItem = elapsedMs / processed;
  return Math.max(1, Math.ceil((remaining * msPerItem) / 1000));
}

function toPublicJob(job) {
  const totalItems = Math.max(0, Number(job.totalItems) || 0);
  const processedItems = Math.min(totalItems || Number.MAX_SAFE_INTEGER, Math.max(0, Number(job.processedItems) || 0));
  const remainingItems = totalItems > 0 ? Math.max(0, totalItems - processedItems) : null;
  const progressPercent = totalItems > 0
    ? Math.max(0, Math.min(100, Math.round((processedItems / totalItems) * 100)))
    : null;
  return {
    jobId: job.id,
    jobType: job.jobType || 'export',
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt || 0,
    totalItems,
    processedItems,
    remainingItems,
    progressPercent,
    phase: job.phase || '',
    estimatedSecondsRemaining: computeEstimatedSecondsRemaining(job),
    error: job.error || '',
    ready: job.status === 'complete',
    fileName: job.fileName || ''
  };
}

function updateJobProgress(jobId, patch = {}) {
  const job = jobs.get(cleanId(jobId));
  if (!job) return null;
  if (Object.prototype.hasOwnProperty.call(patch, 'totalItems')) {
    job.totalItems = Math.max(0, Number(patch.totalItems) || 0);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'processedItems')) {
    job.processedItems = Math.max(0, Number(patch.processedItems) || 0);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'phase')) {
    job.phase = String(patch.phase || '').trim();
  }
  job.updatedAt = Date.now();
  return job;
}

function completeJobWithPayload(jobId, resultPayload = null) {
  const job = jobs.get(cleanId(jobId));
  if (!job) return;
  job.status = 'complete';
  job.resultPayload = resultPayload && typeof resultPayload === 'object' ? resultPayload : null;
  if (job.totalItems > 0 && job.processedItems < job.totalItems) {
    job.processedItems = job.totalItems;
  }
  job.updatedAt = Date.now();
}

function startJob(jobId, runner = async () => null) {
  const job = jobs.get(cleanId(jobId));
  if (!job || job.status !== 'pending') return;
  job.status = 'running';
  job.startedAt = Date.now();
  job.updatedAt = Date.now();

  setImmediate(async () => {
    try {
      const result = await runner(job);
      if (job.jobType === 'report') {
        const payload = result && typeof result === 'object' && result.reportPayload
          ? result.reportPayload
          : result;
        if (!payload || typeof payload !== 'object') {
          throw new Error('Report load completed but no data was produced.');
        }
        completeJobWithPayload(job.id, payload);
        return;
      }
      const buffer = Buffer.isBuffer(result?.buffer)
        ? result.buffer
        : Buffer.from(result?.buffer || []);
      if (!buffer.length) {
        throw new Error('Export completed but no file data was produced.');
      }
      const filePath = path.join(os.tmpdir(), `sar-export-${job.id}`);
      fs.writeFileSync(filePath, buffer);
      job.status = 'complete';
      job.filePath = filePath;
      job.contentType = result.contentType || 'application/octet-stream';
      job.fileName = String(result.fileName || 'student_attendance_export.zip').replace(/"/g, '');
      if (job.totalItems > 0 && job.processedItems < job.totalItems) {
        job.processedItems = job.totalItems;
      }
      job.updatedAt = Date.now();
    } catch (error) {
      job.status = 'failed';
      job.error = String(error?.message || 'Export failed.');
      job.updatedAt = Date.now();
    }
  });
}

function readJobFile(job) {
  if (!job?.filePath || job.status !== 'complete') {
    const error = new Error('Export file is not ready yet.');
    error.statusCode = 409;
    throw error;
  }
  return fs.readFileSync(job.filePath);
}

function getJobResultPayload(job) {
  if (!job || job.status !== 'complete' || job.jobType !== 'report') {
    return null;
  }
  return job.resultPayload && typeof job.resultPayload === 'object' ? job.resultPayload : null;
}

module.exports = {
  createJob,
  getJobForUser,
  toPublicJob,
  updateJobProgress,
  startJob,
  readJobFile,
  getJobResultPayload,
  completeJobWithPayload,
  computeEstimatedSecondsRemaining
};
