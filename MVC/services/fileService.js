const coreFilesService = require('./coreFilesService');

/**
 * Deletes a physical file given its web URL.
 * @param {string} fileUrl - Stored URL/path (for example: /uploads/tasks/img.png)
 * @returns {Promise<boolean>} True when deleted (or already missing)
 */
async function deleteFile(fileUrl) {
  if (!fileUrl) return false;

  try {
    await coreFilesService.deleteFilePaths([fileUrl]);
    return true;
  } catch (error) {
    console.warn(`[FileService] Delete Failed for ${fileUrl}: ${error.message}`);
    return false;
  }
}

module.exports = {
  deleteFile
};
