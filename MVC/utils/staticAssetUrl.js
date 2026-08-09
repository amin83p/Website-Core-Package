'use strict';

function cleanVersionToken(value = '') {
  const token = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{6}$/.test(token)) return '';
  return token;
}

function buildStaticAssetUrl(assetPath = '', versionShort = '') {
  const path = String(assetPath || '').trim();
  if (!path) return '';
  const version = cleanVersionToken(versionShort);
  if (!version) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}v=${version}`;
}

module.exports = {
  cleanVersionToken,
  buildStaticAssetUrl
};
