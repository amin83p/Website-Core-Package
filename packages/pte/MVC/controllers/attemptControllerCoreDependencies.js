const paginate = require('../../../../MVC/utils/paginationHelper');
const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
} = require('../../../../MVC/utils/generalTools');

module.exports = {
  paginate,
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
};

