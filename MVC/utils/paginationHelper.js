// MVC/utils/paginationHelper.js
const settingService = require('../services/settingService'); // ✅ Use Dynamic Service

function paginate(items, pageOrQuery, limit) {
  // 1) Dynamic default from memory (instant)
  const defaultSize = settingService.getValue('app', 'defaultPageSize');// || 20;

  // 2) Overload: allow paginate(items, query) OR paginate(items, page, limit)
  let page;
  let lim;

  if (pageOrQuery && typeof pageOrQuery === 'object') {
    // paginate(items, { page, limit, ... })
    page = pageOrQuery.page;
    lim = pageOrQuery.limit;
  } else {
    // paginate(items, page, limit)
    page = pageOrQuery;
    lim = limit;
  }

  const pageInt = parseInt(page, 10) || 1;
  const limitInt = parseInt(lim, 10) || defaultSize;

  const totalItems = Array.isArray(items) ? items.length : 0;
  const totalPages = Math.ceil(totalItems / limitInt) || 1;

  const safePage = Math.min(Math.max(pageInt, 1), totalPages);
  const startIndex = (safePage - 1) * limitInt;
  const endIndex = safePage * limitInt;

  const slice = (items || []).slice(startIndex, endIndex);

  return {
    data: slice,
    pagination: {
      currentPage: safePage,
      totalPages,
      totalItems,
      limit: limitInt,
      startItem: totalItems > 0 ? startIndex + 1 : 0,
      endItem: Math.min(endIndex, totalItems)
    }
  };
}

module.exports = paginate;