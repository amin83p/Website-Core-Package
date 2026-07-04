function resolveSectionDisplayTitle(section, formatLabel) {
  const custom = String(section?.displayText || '').trim();
  if (custom) return custom;
  const raw = String(section?.name || section?.id || '').trim();
  return typeof formatLabel === 'function' ? formatLabel(raw) : raw;
}

module.exports = {
  resolveSectionDisplayTitle
};
