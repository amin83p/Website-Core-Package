function getCoreDependencies() {
  return require('../services/pte/pteCoreDependencies');
}

module.exports = {
  get coreFilesService() {
    return getCoreDependencies().coreFilesService;
  },
  get uploadFolderSettingsService() {
    return getCoreDependencies().uploadFolderSettingsService;
  }
};
