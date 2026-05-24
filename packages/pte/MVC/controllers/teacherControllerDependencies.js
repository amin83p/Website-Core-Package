const {
  paginate,
  buildDataServiceQuery,
  inferSearchableFields,
  isAjax
} = require('./pte/coreHelpers');
const pteTeacherDataService = require('../services/pte/pteTeacherDataService');

module.exports = {
  paginate,
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  pteTeacherDataService
};
