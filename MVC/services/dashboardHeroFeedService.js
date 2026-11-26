'use strict';

const path = require('path');

function normalizeDashboardHeroFeeds(feeds) {
  if (!Array.isArray(feeds)) return [];
  return feeds.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (item.show === false) return false;
    return Boolean(String(item.partial || '').trim());
  });
}

function hasDashboardHeroFeeds(feeds) {
  return normalizeDashboardHeroFeeds(feeds).length > 0;
}

function sectionIsSchoolPackageDashboard(section) {
  if (!section || typeof section !== 'object') return false;
  const id = String(section.id || '').trim().toUpperCase();
  const name = String(section.name || '').trim().toUpperCase();
  const packageId = String(
    section.packageId
    || section.package?.packageId
    || section.package?.id
    || ''
  ).trim().toLowerCase();
  const packageName = String(section.packageName || section.package?.packageName || '').trim().toUpperCase();
  if (packageId === 'school' || packageName === 'SCHOOL') return true;
  if (name === 'SCHOOL' || id === 'SCHOOL') return true;
  const home = String(section.homeURL || section.homeUrl || '').trim().toLowerCase();
  return home === '/school' || home.startsWith('/school/');
}

async function resolveDashboardHeroFeedsForSection(req, section) {
  if (!sectionIsSchoolPackageDashboard(section)) return [];
  try {
    const schoolFeedService = require(path.join(
      __dirname,
      '../../packages/school/MVC/services/school/schoolDashboardHeroFeedService'
    ));
    return await schoolFeedService.buildDashboardHeroFeeds(req);
  } catch (_err) {
    return [];
  }
}

module.exports = {
  normalizeDashboardHeroFeeds,
  hasDashboardHeroFeeds,
  sectionIsSchoolPackageDashboard,
  resolveDashboardHeroFeedsForSection
};