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

function createJob({ userId = '', activeOrgId = '' } = {}) {
  pruneExpiredJobs();
  const id = crypto.randomUUID();
  const job = {
    id,
    userId: cleanId(userId),
    activeOrgId: cleanId(activeOrgId),
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: '',
    filePath: '',
    contentType: '',
    fileName: ''
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

function toPublicJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error || '',
    ready: job.status === 'complete',
    fileName: job.fileName || ''
  };
}

function startJob(jobId, runner = async () => null) {
  const job = jobs.get(cleanId(jobId));
  if (!job || job.status !== 'pending') return;
  job.status = 'running';
  job.updatedAt = Date.now();

  setImmediate(async () => {
    try {
      const result = await runner();
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

module.exports = {
  createJob,
  getJobForUser,
  toPublicJob,
  startJob,
  readJobFile
};
