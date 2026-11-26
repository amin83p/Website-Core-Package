const { SECTION_ID, SECTION_NAME } = require('../scripts/maintenance/seedSchoolWordOfDaySection');

async function revert() {
  return {
    status: 'skipped',
    message: `Revert for ${SECTION_NAME} (${SECTION_ID}) is manual; remove section, symbol, and access grants if needed.`
  };
}

module.exports = { revert };