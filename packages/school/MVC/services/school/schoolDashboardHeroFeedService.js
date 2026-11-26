'use strict';

const wordOfDayDashboardWidgetService = require('./wordOfDayDashboardWidgetService');

const WOD_WIDGET_PARTIAL = '../../../../packages/school/MVC/views/school/wordOfDay/partials/widget';

/**
 * Package-owned dashboard hero items for unified dashboard pages.
 * Returns only feeds that should render (e.g. WOD when an entry exists).
 */
async function buildDashboardHeroFeeds(req) {
  const feeds = [];
  const wordOfDayPayload = await wordOfDayDashboardWidgetService.resolveWordOfDayDashboardPayload(req);
  if (wordOfDayPayload?.entry) {
    feeds.push({
      id: 'wordOfDay',
      partial: WOD_WIDGET_PARTIAL,
      show: true,
      locals: {
        wordOfDayPayload,
        wordOfDayUiConstants: wordOfDayDashboardWidgetService.getWordOfDayUiConstants(),
        wordOfDayOpenInNewTab: true
      }
    });
  }
  return feeds;
}

module.exports = {
  buildDashboardHeroFeeds,
  WOD_WIDGET_PARTIAL
};