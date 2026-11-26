'use strict';

const wordOfDayAccessService = require('../services/school/wordOfDayAccessService');

async function attachWordOfDayAccess(req, res, next) {
  try {
    await wordOfDayAccessService.getWordOfDayAccessForRequest(req);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  attachWordOfDayAccess
};