'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { allocateWithRetry } = require('./schoolEntityIdAllocationService');

const LIBRARY_CLASS_KINDS = Object.freeze({
  BOOK_ASSIGNMENT: 'bka',
  BOOK_COVERING: 'bkc'
});

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatClassKindId(classId, kind, seq) {
  const classToken = toPublicId(classId);
  const kindToken = String(kind || '').trim().toLowerCase();
  if (!classToken) throw new Error('classId is required to allocate a library class entity id.');
  if (!kindToken) throw new Error('kind is required to allocate a library class entity id.');
  const n = Number(seq);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error('Library class entity sequence must be a positive integer.');
  }
  return `${classToken}-${kindToken}-${n}`;
}

function parseClassKindSeq(id, classId, kind) {
  const classToken = toPublicId(classId);
  const kindToken = String(kind || '').trim().toLowerCase();
  const token = String(id || '').trim();
  if (!classToken || !kindToken || !token) return 0;
  const prefix = `${classToken}-${kindToken}-`;
  if (!token.startsWith(prefix)) return 0;
  const suffix = token.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return 0;
  const n = Number.parseInt(suffix, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function maxSeqFromIdSet(ids = [], classId = '', kind = '') {
  const classToken = toPublicId(classId);
  if (!classToken) return 0;
  let maxSeq = 0;
  (Array.isArray(ids) ? ids : []).forEach((rawId) => {
    const id = String(rawId || '').trim();
    if (!id) return;
    const scoped = parseClassKindSeq(id, classToken, kind);
    if (scoped > maxSeq) maxSeq = scoped;
  });
  return maxSeq;
}

async function maxSeqFromMongoCollection(collection, classId, kind) {
  const classToken = toPublicId(classId);
  const kindToken = String(kind || '').trim().toLowerCase();
  if (!collection || !classToken || !kindToken) return 0;
  const scopedPattern = new RegExp(`^${escapeRegExp(classToken)}-${escapeRegExp(kindToken)}-(\\d+)$`);
  const rows = await collection.find(
    { classId: classToken },
    { projection: { id: 1 } }
  ).toArray();
  let maxSeq = 0;
  rows.forEach((row) => {
    const id = String(row?.id || '').trim();
    if (!id) return;
    const scopedMatch = id.match(scopedPattern);
    if (scopedMatch) {
      const n = Number.parseInt(scopedMatch[1], 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  });
  return maxSeq;
}

async function allocateNextClassKindId(classId, kind, options = {}) {
  const classToken = toPublicId(classId);
  const kindToken = String(kind || '').trim().toLowerCase();
  if (!classToken) throw new Error('classId is required to allocate a library class entity id.');
  if (!kindToken) throw new Error('kind is required to allocate a library class entity id.');

  let maxSeq = 0;
  if (options.collection) {
    maxSeq = await maxSeqFromMongoCollection(options.collection, classToken, kindToken);
  } else if (options.existingIds instanceof Set) {
    maxSeq = maxSeqFromIdSet([...options.existingIds], classToken, kindToken);
  } else if (Array.isArray(options.existingIds)) {
    maxSeq = maxSeqFromIdSet(options.existingIds, classToken, kindToken);
  }

  const reserved = options.reservedIds instanceof Set
    ? options.reservedIds
    : new Set(Array.isArray(options.reservedIds) ? options.reservedIds : []);

  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: reserved,
    reservedIds: null,
    maxAttempts: options.maxAttempts || 1000,
    generateCandidate: (attempt) => formatClassKindId(classToken, kindToken, maxSeq + 1 + attempt)
  });
}

module.exports = {
  LIBRARY_CLASS_KINDS,
  formatClassKindId,
  parseClassKindSeq,
  maxSeqFromIdSet,
  allocateNextClassKindId
};
