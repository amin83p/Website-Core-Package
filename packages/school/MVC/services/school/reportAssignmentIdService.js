const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function formatReportAssignmentId(classId, seq) {
  const classToken = toPublicId(classId);
  if (!classToken) throw new Error('classId is required to allocate a report assignment id.');
  const n = Number(seq);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error('Report assignment sequence must be a positive integer.');
  }
  return `${classToken}-${n}`;
}

function parseClassScopedSeq(id, classId) {
  const classToken = toPublicId(classId);
  const token = String(id || '').trim();
  if (!classToken || !token) return 0;
  const prefix = `${classToken}-`;
  if (!token.startsWith(prefix)) return 0;
  const suffix = token.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return 0;
  const n = Number.parseInt(suffix, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function maxSeqFromIdSet(ids = [], classId = '') {
  const classToken = toPublicId(classId);
  if (!classToken) return 0;
  let maxSeq = 0;
  (Array.isArray(ids) ? ids : []).forEach((rawId) => {
    const id = String(rawId || '').trim();
    if (!id) return;
    const scoped = parseClassScopedSeq(id, classToken);
    if (scoped > maxSeq) maxSeq = scoped;
    if (/^\d+$/.test(id)) {
      const legacy = Number.parseInt(id, 10);
      if (Number.isFinite(legacy) && legacy > maxSeq) maxSeq = legacy;
    }
  });
  return maxSeq;
}

async function maxSeqFromMongoCollection(collection, classId) {
  const classToken = toPublicId(classId);
  if (!collection || !classToken) return 0;
  const scopedPattern = new RegExp(`^${escapeRegExp(classToken)}-(\\d+)$`);
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
      return;
    }
    if (/^\d+$/.test(id)) {
      const legacy = Number.parseInt(id, 10);
      if (Number.isFinite(legacy) && legacy > maxSeq) maxSeq = legacy;
    }
  });
  return maxSeq;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function allocateNextReportAssignmentId(classId, options = {}) {
  const classToken = toPublicId(classId);
  if (!classToken) throw new Error('classId is required to allocate a report assignment id.');

  let maxSeq = 0;
  if (options.collection) {
    maxSeq = await maxSeqFromMongoCollection(options.collection, classToken);
  } else if (options.existingIds instanceof Set) {
    maxSeq = maxSeqFromIdSet([...options.existingIds], classToken);
  } else if (Array.isArray(options.existingIds)) {
    maxSeq = maxSeqFromIdSet(options.existingIds, classToken);
  } else if (Array.isArray(options.assignmentsForClass)) {
    maxSeq = maxSeqFromIdSet(
      options.assignmentsForClass.map((row) => row?.id),
      classToken
    );
  }

  const reserved = options.reservedIds instanceof Set
    ? options.reservedIds
    : new Set(Array.isArray(options.reservedIds) ? options.reservedIds : []);

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = formatReportAssignmentId(classToken, maxSeq + 1 + attempt);
    if (reserved.has(candidate)) continue;
    if (options.collection) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await options.collection.findOne({ id: candidate }, { projection: { _id: 1 } });
      if (exists) continue;
    }
    return candidate;
  }

  throw new Error('Unable to allocate a unique report assignment id.');
}

module.exports = {
  formatReportAssignmentId,
  parseClassScopedSeq,
  maxSeqFromIdSet,
  allocateNextReportAssignmentId
};
