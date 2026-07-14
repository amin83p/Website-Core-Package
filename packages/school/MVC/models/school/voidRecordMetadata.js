const VOID_STATUS = 'void';

function clean(value) {
  return String(value || '').trim();
}

function applyVoidMetadata(target = {}, source = {}, existing = {}) {
  const status = clean(target.status || source.status).toLowerCase();
  if (status !== VOID_STATUS) {
    if (source.clearVoidMetadata === true) {
      target.voidedAt = '';
      target.voidedBy = '';
      target.voidReason = '';
      target.statusBeforeVoid = '';
    }
    return target;
  }
  target.status = VOID_STATUS;
  target.voidedAt = clean(target.voidedAt || source.voidedAt || existing.voidedAt) || new Date().toISOString();
  target.voidedBy = clean(target.voidedBy || source.voidedBy || existing.voidedBy);
  target.voidReason = clean(target.voidReason || source.voidReason || existing.voidReason);
  target.statusBeforeVoid = clean(target.statusBeforeVoid || source.statusBeforeVoid || existing.statusBeforeVoid) || 'active';
  return target;
}

function buildVoidPatch(record = {}, actor = {}, reason = '') {
  const currentStatus = clean(record.status).toLowerCase() || 'active';
  if (currentStatus === VOID_STATUS) return applyVoidMetadata({ ...record }, record, record);
  return applyVoidMetadata({
    ...record,
    status: VOID_STATUS,
    voidedAt: new Date().toISOString(),
    voidedBy: clean(actor?.id || actor?.userId || actor?._id),
    voidReason: clean(reason) || 'Deleted by user',
    statusBeforeVoid: currentStatus
  }, record, record);
}

function isVoidRecord(record = {}) {
  return clean(record.status).toLowerCase() === VOID_STATUS;
}

module.exports = { VOID_STATUS, applyVoidMetadata, buildVoidPatch, isVoidRecord };
