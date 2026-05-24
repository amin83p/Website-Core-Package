const paginate = require('../../../../MVC/utils/paginationHelper');
const {
  isAjax,
  inferSearchableFields,
  buildDataServiceQuery
} = require('../../../../MVC/utils/generalTools');
const securityService = require('../../../../MVC/services/security');
const { SECTIONS, OPERATIONS } = require('../../../../config/accessConstants');

module.exports = {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  paginate,
  securityService,
  SECTIONS,
  OPERATIONS
};
