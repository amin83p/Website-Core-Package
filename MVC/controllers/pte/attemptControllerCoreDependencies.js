const paginate = require('../../utils/paginationHelper');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = require('../../utils/generalTools');

module.exports = {
  paginate,
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
};
